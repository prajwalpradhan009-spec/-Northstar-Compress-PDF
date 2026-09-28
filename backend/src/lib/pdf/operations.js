const {
  PDFDocument,
  StandardFonts,
  degrees,
  rgb,
  setTextRenderingMode,
  TextRenderingMode,
} = require('pdf-lib');

const {
  PdfError,
  badRequest,
  assertLooksLikePdf,
  assertLooksLikeImage,
  parsePageSelection,
  loadWithPdfLib,
  loadWithPdfJs,
  renderPageToBuffer,
  extractTextPerPage,
  stripPdfInfo,
  safeBaseName,
} = require('./core');

const SAVE_OPTIONS = { useObjectStreams: true, addDefaultPage: false, objectsPerTick: 50 };

/* ================================================================== *
 * 1. Merge PDF
 * ================================================================== */

async function mergePdf(inputs) {
  if (!inputs.length) throw badRequest('Select at least one PDF to merge.');
  if (inputs.length < 2) throw badRequest('Select at least two PDFs to merge.');

  const merged = await PDFDocument.create();
  merged.setTitle('Merged Document');
  merged.setProducer('Northstar');
  let pageTotal = 0;

  for (const { buffer, name } of inputs) {
    assertLooksLikePdf(buffer, name);
    const source = await loadWithPdfLib(buffer, { label: name });
    const copied = await merged.copyPages(source, source.getPageIndices());
    copied.forEach((page) => merged.addPage(page));
    pageTotal += copied.length;
  }

  if (!pageTotal) throw badRequest('The selected PDFs do not contain any pages.');
  return { bytes: Buffer.from(await merged.save(SAVE_OPTIONS)), pageCount: pageTotal, fileCount: inputs.length };
}

/* ================================================================== *
 * 2. Compress PDF
 * ================================================================== */

const COMPRESSION_LEVELS = {
  low: { scale: 0.6, quality: 42, label: 'Low' },
  medium: { scale: 1, quality: 62, label: 'Medium' },
  high: { scale: 1.4, quality: 78, label: 'High' },
};

async function compressPdf(buffer, level = 'medium', { maxPages, onProgress } = {}) {
  assertLooksLikePdf(buffer);
  const profile = COMPRESSION_LEVELS[String(level).toLowerCase()];
  if (!profile) throw badRequest('Compression level must be low, medium or high.');

  const { doc, task, pdfjs } = await loadWithPdfJs(buffer, { maxPages });
  const pageCount = doc.numPages;
  const out = await PDFDocument.create();
  out.setProducer('Northstar');
  out.setCreator('Northstar');

  try {
    for (let n = 1; n <= pageCount; n += 1) {
      const { buffer: jpeg } = await renderPageToBuffer(pdfjs, doc, n, {
        scale: profile.scale,
        format: 'jpg',
        quality: profile.quality,
      });
      const image = await out.embedJpg(jpeg);
      // Match the visual page size to the source so the result prints correctly.
      const page = await doc.getPage(n);
      const base = page.getViewport({ scale: 1 });
      const target = out.addPage([Math.max(1, base.width), Math.max(1, base.height)]);
      const fit = Math.min(base.width / image.width, base.height / image.height);
      const drawW = image.width * fit;
      const drawH = image.height * fit;
      target.drawImage(image, {
        x: (base.width - drawW) / 2,
        y: (base.height - drawH) / 2,
        width: drawW,
        height: drawH,
      });
      page.cleanup();
      if (onProgress) onProgress(n, pageCount);
    }
  } finally {
    await task.destroy().catch(() => {});
  }

  stripPdfInfo(out);
  const bytes = Buffer.from(await out.save(SAVE_OPTIONS));
  const originalSize = buffer.length;
  const savedPercent = originalSize ? Math.round((1 - bytes.length / originalSize) * 100) : 0;

  return {
    bytes,
    pageCount,
    level: profile.label,
    originalSize,
    compressedSize: bytes.length,
    savedPercent,
  };
}

/* ================================================================== *
 * 3. Split PDF
 * ================================================================== */

