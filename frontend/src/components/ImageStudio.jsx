import React, { useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { Check, FilePlus2, ImagePlus, Scissors, X } from 'lucide-react';
import { downloadBlob, exactFileSize, formatBytes, recordActivity, saveFileToDatabase } from '../lib/util';
import { imagesToPdf } from '../lib/pdfTools';

const outputTypes = ['JPEG', 'PNG', 'WEBP'];

// Some Chrome builds advertise WebP through toDataURL but never invoke the toBlob
// callback for it, which would stall every encode. Track the first failure so the
// rest of the session goes straight to JPEG instead of paying the timeout again.
let webpEncoderUsable = true;
const compressionModes = [
  { id: 'recommended', label: 'Recommended compression', description: 'Keeps full resolution and the highest quality that still saves space', badge: 'RECOMMENDED', minQuality: 0.82, maxQuality: 0.95 },
  { id: 'extreme', label: 'Extreme compression', description: 'Smallest file, resizes and softens photos', badge: 'BEST COMPRESSION', minQuality: 0.45, maxQuality: 0.8 },
  { id: 'lossless', label: 'Keep original quality', description: 'Never resizes the image', badge: 'LOSSLESS', minQuality: 1, maxQuality: 1 },
];

const studioTools = [
  { id: 'convert', label: 'Convert & compress', icon: ImagePlus },
  { id: 'resize', label: 'Resize image', icon: Scissors },
  { id: 'makepdf', label: 'Images → PDF', icon: FilePlus2 },
];

function ImageStudio({ user, notify }) {
  const [tool, setTool] = useState('convert');
  const [images, setImages] = useState([]);
  const [format, setFormat] = useState('JPEG');
  const [quality, setQuality] = useState(95);
  const [compressionMode, setCompressionMode] = useState('recommended');
  // 100% keeps the source dimensions and lets the encoder pick the highest
  // quality that still fits the original byte count. A lower default silently
  // forced quality down to ~0.78 on already-compressed photos, which is what
  // made converted images look soft and blocky.
  const [targetSize, setTargetSize] = useState(100);
  // Empty means "no absolute cap". Defaulting this to a small value silently
  // crushed every large photo, so it stays blank unless the user asks for it.
  const [targetFileSize, setTargetFileSize] = useState('');
  const [targetUnit, setTargetUnit] = useState('KB');
  const [resizeType, setResizeType] = useState('percent');
  const [percent, setPercent] = useState(100);
  const [width, setWidth] = useState('');
  const [height, setHeight] = useState('');
  const [keepAspect, setKeepAspect] = useState(true);
  const [pageSize, setPageSize] = useState('auto');
  const [orientation, setOrientation] = useState('auto');
  const [margin, setMargin] = useState(24);
  const [processing, setProcessing] = useState(false);
  const [progress, setProgress] = useState(0);
  const [results, setResults] = useState({});
  const inputRef = useRef(null);

  const addImages = (event) => {
    const selected = [...event.target.files];
    const valid = selected.filter((file) => file.type.startsWith('image/'));
    if (valid.length !== selected.length) notify('Only image files can be added to Image studio.', 'error');
    setImages((current) => [...current, ...valid.map((file) => ({ file, id: crypto.randomUUID() }))]);
    event.target.value = '';
  };

  const mimeFor = (type) => (type === 'JPEG' ? 'image/jpeg' : type === 'PNG' ? 'image/png' : 'image/webp');

  const unitBytesOf = (amount, unit) => {
    const n = Number(amount);
    if (!isFinite(n) || n <= 0) return 0;
    return n * (unit === 'MB' ? 1024 * 1024 : 1024);
  };

  // Drawing a large source straight into a much smaller canvas in one
  // drawImage() call is heavily aliased by the browser and looks soft. Halving
  // repeatedly (each step well under 2x) keeps far more real detail.
  const sourceSize = (source) => ({
    w: source.width || source.naturalWidth || 0,
    h: source.height || source.naturalHeight || 0,
  });

  const drawScaled = (ctx, source, w, h) => {
    const { w: sw, h: sh } = sourceSize(source);
    let current = source;
    let cw = sw;
    let ch = sh;
    if (!cw || !ch) return ctx.drawImage(source, 0, 0, w, h);
    while (cw > w * 2 && ch > h * 2) {
      const nw = Math.max(w, Math.round(cw / 2));
      const nh = Math.max(h, Math.round(ch / 2));
      const step = document.createElement('canvas');
      step.width = nw;
      step.height = nh;
      const sctx = step.getContext('2d');
      if (!sctx) break;
      sctx.imageSmoothingEnabled = true;
      sctx.imageSmoothingQuality = 'high';
      sctx.drawImage(current, 0, 0, nw, nh);
      current = step;
      cw = nw;
      ch = nh;
    }
    ctx.drawImage(current, 0, 0, w, h);
  };

  // An encoder that never invokes its callback would freeze the whole conversion,
  // so every attempt is bounded and degrades to JPEG rather than hanging.
  const ENCODE_TIMEOUT_MS = 4000;

  const encodeCanvas = (bitmap, w, h, mime, quality) =>
    new Promise((resolve) => {
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(w));
      canvas.height = Math.max(1, Math.round(h));
      const ctx = canvas.getContext('2d');
      if (!ctx) return resolve(null);
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';

      const paint = (target) => {
        // JPEG has no alpha channel, so transparent pixels would otherwise be
        // encoded as black. Flatten onto white for JPEG and for the JPEG fallback.
        if (target === 'image/jpeg') {
          ctx.fillStyle = '#ffffff';
          ctx.fillRect(0, 0, canvas.width, canvas.height);
        }
        drawScaled(ctx, bitmap, canvas.width, canvas.height);
      };

      let settled = false;
      const finish = (blob) => {
        if (settled) return;
        settled = true;
        resolve(blob);
      };

      const attempt = (target, targetQuality) => {
        paint(target);
        let done = false;
        const degrade = () => {
          if (done) return;
          done = true;
          if (target !== 'image/jpeg') {
            if (target === 'image/webp') webpEncoderUsable = false;
            return attempt('image/jpeg', targetQuality === 1 ? 0.95 : targetQuality);
          }
          return finish(null);
        };
        const guard = setTimeout(degrade, ENCODE_TIMEOUT_MS);
        canvas.toBlob((out) => {
          if (done) return;
          done = true;
          clearTimeout(guard);
          // A browser without the requested encoder silently returns a different
          // type, so the file must match a format that actually encodes.
          if (out && target === 'image/webp' && out.type !== 'image/webp') {
            webpEncoderUsable = false;
            return degrade();
          }
          finish(out);
        }, target, targetQuality);
      };

      attempt(mime === 'image/webp' && !webpEncoderUsable ? 'image/jpeg' : mime, quality);
    });

  const decodeImage = async (file) => {
    try {
      return await createImageBitmap(file);
    } catch {
      const url = URL.createObjectURL(file);
      try {
        return await new Promise((resolve, reject) => {
          const img = new Image();
          img.onload = () => resolve(img);
          img.onerror = () => reject(new Error(`The image "${file.name || 'image'}" could not be decoded.`));
          img.src = url;
        });
      } finally {
        URL.revokeObjectURL(url);
      }
    }
  };

const sanitizeSizeInput = (raw) => {
    let s = String(raw).replace(/[^\d.]/g, '');
    const firstDot = s.indexOf('.');
    if (firstDot !== -1) s = s.slice(0, firstDot + 1) + s.slice(firstDot + 1).replace(/\./g, '');
    return s;
  };

  const targetSizeField = () => (
    <div className="target-size-inline">
      <input type="text" inputMode="decimal" value={targetFileSize} onChange={(event) => setTargetFileSize(sanitizeSizeInput(event.target.value))} />
      <select value={targetUnit} onChange={(event) => setTargetUnit(event.target.value)} aria-label="Target size unit"><option value="KB">KB</option><option value="MB">MB</option></select>
    </div>
  );

  // Iterative/binary-search compressor: finds the highest quality that fits the
  // target size, and only when quality alone is not enough shrinks the dimensions
  // (preserving aspect ratio) while re-running the quality search at each size.
  const compressToTarget = async (bitmap, mime, targetBytes, opts = {}) => {
    const supportsQuality = mime !== 'image/png';
    const minQualityIdx = Math.max(0.05, Math.min(0.9, Number(opts.minQuality) || 0.35));
    const maxQualityIdx = Math.max(minQualityIdx, Number(opts.maxQuality) || 0.95);
    // PNG has no quality knob, and lossless mode is explicitly about keeping the
    // image intact, so in both cases the size target must never resize the image.
    const allowDownscale = supportsQuality && opts.allowDownscale !== false;
    const originalW = Math.max(1, Math.round(bitmap.width));
    const originalH = Math.max(1, Math.round(bitmap.height));
    const ratio = originalW / originalH;
    const dimsAt = (scale) => ({
      w: Math.max(1, Math.round(originalW * scale)),
      h: Math.max(1, Math.round((originalW * scale) / ratio)),
    });

    const qualitySearch = async (w, h) => {
      if (!supportsQuality) {
        const blob = await encodeCanvas(bitmap, w, h, mime, undefined);
        return blob && blob.size <= targetBytes ? { blob, quality: 1, width: w, height: h } : null;
      }
      let best = null;
      let low = minQualityIdx;
      let high = maxQualityIdx;
      for (let attempt = 0; attempt < 10; attempt += 1) {
        const q = (low + high) / 2;
        const blob = await encodeCanvas(bitmap, w, h, mime, q);
        if (!blob) continue;
        if (blob.size <= targetBytes) {
          best = { blob, quality: q, width: w, height: h };
          low = q;
        } else {
          high = q;
        }
      }
      return best;
    };

    const full = await qualitySearch(originalW, originalH);
    if (full) return full;

    // The target cannot be met at full size. If resizing is not allowed, return
    // the best full-resolution encode instead of shrinking or collapsing the
    // image, and flag that the target was exceeded.
    if (!allowDownscale) {
      const q = supportsQuality ? maxQualityIdx : undefined;
      const blob = await encodeCanvas(bitmap, originalW, originalH, mime, q);
      return { blob, quality: supportsQuality ? q : 1, width: originalW, height: originalH, exceededTarget: true };
    }

    // Prefer keeping the full resolution when the cheapest acceptable quality is
    // already close to the target. Hitting the target exactly by shrinking pixels
    // costs far more visible detail than a small overshoot, so only resize when
    // full resolution is genuinely far too large.
    if (opts.keepFullSize) {
      const floorBlob = await encodeCanvas(bitmap, originalW, originalH, mime, minQualityIdx);
      if (floorBlob && floorBlob.size <= targetBytes * 1.5) {
        return { blob: floorBlob, quality: minQualityIdx, width: originalW, height: originalH, exceededTarget: true };
      }
    }

    let fit = null;
    let fitScale = 0;
    let noFitScale = 1;
    let scale = 1;
    for (let step = 0; step < 24; step += 1) {
      const { w, h } = dimsAt(scale);
      const probe = await encodeCanvas(bitmap, w, h, mime, supportsQuality ? minQualityIdx : undefined);
      if (!probe) break;
      if (probe.size <= targetBytes) {
        fit = (await qualitySearch(w, h)) || { blob: probe, quality: minQualityIdx, width: w, height: h };
        fitScale = scale;
        break;
      }
      noFitScale = scale;
      const factor = Math.min(0.92, Math.max(0.6, Math.sqrt(targetBytes / Math.max(1, probe.size))));
      scale *= factor;
      if (dimsAt(scale).w < 1 || dimsAt(scale).h < 1) break;
    }

    if (fit && fitScale > 0) {
      let low = fitScale;
      let high = noFitScale;
      let prev = null;
      for (let step = 0; step < 8; step += 1) {
        const mid = (low + high) / 2;
        const { w, h } = dimsAt(mid);
        if (prev && Math.abs(w - prev.w) <= 1 && Math.abs(h - prev.h) <= 1) break;
        prev = { w, h };
        const probe = await encodeCanvas(bitmap, w, h, mime, supportsQuality ? minQualityIdx : undefined);
        if (!probe) break;
        if (probe.size <= targetBytes) {
          const attempt = await qualitySearch(w, h);
          if (attempt) {
            fit = attempt;
            low = mid;
          } else {
            high = mid;
          }
        } else {
          high = mid;
        }
      }
      return fit;
    }

    // Last resort: the target was unreachable. Floor the long edge at 16px so we
    // never hand back a degenerate 1x1 image, and flag that the target was missed.
    const minScale = 16 / Math.max(originalW, originalH);
    const tiny = dimsAt(minScale);
    const blob = await encodeCanvas(bitmap, tiny.w, tiny.h, mime, supportsQuality ? minQualityIdx : undefined);
    return { blob, quality: minQualityIdx, width: tiny.w, height: tiny.h, exceededTarget: true };
  };

  const processConvert = async () => {
    if (!images.length) return notify('Choose one or more images first.', 'error');
    setProcessing(true);
    setProgress(0);
    const mime = mimeFor(format);
    try {
      for (let i = 0; i < images.length; i += 1) {
        const { file, id } = images[i];
        const bitmap = await decodeImage(file);
        const originalSize = file.size || 1;
        const percentGoal = Math.min(100, Math.max(1, targetSize));
        const percentBytes = originalSize * (percentGoal / 100);
        // A blank or unparseable limit means "no absolute cap" rather than an
        // error, so the percentage slider alone drives the result.
        const limitBytes = unitBytesOf(targetFileSize, targetUnit);
        if (String(targetFileSize).trim() && limitBytes <= 0) {
          throw new Error('Enter a valid target file size limit in KB or MB (for example 100 KB or 0.5 MB).');
        }
        const targetBytes = limitBytes >= 1 ? Math.min(percentBytes, limitBytes) : percentBytes;
        if (!isFinite(targetBytes) || targetBytes < 1) {
          throw new Error('Enter a valid target file size limit in KB or MB (for example 100 KB or 0.5 MB).');
        }
        const preset = compressionModes.find((mode) => mode.id === compressionMode) || compressionModes[0];
        const sliderCeiling = compressionMode === 'lossless' ? 1 : Math.min(1, Math.max(0.55, quality / 100));
        const maxQuality = mime === 'image/png' ? 1 : Math.min(preset.maxQuality, sliderCeiling);

        const { blob, width, height, exceededTarget } = await compressToTarget(bitmap, mime, targetBytes, {
          minQuality: preset.minQuality,
          maxQuality,
          allowDownscale: compressionMode !== 'lossless',
          keepFullSize: compressionMode === 'recommended',
        });
        if (!blob) throw new Error('Image export failed');

        // The encoder can fall back to JPEG, so name the file from what was
        // actually produced rather than from the requested format.
        const actualFormat = blob.type === 'image/png' ? 'PNG' : blob.type === 'image/webp' ? 'WEBP' : 'JPEG';
        const extension = actualFormat === 'JPEG' ? 'jpg' : actualFormat.toLowerCase();
        const outputName = `${file.name.replace(/\.[^.]+$/, '')}_converted.${extension}`;
        if (user) await saveFileToDatabase(blob, outputName, { operation: 'convert', sourceFile: file.name, outputFormat: actualFormat, quality }).catch(() => {});
        recordActivity('convert', file.name);
        downloadBlob(blob, outputName);
        setResults((current) => ({ ...current, [id]: { targetBytes, actualSize: blob.size, width, height, exceededTarget } }));
        setProgress(i + 1);
      }
      const fellBack = format === 'WEBP' && !webpEncoderUsable;
      notify(
        fellBack
          ? `${images.length} image${images.length === 1 ? '' : 's'} saved as JPG. This browser could not encode WebP, so JPG was used instead.`
          : `${images.length} image${images.length === 1 ? '' : 's'} downloaded.`,
      );
    } catch (err) {
      console.error(err);
      notify(err.message || 'An image could not be converted in this browser.', 'error');
      recordActivity('convert', images[0]?.file?.name || 'image', 'Failed');
    } finally {
      setProcessing(false);
      setProgress(0);
    }
  };

  const processResize = async () => {
    if (!images.length) return notify('Choose one or more images first.', 'error');
    setProcessing(true);
    setProgress(0);
    const mime = mimeFor(format);
    // Blank means no cap, which keeps the plain resize path from erroring out.
    const targetBytes = resizeType === 'size' ? unitBytesOf(targetFileSize, targetUnit) : null;
    const compressing = targetBytes != null && targetBytes >= 1;
    try {
      if (resizeType === 'size' && String(targetFileSize).trim() && (!isFinite(targetBytes) || targetBytes < 1)) {
        throw new Error('Enter a valid maximum file size in KB or MB (for example 100 KB or 0.5 MB).');
      }
      for (let i = 0; i < images.length; i += 1) {
        const { file, id } = images[i];
        const bitmap = await decodeImage(file);
        let w = bitmap.width;
        let h = bitmap.height;
        let blob = null;
        if (targetBytes != null && targetBytes >= 1) {
          const out = await compressToTarget(bitmap, mime, targetBytes, {
            minQuality: 0.82,
            maxQuality: format === 'PNG' ? 1 : 0.95,
            keepFullSize: true,
          });
          blob = out.blob;
          w = out.width;
          h = out.height;
        } else {
          if (resizeType === 'percent') {
            const factor = Math.max(1, Number(percent) || 100) / 100;
            w = Math.max(1, Math.round(w * factor));
            h = Math.max(1, Math.round(h * factor));
          } else {
            const targetW = Number(width) || 0;
            const targetH = Number(height) || 0;
            if (targetW || targetH) {
              if (keepAspect) {
                const ratio = bitmap.width / bitmap.height;
                if (targetW && !targetH) {
                  w = targetW;
                  h = Math.max(1, Math.round(targetW / ratio));
                } else if (targetH && !targetW) {
                  h = targetH;
                  w = Math.max(1, Math.round(targetH * ratio));
                } else {
                  w = targetW;
                  h = targetH;
                }
              } else {
                w = targetW || bitmap.width;
                h = targetH || bitmap.height;
              }
            }
          }
          blob = await encodeCanvas(bitmap, w, h, mime, format === 'PNG' ? undefined : 0.94);
        }
        if (!blob) throw new Error('Resize failed.');
        // Name from the bytes actually produced; the encoder can fall back to JPEG.
        const actualFormat = blob.type === 'image/png' ? 'png' : blob.type === 'image/webp' ? 'webp' : 'jpg';
        const outputName = `${file.name.replace(/\.[^.]+$/, '')}_${w}x${h}.${actualFormat}`;
        if (user) await saveFileToDatabase(blob, outputName, { operation: 'resize', sourceFile: file.name, width: w, height: h }).catch(() => {});
        recordActivity('resize', file.name);
        downloadBlob(blob, outputName);
        setResults((current) => ({ ...current, [id]: { targetBytes: compressing ? targetBytes : null, actualSize: blob.size, width: w, height: h } }));
        setProgress(i + 1);
      }
      notify(`${images.length} image${images.length === 1 ? '' : 's'} ${compressing ? 'compressed' : 'resized'} and downloaded.`);
    } catch (err) {
      console.error(err);
      notify(err.message || 'A resize failed.', 'error');
    } finally {
      setProcessing(false);
      setProgress(0);
    }
  };

  const processToPdf = async () => {
    if (!images.length) return notify('Choose one or more images first.', 'error');
    setProcessing(true);
    try {
      const bytes = await imagesToPdf(images.map((item) => item.file), {
        pageSize,
        orientation,
        margin: Number(margin) || 0,
      });
      const blob = new Blob([bytes], { type: 'application/pdf' });
      const outputName = `${images[0].file.name.replace(/\.[^.]+$/, '')}_${images.length > 1 ? `and-${images.length}more-` : ''}images.pdf`;
      if (user) await saveFileToDatabase(blob, outputName, { operation: 'images-to-pdf', pageSize, orientation, sourceFiles: images.map((item) => item.file.name) }).catch(() => {});
      recordActivity('images-to-pdf', outputName);
      downloadBlob(blob, outputName);
      notify('Images converted to PDF successfully.');
    } catch (err) {
      console.error(err);
      notify(err.message || 'Could not create the PDF.', 'error');
    } finally {
      setProcessing(false);
    }
  };

  const run = () => {
    if (tool === 'resize') return processResize();
    if (tool === 'makepdf') return processToPdf();
    return processConvert();
  };

  const runLabel = tool === 'resize'
    ? (resizeType === 'size' ? 'Compress images' : 'Resize images')
    : tool === 'makepdf' ? 'Create PDF' : 'Convert images';

  return (
    <div>
      <div className="panel-heading">
        <div>
          <p className="section-kicker">IMAGE STUDIO</p>
          <h2>Prepare your images</h2>
          <p>Convert, compress, resize, or combine images into a PDF — right in this browser.</p>
        </div>
        <span className="count">{images.length} files</span>
      </div>

      <div className="mini-tabs" role="tablist" aria-label="Image studio tools">
        {studioTools.map((item) => (
          <button key={item.id} role="tab" aria-selected={tool === item.id} className={tool === item.id ? 'mini-tab active' : 'mini-tab'} onClick={() => setTool(item.id)}>
            <item.icon size={16} /> {item.label}
          </button>
        ))}
      </div>

      {tool === 'convert' && (
        <div className="compression-panel">
          {compressionModes.map((mode, index) => (
            <motion.button
              key={mode.id}
              type="button"
              layout
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              whileHover={{ y: -3, transition: { duration: 0.2 } }}
              whileTap={{ scale: 0.985 }}
              transition={{ duration: 0.42, delay: index * 0.08, ease: 'easeOut' }}
              className={`compression-option ${compressionMode === mode.id ? 'active' : ''}`}
              onClick={() => setCompressionMode(mode.id)}
              aria-pressed={compressionMode === mode.id}
            >
              <span className="compression-radio"><span className="compression-radio-dot" /></span>
              <span className="compression-copy">
                <span className="compression-label-row">
                  <span className="compression-label">{mode.label}</span>
                  {compressionMode === mode.id && <span className="compression-badge">{mode.badge}</span>}
                </span>
                <span className="compression-description">{mode.description}</span>
              </span>
            </motion.button>
          ))}
          <div className="compression-option compact-panel compact-row">
            <span className="compression-label">Target file size limit</span>
            {targetSizeField()}
          </div>
          <p className="resize-hint">Leave the size limit blank to keep full resolution. The 100% setting keeps the original pixel dimensions and re-encodes at the highest quality that still fits, so the image stays sharp. Drop lower only if you want a smaller file, and use PNG for the smallest file with no visible loss.</p>
          <div className="compression-option compact-panel range-panel">
            <div className="range-line"><span className="compression-label">Target file size (percentage of original)</span><span className="range-value-box">{targetSize}%</span></div>
            <div className="range-wrapper">
              <input type="range" min="1" max="100" value={targetSize} onChange={(event) => setTargetSize(Number(event.target.value))} style={{ '--percent': `${targetSize}%` }} />
              <div className="range-scale"><span>1%</span><span>25%</span><span>50%</span><span>75%</span><span>100%</span></div>
            </div>
          </div>
          <div className="compression-option compact-panel range-panel quality-panel">
            <div className="range-line"><span className="compression-label">Quality</span><span className="range-value-box">{quality}%</span></div>
            <div className="range-wrapper quality-range">
              <input type="range" min="5" max="100" value={quality} onChange={(event) => setQuality(Number(event.target.value))} style={{ '--percent': `${quality}%` }} />
              <div className="range-scale"><span>5%</span><span>25%</span><span>50%</span><span>75%</span><span>100%</span></div>
            </div>
          </div>
        </div>
      )}

      {tool === 'resize' && (
        <div className="compression-panel resize-panel">
          <div className="resize-controls">
            <div className="segmented">
              <button className={resizeType === 'percent' ? 'active' : ''} onClick={() => setResizeType('percent')}>Scale (%)</button>
              <button className={resizeType === 'px' ? 'active' : ''} onClick={() => setResizeType('px')}>Exact pixels</button>
              <button className={resizeType === 'size' ? 'active' : ''} onClick={() => setResizeType('size')}>Max size</button>
            </div>
            {resizeType === 'percent' ? (
              <div className="compression-option compact-panel range-panel">
                <div className="range-line"><span className="compression-label">Scale</span><span className="range-value-box">{percent}%</span></div>
                <div className="range-wrapper">
                  <input type="range" min="1" max="400" value={percent} onChange={(event) => setPercent(Number(event.target.value))} style={{ '--percent': `${(percent / 400) * 100}%` }} />
                  <div className="range-scale"><span>1%</span><span>100%</span><span>200%</span><span>400%</span></div>
                </div>
              </div>
            ) : resizeType === 'px' ? (
              <div className="resize-px">
                <label>Width (px)<input type="number" min="1" value={width} placeholder="auto" onChange={(event) => setWidth(event.target.value)} /></label>
                <label>Height (px)<input type="number" min="1" value={height} placeholder="auto" onChange={(event) => setHeight(event.target.value)} /></label>
                <label className="aspect-toggle"><input type="checkbox" checked={keepAspect} onChange={(event) => setKeepAspect(event.target.checked)} /> Keep aspect ratio</label>
              </div>
            ) : (
              <div className="compression-option compact-panel compact-row">
                <span className="compression-label">Maximum file size</span>
                {targetSizeField()}
              </div>
            )}
          </div>
          <div className="format-picker output-picker" role="group" aria-label="Output format">
            <span>Output format</span>
            <div className="format-buttons">{outputTypes.map((type) => <button key={type} type="button" className={format === type ? 'format-button selected' : 'format-button'} onClick={() => setFormat(type)} aria-pressed={format === type}><span className="format-label">{type === 'JPEG' ? 'JPG' : type}</span></button>)}</div>
          </div>
        </div>
      )}

      {tool === 'makepdf' && (
        <div className="compression-panel resize-panel">
          <div className="resize-px grid-3">
            <label>Page size
              <select value={pageSize} onChange={(event) => setPageSize(event.target.value)}>
                <option value="auto">Fit image</option>
                <option value="A4">A4</option>
                <option value="Letter">Letter</option>
              </select>
            </label>
            <label>Orientation
              <select value={orientation} onChange={(event) => setOrientation(event.target.value)}>
                <option value="auto">Automatic</option>
                <option value="portrait">Portrait</option>
                <option value="landscape">Landscape</option>
              </select>
            </label>
            <label>Margin (px)<input type="number" min="0" max="200" value={margin} onChange={(event) => setMargin(event.target.value)} /></label>
          </div>
          <p className="resize-hint">Every selected image becomes one page in a single PDF, in upload order.</p>
        </div>
      )}

      <input ref={inputRef} hidden type="file" accept="image/*" multiple onChange={addImages} />

      <div className="image-list">
        <div className="pdf-upload-card image-upload-card" onClick={() => inputRef.current?.click()}>
          <div className="upload-icon-wrap"><ImagePlus size={54} /></div>
          <div className="upload-text">Drop images here or click to upload</div>
          <button type="button" className="pdf-select-button" onClick={(event) => { event.stopPropagation(); inputRef.current?.click(); }}><ImagePlus size={18} /> Choose images</button>
        </div>
        {images.length > 0 && (
          <div className="selected-images">
            {images.map(({ file, id }) => (
              <div className="file-row" key={id}>
                <ImagePlus className="file-icon" size={20} />
                <span className="file-name">{file.name}</span>
                <span className="file-size" title={`Exact size: ${exactFileSize(file.size)}`}>
                  <strong>{formatBytes(file.size)}</strong>
                  <small>{exactFileSize(file.size)}</small>
                  {results[id] && (
                    <small className="file-result">
                      {results[id].targetBytes != null && <><b>Target:</b> {formatBytes(results[id].targetBytes)} | </>}
                      <b>Actual:</b> {formatBytes(results[id].actualSize)} · {results[id].width}×{results[id].height}
                      {results[id].exceededTarget && <em> · kept full size to protect quality</em>}
                    </small>
                  )}
                </span>
                <button className="row-button danger" onClick={() => setImages((current) => current.filter((item) => item.id !== id))} aria-label={`Remove ${file.name}`}><X size={15} /></button>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="action-bar image-action-bar">
        <span>{processing ? `Processing image ${progress + 1} of ${images.length}...` : "Exports are downloaded to your browser's download folder."}</span>
        <button className="primary-button" onClick={run} disabled={processing}>
          {processing ? <><span className="loading-spinner" aria-hidden="true" /> Working...</> : <><Check size={17} /> {runLabel}</>}
        </button>
      </div>
    </div>
  );
}

export default ImageStudio;