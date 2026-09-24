import React, { useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { Check, FilePlus2, ImagePlus, Scissors, X } from 'lucide-react';
import { downloadBlob, exactFileSize, formatBytes, recordActivity, saveFileToDatabase } from '../lib/util';
import { imagesToPdf } from '../lib/pdfTools';

const outputTypes = ['JPEG', 'PNG', 'WEBP'];
const compressionModes = [
  { id: 'recommended', label: 'Recommended compression', description: 'Good quality, good compression', badge: 'RECOMMENDED' },
  { id: 'extreme', label: 'Extreme compression', description: 'Lower quality, high compression', badge: 'BEST COMPRESSION' },
  { id: 'lossless', label: 'Lossless compression', description: 'Preserve image quality', badge: 'LOSSLESS' },
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
  const [targetSize, setTargetSize] = useState(60);
  const [targetFileSize, setTargetFileSize] = useState('500');
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

  const encodeCanvas = (bitmap, w, h, mime, quality) =>
    new Promise((resolve) => {
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(w));
      canvas.height = Math.max(1, Math.round(h));
      const ctx = canvas.getContext('2d');
      if (!ctx) return resolve(null);
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      canvas.toBlob((out) => resolve(out), mime, quality);
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
  // target size, and only when quality alone is not enough shinks the dimensions
  // (preserving aspect ratio) while re-running the quality search at each size.
  const compressToTarget = async (bitmap, mime, targetBytes, opts = {}) => {
    const supportsQuality = mime !== 'image/png';
    const minQualityIdx = Math.max(0.05, Math.min(0.9, Number(opts.minQuality) || 0.35));
    const maxQualityIdx = Math.max(minQualityIdx, Number(opts.maxQuality) || 0.95);
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

    const tiny = dimsAt(0);
    const blob = await encodeCanvas(bitmap, tiny.w, tiny.h, mime, supportsQuality ? minQualityIdx : undefined);
    return { blob, quality: minQualityIdx, width: tiny.w, height: tiny.h };
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
        const targetBytes = Math.min(originalSize * (percentGoal / 100), unitBytesOf(targetFileSize, targetUnit));
        if (!isFinite(targetBytes) || targetBytes < 1) {
          throw new Error('Enter a valid target file size limit in KB or MB (for example 100 KB or 0.5 MB).');
        }
        const maxQuality = compressionMode === 'lossless' ? 1 : Math.min(1, Math.max(0.55, quality / 100));

        const { blob, width, height } = await compressToTarget(bitmap, mime, targetBytes, {
          minQuality: 0.35,
          maxQuality: mime === 'image/png' ? 1 : maxQuality,
        });
        if (!blob) throw new Error('Image export failed');

        const extension = format.toLowerCase().replace('jpeg', 'jpg');
        const outputName = `${file.name.replace(/\.[^.]+$/, '')}_converted.${extension}`;
        if (user) await saveFileToDatabase(blob, outputName, { operation: 'convert', sourceFile: file.name, outputFormat: format, quality }).catch(() => {});
        recordActivity('convert', file.name);
        downloadBlob(blob, outputName);
        setResults((current) => ({ ...current, [id]: { targetBytes, actualSize: blob.size, width, height } }));
        setProgress(i + 1);
      }
      notify(`${images.length} image${images.length === 1 ? '' : 's'} downloaded.`);
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
    const extension = format.toLowerCase().replace('jpeg', 'jpg');
    const targetBytes = resizeType === 'size' ? unitBytesOf(targetFileSize, targetUnit) : null;
    try {
      if (targetBytes != null && (!isFinite(targetBytes) || targetBytes < 1)) {
        throw new Error('Enter a valid maximum file size in KB or MB (for example 100 KB or 0.5 MB).');
      }
      for (let i = 0; i < images.length; i += 1) {
        const { file, id } = images[i];
        const bitmap = await decodeImage(file);
        let w = bitmap.width;
        let h = bitmap.height;
        let blob = null;
        if (targetBytes != null) {
          const out = await compressToTarget(bitmap, mime, targetBytes, {
            minQuality: 0.35,
            maxQuality: format === 'PNG' ? 1 : 0.95,
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
        const outputName = `${file.name.replace(/\.[^.]+$/, '')}_${w}x${h}.${extension}`;
        if (user) await saveFileToDatabase(blob, outputName, { operation: 'resize', sourceFile: file.name, width: w, height: h }).catch(() => {});
        recordActivity('resize', file.name);
        downloadBlob(blob, outputName);
        setResults((current) => ({ ...current, [id]: { targetBytes, actualSize: blob.size, width: w, height: h } }));
        setProgress(i + 1);
      }
      notify(`${images.length} image${images.length === 1 ? '' : 's'} ${targetBytes != null ? 'compressed' : 'resized'} and downloaded.`);
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