/** Group a sorted page list into contiguous runs: [1,2,3,6,7] -> [[1,2,3],[6,7]] */
function groupRuns(pages) {
  const groups = [];
  let run = [pages[0]];
  for (let i = 1; i < pages.length; i += 1) {
    if (pages[i] === pages[i - 1] + 1) run.push(pages[i]);
    else {
      groups.push(run);
      run = [pages[i]];
    }
  }
  groups.push(run);
  return groups;
}

async function splitPdf(buffer, ranges) {
  assertLooksLikePdf(buffer);
  const source = await loadWithPdfLib(buffer);
  const pageCount = source.getPageCount();

  const hasSelection = String(ranges ?? '').trim().length > 0;
  const pages = hasSelection ? parsePageSelection(ranges, pageCount) : Array.from({ length: pageCount }, (_, i) => i + 1);
  if (!pages.length) throw badRequest('No valid pages were selected to split.');

  // "every 1" means one file per page; otherwise each contiguous run becomes a file.
  const groups = hasSelection ? groupRuns(pages) : pages.map((page) => [page]);
  const files = [];

  for (const group of groups) {
    const doc = await PDFDocument.create();
    doc.setProducer('Northstar');
    const copied = await doc.copyPages(source, group.map((page) => page - 1));
    copied.forEach((page) => doc.addPage(page));
    const label = group.length > 1 ? `p${group[0]}-${group[group.length - 1]}` : `p${group[0]}`;
    files.push({
      name: `pages-${label}.pdf`,
      buffer: Buffer.from(await doc.save(SAVE_OPTIONS)),
      pages: group,
    });
  }

  return { files, pageCount, mode: hasSelection ? 'ranges' : 'every-page' };
}

/* ================================================================== *
 * 4. Organize PDF  (page order, removals, duplicates, rotations)
 * ================================================================== */

/**
 * Accepts the workspace page model from the UI:
 * [{ num, rotation, deleted, selected }] — order in the array is the final order.
 */
function buildPagePlan(rawPages, pageCount) {
  let plan;
  if (Array.isArray(rawPages) && rawPages.length) {
    plan = rawPages;
  } else {
    plan = Array.from({ length: pageCount }, (_, i) => ({ num: i + 1, rotation: 0, deleted: false }));
  }

  const kept = plan
    .map((entry, index) => ({
      num: Number(entry.num ?? entry.page ?? index + 1),
      rotation: Number(entry.rotation) || 0,
      order: index,
    }))
    .filter((entry) => !entry.deleted && entry.num >= 1 && entry.num <= pageCount)
    .sort((a, b) => a.order - b.order);

  if (!kept.length) throw badRequest('Every page was removed — keep at least one page to build the PDF.');
  return kept;
}

async function organizePdf(buffer, rawPages) {
  assertLooksLikePdf(buffer);
  const source = await loadWithPdfLib(buffer);
  const pageCount = source.getPageCount();
  const plan = buildPagePlan(rawPages, pageCount);
  const out = await PDFDocument.create();
  out.setProducer('Northstar');

  const copied = await out.copyPages(source, plan.map((entry) => entry.num - 1));
  copied.forEach((page, index) => {
    const rotation = ((plan[index].rotation % 360) + 360) % 360;
    const normalised = rotation === 90 || rotation === 180 || rotation === 270 ? rotation : 0;
    if (normalised) page.setRotation(degrees(normalised));
    out.addPage(page);
  });

  return { bytes: Buffer.from(await out.save(SAVE_OPTIONS)), pageCount: plan.length, sourcePageCount: pageCount };
}

/* ================================================================== *
 * 5. Rotate PDF
 * ================================================================== */

function normaliseAngle(value) {
  const angle = ((Math.round(Number(value) || 0) % 360) + 360) % 360;
  if (angle !== 90 && angle !== 180 && angle !== 270) {
    throw badRequest('Rotation must be 90, 180 or 270 degrees.');
  }
  return angle;
}

async function rotatePdf(buffer, { angle = 90, pages } = {}) {
  assertLooksLikePdf(buffer);
  const degreesToAdd = normaliseAngle(angle);
  const source = await loadWithPdfLib(buffer);
  const pageCount = source.getPageCount();
  const targets = new Set(pages && String(pages).trim().length ? parsePageSelection(pages, pageCount) : Array.from({ length: pageCount }, (_, i) => i + 1));

  const out = await PDFDocument.create();
  out.setProducer('Northstar');
  const copied = await out.copyPages(source, source.getPageIndices());
  copied.forEach((page, index) => {
    if (targets.has(index + 1)) {
      const current = page.getRotation().angle || 0;
      page.setRotation(degrees(((current + degreesToAdd) % 360 + 360) % 360));
    }
    out.addPage(page);
  });

  return { bytes: Buffer.from(await out.save(SAVE_OPTIONS)), pageCount, rotatedCount: targets.size, angle: degreesToAdd };
}

/* ================================================================== *
 * 6. Extract Pages
 * ================================================================== */

async function extractPages(buffer, pages) {
  assertLooksLikePdf(buffer);
  const source = await loadWithPdfLib(buffer);
  const pageCount = source.getPageCount();
  const selection = pages && String(pages).trim().length
    ? parsePageSelection(pages, pageCount, { allowEvery: false })
    : Array.from({ length: pageCount }, (_, i) => i + 1);
  if (!selection.length) throw badRequest('Select at least one page to extract.');

  const out = await PDFDocument.create();
  out.setProducer('Northstar');
  const copied = await out.copyPages(source, selection.map((page) => page - 1));
  copied.forEach((page) => out.addPage(page));

  return { bytes: Buffer.from(await out.save(SAVE_OPTIONS)), pages: selection, pageCount: selection.length };
}

/* ================================================================== *
 * 7. PDF to JPG/PNG
 * ================================================================== */

async function pdfToImages(buffer, { format = 'jpg', scale = 2, quality = 88, pages, maxPages } = {}) {
  assertLooksLikePdf(buffer);
  const normalisedFormat = String(format).toLowerCase() === 'png' ? 'png' : 'jpg';
  const { doc, task, pdfjs } = await loadWithPdfJs(buffer, { maxPages });
  const selection = pages && String(pages).trim().length
    ? parsePageSelection(pages, doc.numPages, { allowEvery: false })
    : Array.from({ length: doc.numPages }, (_, i) => i + 1);

  const files = [];
  try {
    for (const pageNumber of selection) {
      const rendered = await renderPageToBuffer(pdfjs, doc, pageNumber, {
        scale,
        format: normalisedFormat,
        quality,
      });
      const label = String(pageNumber).padStart(String(doc.numPages).length, '0');
      files.push({
        name: `page-${label}.${normalisedFormat}`,
        buffer: rendered.buffer,
        page: pageNumber,
        width: rendered.width,
        height: rendered.height,
      });
    }
  } finally {
    await task.destroy().catch(() => {});
  }

  if (!files.length) throw badRequest('No pages were selected for image export.');
  return { files, format: normalisedFormat, pageCount: selection.length };
}

/* ================================================================== *
 * 8. JPG/PNG to PDF
 * ================================================================== */

const PAGE_SIZES = { A4: [595.28, 841.89], Letter: [612, 792], Legal: [612, 1008], A3: [841.89, 1190.55] };

async function imagesToPdf(inputs, { pageSize = 'auto', orientation = 'auto', margin = 0 } = {}) {
  if (!inputs.length) throw badRequest('Select at least one image to convert.');
  const { createCanvas } = require('@napi-rs/canvas');

  const out = await PDFDocument.create();
  out.setProducer('Northstar');
  const safeMargin = Math.max(0, Math.min(200, Number(margin) || 0));

  for (const { buffer, name } of inputs) {
    assertLooksLikeImage(buffer, name);

    // Decode via canvas so every supported format (JPG/PNG/WebP/BMP/GIF/TIFF) works.
    const source = createCanvas(1, 1);
    const context = source.getContext('2d');
    const image = await decodeInto(context, buffer);
    if (!image || !image.width || !image.height) {
      throw new PdfError(422, `"${name}" could not be decoded as an image.`);
    }

    // Re-encode losslessly to PNG for embedding — pdf-lib cannot embed WebP/BMP/GIF.
    const embedW = Math.max(1, image.width);
    const embedH = Math.max(1, image.height);
    const raster = createCanvas(embedW, embedH);
    const rasterCtx = raster.getContext('2d');
    rasterCtx.fillStyle = '#ffffff';
    rasterCtx.fillRect(0, 0, embedW, embedH);
    rasterCtx.drawImage(image, 0, 0, embedW, embedH);
    const png = raster.toBuffer('image/png');
    const embedded = await out.embedPng(png);

    if (pageSize === 'auto' || !PAGE_SIZES[pageSize]) {
      const page = out.addPage([embedW + safeMargin * 2, embedH + safeMargin * 2]);
      page.drawImage(embedded, { x: safeMargin, y: safeMargin, width: embedW, height: embedH });
    } else {
      const [shortSide, longSide] = PAGE_SIZES[pageSize];
      const landscape = orientation === 'landscape' || (orientation === 'auto' && embedW > embedH);
      const pageW = orientation === 'portrait' ? shortSide : orientation === 'landscape' ? longSide : (landscape ? longSide : shortSide);
      const pageH = orientation === 'portrait' ? longSide : orientation === 'landscape' ? shortSide : (landscape ? shortSide : longSide);
      const boxW = Math.max(1, pageW - safeMargin * 2);
      const boxH = Math.max(1, pageH - safeMargin * 2);
      const fit = Math.min(boxW / embedW, boxH / embedH);
      const drawW = embedW * fit;
      const drawH = embedH * fit;
      const page = out.addPage([pageW, pageH]);
      page.drawImage(embedded, {
        x: (pageW - drawW) / 2,
        y: (pageH - drawH) / 2,
        width: drawW,
        height: drawH,
      });
    }
  }

  return { bytes: Buffer.from(await out.save(SAVE_OPTIONS)), pageCount: inputs.length, pageSize, orientation, margin: safeMargin };
}

/** @napi-rs/canvas exposes `loadImage`; older builds only have Canvas#loadImage. */
async function decodeInto(context, buffer) {
  const canvasModule = require('@napi-rs/canvas');
  if (typeof canvasModule.loadImage === 'function') {
    return canvasModule.loadImage(buffer);
  }
  if (typeof context.canvas.loadImage === 'function') {
    return context.canvas.loadImage(buffer);
  }
  throw new PdfError(500, 'The image decoder is unavailable on this server.');
}

/* ================================================================== *
 * 9. PDF to Text
 * ================================================================== */

async function pdfToText(buffer, { maxPages } = {}) {
  assertLooksLikePdf(buffer);
  const { doc, task, pdfjs } = await loadWithPdfJs(buffer, { maxPages });
  try {
    const pages = await extractTextPerPage(pdfjs, doc);
    const nonEmpty = pages.filter((page) => page.trim().length);
    const text = pages.map((page, index) => page.trim() ? page : '').join('\n\n').replace(/\n{3,}/g, '\n\n').trim();
    return {
      text,
      pages,
      pageCount: pages.length,
      pagesWithText: nonEmpty.length,
      hasText: nonEmpty.length > 0,
      characterCount: text.length,
    };
  } finally {
    await task.destroy().catch(() => {});
  }
}

/* ================================================================== *
 * 10. OCR  (real Tesseract recognition)
 * ================================================================== */

let tesseractPromise = null;
function getTesseract() {
  if (!tesseractPromise) tesseractPromise = import('tesseract.js');
  return tesseractPromise;
}

async function runOcr(buffer, { language = 'eng', maxPages = 30, scale = 2, onProgress } = {}) {
  assertLooksLikePdf(buffer);
  const { doc, task, pdfjs } = await loadWithPdfJs(buffer, { maxPages: maxPages + 0 });

  const { createWorker } = await getTesseract();
  let worker = null;
  const results = [];

  try {
    worker = await createWorker(language || 'eng');
    for (let n = 1; n <= doc.numPages; n += 1) {
      const rendered = await renderPageToBuffer(pdfjs, doc, n, { scale, format: 'png' });
      const { data } = await worker.recognize(rendered.buffer);
      const words = [];
      for (const block of data.blocks || []) {
        for (const paragraph of block.paragraphs || []) {
          for (const line of paragraph.lines || []) {
            for (const word of line.words || []) {
              if (!word.text || !word.text.trim()) continue;
              if (typeof word.confidence === 'number' && word.confidence < 30) continue;
              words.push({
                text: word.text,
                confidence: typeof word.confidence === 'number' ? Math.round(word.confidence) : null,
                bbox: word.bbox,
              });
            }
          }
        }
      }
      const text = String(data.text || '').trim();
      results.push({
        page: n,
        text,
        words,
        width: rendered.width,
        height: rendered.height,
        confidence: typeof data.confidence === 'number' ? Math.round(data.confidence) : null,
      });
      if (onProgress) onProgress(n, doc.numPages);
    }
  } catch (err) {
    if (err instanceof PdfError) throw err;
    throw new PdfError(503, `OCR could not be completed: ${(err && err.message) || 'the recognition engine failed'}.`);
  } finally {
    if (worker) await worker.terminate().catch(() => {});
    await task.destroy().catch(() => {});
  }

  if (!results.length) throw new PdfError(422, 'This PDF has no pages to recognise.');

  const fullText = results.map((entry) => entry.text).filter(Boolean).join('\n\n');
  const allWords = results.flatMap((entry) => entry.words);
  const confidences = allWords.map((word) => word.confidence).filter((value) => typeof value === 'number');
  const averageConfidence = confidences.length
    ? Math.round(confidences.reduce((sum, value) => sum + value, 0) / confidences.length)
    : null;

  return {
    text: fullText,
    pages: results,
    pageCount: results.length,
    wordCount: allWords.length,
    averageConfidence,
    hasText: allWords.length > 0,
    scale,
  };
}

/* ================================================================== *
 * 10b. Build a searchable PDF from OCR results
 * ================================================================== */

const OCR_FONT_SIZE = 10;

async function buildSearchablePdf(buffer, ocrPages, { scale = 2 } = {}) {
  assertLooksLikePdf(buffer);
  if (!Array.isArray(ocrPages) || !ocrPages.length) throw badRequest('There is no recognised text to add to the PDF.');

  const { doc, task, pdfjs } = await loadWithPdfJs(buffer);
  const out = await PDFDocument.create();
  out.setProducer('Northstar');
  out.setCreator('Northstar — OCR');
  const font = await out.embedFont(StandardFonts.Helvetica);

  try {
    for (const entry of ocrPages) {
      const pageNumber = Number(entry.page);
      if (!Number.isInteger(pageNumber) || pageNumber < 1 || pageNumber > doc.numPages) continue;

      const rendered = await renderPageToBuffer(pdfjs, doc, pageNumber, { scale, format: 'jpg', quality: 82 });
      const image = await out.embedJpg(rendered.buffer);
      const page = out.addPage([rendered.width, rendered.height]);
      page.drawImage(image, { x: 0, y: 0, width: rendered.width, height: rendered.height });

      // Invisible text layer: real glyphs at the OCR bounding boxes so the
      // result is selectable and searchable in any PDF reader.
      const perPage = Math.max(1, Math.round(rendered.width / (ocrPages[0].width || rendered.width)));
      const words = Array.isArray(entry.words) ? entry.words : [];
      page.pushOperators(setTextRenderingMode(TextRenderingMode.Invisible));
      for (const word of words) {
        const text = String(word.text || '').trim();
        if (!text || !word.bbox) continue;
        const x0 = Number(word.bbox.x0);
        const x1 = Number(word.bbox.x1);
        const y0 = Number(word.bbox.y0);
        const y1 = Number(word.bbox.y1);
        if (![x0, x1, y0, y1].every(Number.isFinite)) continue;
        const widthPx = Math.max(1, x1 - x0);
        const size = Math.max(1, Math.min(200, (widthPx / Math.max(1, text.length)) * 1.8));
        // PDF origin is bottom-left; Tesseract's origin is top-left.
        const y = rendered.height - y1 * perPage;
        const x = x0 * perPage;
        if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
        try {
          page.drawText(text, { x, y, size, font, color: rgb(0, 0, 0) });
        } catch {
          /* skip glyphs the standard font cannot encode */
        }
      }
      page.pushOperators(setTextRenderingMode(TextRenderingMode.Fill));
    }
  } finally {
    await task.destroy().catch(() => {});
  }

  if (out.getPageCount() === 0) throw new PdfError(422, 'The searchable PDF could not be generated.');
  return { bytes: Buffer.from(await out.save(SAVE_OPTIONS)), pageCount: out.getPageCount() };
}

/* ================================================================== *
 * 11. Watermark PDF
 * ================================================================== */

const POSITIONS = new Set(['center', 'top', 'bottom', 'diagonal', 'tile']);

function parseHexColor(value, fallback = [0.91, 0.35, 0.18]) {
  const raw = String(value || '').trim().replace('#', '');
  const hex = raw.length === 3 ? raw.split('').map((c) => c + c).join('') : raw;
  if (!/^[0-9a-f]{6}$/i.test(hex)) return fallback;
  const num = parseInt(hex, 16);
  return [((num >> 16) & 255) / 255, ((num >> 8) & 255) / 255, (num & 255) / 255];
}

async function watermarkPdf(buffer, options = {}) {
  assertLooksLikePdf(buffer);
  const {
    text = 'CONFIDENTIAL',
    fontSize = 48,
    angle,
    opacity = 0.18,
    color = '#e85a2e',
    position = 'diagonal',
    applyTo = 'all',
    pages,
    maxPages,
  } = options;

  const label = String(text || '').trim().slice(0, 60) || 'CONFIDENTIAL';
  const size = Math.max(8, Math.min(200, Number(fontSize) || 48));
  const alpha = Math.max(0.03, Math.min(1, Number(opacity) || 0.18));
  const [r, g, b] = parseHexColor(color);
  const placement = POSITIONS.has(position) ? position : 'diagonal';
  const scope = ['all', 'even', 'odd'].includes(applyTo) ? applyTo : 'all';

  const source = await loadWithPdfLib(buffer);
  const pageCount = source.getPageCount();
  const explicit = pages && String(pages).trim().length
    ? new Set(parsePageSelection(pages, pageCount, { allowEvery: false }))
    : null;

  const out = await PDFDocument.create();
  out.setProducer('Northstar');
  const font = await out.embedFont(StandardFonts.HelveticaBold);
  const copied = await out.copyPages(source, source.getPageIndices());

  copied.forEach((page, index) => {
    const pageNumber = index + 1;
    if (explicit ? !explicit.has(pageNumber) : (scope === 'even' && pageNumber % 2 !== 0) || (scope === 'odd' && pageNumber % 2 === 0)) {
      out.addPage(page);
      return;
    }

    const { width, height } = page.getSize();
    const baseSize = Math.max(10, Math.min(size, Math.min(width, height) * 0.35));
    const rotation = angle === undefined || angle === null || angle === ''
      ? (placement === 'diagonal' ? -30 : 0)
      : Math.max(-180, Math.min(180, Number(angle) || 0));

    const drawOne = (x, y) => {
      try {
        page.drawText(label, {
          x,
          y,
          size: baseSize,
          font,
          color: rgb(r, g, b),
          opacity: alpha,
          rotate: degrees(rotation),
        });
      } catch {
        /* skip glyphs the standard font cannot encode */
      }
    };

    if (placement === 'tile') {
      const stepX = Math.max(baseSize * 6, 120);
      const stepY = Math.max(baseSize * 4, 90);
      const radians = (rotation * Math.PI) / 180;
      const reach = Math.hypot(width, height);
      const cols = Math.ceil(reach / stepX) + 2;
      const rows = Math.ceil(reach / stepY) + 2;
      for (let row = -Math.floor(rows / 2); row <= Math.ceil(rows / 2); row += 1) {
        for (let col = -Math.floor(cols / 2); col <= Math.ceil(cols / 2); col += 1) {
          const ox = width / 2 + col * stepX;
          const oy = height / 2 + row * stepY;
          drawOne(ox + Math.sin(radians) * row * stepY * 0.2, oy + Math.cos(radians) * col * stepX * 0.2);
        }
      }
    } else if (placement === 'top') {
      drawOne(Math.max(12, (width - font.widthOfTextAtSize(label, baseSize)) / 2), height - baseSize * 1.6);
    } else if (placement === 'bottom') {
      drawOne(Math.max(12, (width - font.widthOfTextAtSize(label, baseSize)) / 2), baseSize);
    } else {
      const textWidth = font.widthOfTextAtSize(label, baseSize);
      const radians = (rotation * Math.PI) / 180;
      const cos = Math.abs(Math.cos(radians)) || 1e-6;
      const sin = Math.abs(Math.sin(radians));
      const boxW = textWidth * cos + baseSize * sin;
      const boxH = textWidth * sin + baseSize * cos;
      drawOne((width - boxW) / 2, (height - boxH) / 2);
    }

    out.addPage(page);
  });

  return { bytes: Buffer.from(await out.save(SAVE_OPTIONS)), pageCount, text: label, position: placement, applyTo: scope };
}

/* ================================================================== *
 * 12. Protect PDF  (password + permissions)
 * ================================================================== */

async function protectPdf(buffer, options = {}) {
  assertLooksLikePdf(buffer);
  const {
    userPassword = '',
    ownerPassword = '',
    allowPrint = true,
    allowCopy = true,
    allowFill = true,
    allowModify = false,
  } = options;

  const user = String(userPassword || '');
  const owner = String(ownerPassword || '') || user;
  if (!user && !String(ownerPassword || '')) {
    throw badRequest('Set an open password to protect this PDF.');
  }
  if (user && user.length < 4) throw badRequest('Use a password with at least 4 characters.');
  if (user.length > 127 || owner.length > 127) throw badRequest('Passwords are limited to 127 characters.');

  // Load without ignoreEncryption so pdf-lib can attach a fresh security handler.
  const { PDFDocument: PdfLibDocument } = require('pdf-lib');
  let doc;
  try {
    doc = await PdfLibDocument.load(buffer, {
      ignoreEncryption: false,
      throwOnInvalidObject: false,
      capNumbers: true,
      updateMetadata: false,
    });
  } catch (err) {
    if (err && (err.name === 'EncryptedPDFError' || /encrypted/i.test(String(err.message)))) {
      throw new PdfError(422, 'This PDF is already password-protected. Remove the existing password first.');
    }
    throw new PdfError(422, 'This PDF could not be read and cannot be protected.');
  }

  doc.encrypt({
    userPassword: user,
    ownerPassword: owner,
    permissions: {
      printing: allowPrint ? 'highResolution' : 'none',
      modifying: allowModify ? 'lowQuality' : 'none',
      copying: !!allowCopy,
      annotating: !!allowFill,
      fillingForms: !!allowFill,
      contentAccessibility: true,
      documentAssembly: !!allowModify,
    },
  });

  return {
    bytes: Buffer.from(await doc.save({ useObjectStreams: true })),
    pageCount: doc.getPageCount(),
    permissions: { printing: allowPrint, copying: allowCopy, forms: allowFill, modifying: allowModify },
  };
}

module.exports = {
  mergePdf,
  compressPdf,
  splitPdf,
  organizePdf,
  rotatePdf,
  extractPages,
  pdfToImages,
  imagesToPdf,
  pdfToText,
  runOcr,
  buildSearchablePdf,
  watermarkPdf,
  protectPdf,
  COMPRESSION_LEVELS,
  groupRuns,
  saveNameFor,
};

function saveNameFor(originalName, suffix, extension = 'pdf') {
  return `${safeBaseName(originalName)}${suffix}.${extension}`;
}
