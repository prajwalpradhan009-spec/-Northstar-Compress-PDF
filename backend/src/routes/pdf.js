const express = require('express');
const config = require('../../config/env');
const { PdfError, badRequest } = require('../lib/pdf/core');
const ops = require('../lib/pdf/operations');
const { buildZip } = require('../lib/pdf/zip');
const {
  uploadPdf,
  uploadPdfs,
  uploadImages,
  guard,
  requireFile,
  requireFiles,
  toInput,
  requestedBaseName,
} = require('../middleware/upload');

const router = express.Router();

/* ------------------------------------------------------------------ *
 * Response helpers
 * ------------------------------------------------------------------ */

/** Small JSON blob describing the result, sent as a header alongside binaries. */
function meta(res, data) {
  const encoded = encodeURIComponent(JSON.stringify(data));
  if (encoded.length < 7000) res.set('X-Result-Meta', encoded);
  return res;
}

function sendFile(res, buffer, filename, contentType) {
  res.setHeader('Content-Type', contentType);
  res.setHeader('Content-Length', buffer.length);
  res.setHeader('Content-Disposition', `attachment; filename="${filename.replace(/"/g, '')}"`);
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.end(buffer);
}

const PDF_MIME = 'application/pdf';
const ZIP_MIME = 'application/zip';

const baseNameOf = (req, fallback) => {
  const raw = requestedBaseName(req);
  if (!raw) return fallback;
  return raw.replace(/\.[^.]+$/, '').replace(/[^a-zA-Z0-9 _-]/g, '').trim().slice(0, 80) || fallback;
};

/** Wrap an async handler so thrown PdfErrors become clean JSON responses. */
function route(handler) {
  return (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
}

function asBoolean(value, fallback = false) {
  if (value === undefined || value === null || value === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(String(value).toLowerCase());
}

function asInteger(value, fallback) {
  const num = Number(value);
  return Number.isFinite(num) ? Math.round(num) : fallback;
}

function parsePageModel(raw) {
  if (!raw) return null;
  if (Array.isArray(raw)) return raw;
  try {
    const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    throw badRequest('The page list could not be read. Reload the page and try again.');
  }
}

/* ------------------------------------------------------------------ *
 * 1. POST /api/pdf/merge
 * ------------------------------------------------------------------ */

router.post('/merge', guard(uploadPdfs), route(async (req, res) => {
  const files = requireFiles(req, 'files');
  const result = await ops.mergePdf(files.map(toInput));
  meta(res, { pageCount: result.pageCount, fileCount: result.fileCount, size: result.bytes.length });
  sendFile(res, result.bytes, `${baseNameOf(req, 'document')}_merged.pdf`, PDF_MIME);
}));

/* ------------------------------------------------------------------ *
 * 2. POST /api/pdf/compress
 * ------------------------------------------------------------------ */

router.post('/compress', guard(uploadPdf), route(async (req, res) => {
  const file = requireFile(req);
  const result = await ops.compressPdf(file.buffer, req.body.level || req.body.quality || 'medium', {
    maxPages: config.pdf.maxPages,
  });
  meta(res, {
    pageCount: result.pageCount,
    level: result.level,
    originalSize: result.originalSize,
    compressedSize: result.compressedSize,
    savedPercent: result.savedPercent,
  });
  sendFile(res, result.bytes, `${baseNameOf(req, file.originalname)}_compressed.pdf`, PDF_MIME);
}));

/* ------------------------------------------------------------------ *
 * 3. POST /api/pdf/split
 * ------------------------------------------------------------------ */

router.post('/split', guard(uploadPdf), route(async (req, res) => {
  const file = requireFile(req);
  const result = await ops.splitPdf(file.buffer, req.body.ranges || req.body.pages || '');
  const base = baseNameOf(req, file.originalname);

  if (result.files.length === 1) {
    const only = result.files[0];
    meta(res, { fileCount: 1, pageCount: only.pages.length, pages: only.pages, size: only.buffer.length });
    sendFile(res, only.buffer, `${base}_split_${only.pages[0]}-${only.pages[only.pages.length - 1]}.pdf`, PDF_MIME);
    return;
  }

  const zip = await buildZip(result.files, { prefix: `${base}_split` });
  meta(res, { fileCount: result.files.length, pageCount: result.pageCount, mode: result.mode, size: zip.length });
  sendFile(res, zip, `${base}_split_${result.files.length}_files.zip`, ZIP_MIME);
}));

/* ------------------------------------------------------------------ *
 * 4. POST /api/pdf/organize
 * ------------------------------------------------------------------ */

router.post('/organize', guard(uploadPdf), route(async (req, res) => {
  const file = requireFile(req);
  const pages = parsePageModel(req.body.pages);
  const result = await ops.organizePdf(file.buffer, pages);
  meta(res, { pageCount: result.pageCount, sourcePageCount: result.sourcePageCount, size: result.bytes.length });
  sendFile(res, result.bytes, `${baseNameOf(req, file.originalname)}_organized.pdf`, PDF_MIME);
}));

/* ------------------------------------------------------------------ *
 * 5. POST /api/pdf/rotate
 * ------------------------------------------------------------------ */

router.post('/rotate', guard(uploadPdf), route(async (req, res) => {
  const file = requireFile(req);
  const result = await ops.rotatePdf(file.buffer, {
    angle: req.body.angle || 90,
    pages: req.body.pages || req.body.ranges || '',
  });
  meta(res, {
    pageCount: result.pageCount,
    rotatedCount: result.rotatedCount,
    angle: result.angle,
    size: result.bytes.length,
  });
  sendFile(res, result.bytes, `${baseNameOf(req, file.originalname)}_rotated.pdf`, PDF_MIME);
}));

/* ------------------------------------------------------------------ *
 * 6. POST /api/pdf/extract
 * ------------------------------------------------------------------ */

router.post('/extract', guard(uploadPdf), route(async (req, res) => {
  const file = requireFile(req);
  const result = await ops.extractPages(file.buffer, req.body.pages || req.body.ranges || '');
  meta(res, { pageCount: result.pageCount, pages: result.pages, size: result.bytes.length });
  sendFile(res, result.bytes, `${baseNameOf(req, file.originalname)}_extracted.pdf`, PDF_MIME);
}));

/* ------------------------------------------------------------------ *
 * 7. POST /api/pdf/to-jpg
 * ------------------------------------------------------------------ */

router.post('/to-jpg', guard(uploadPdf), route(async (req, res) => {
  const file = requireFile(req);
  const format = String(req.body.format || 'jpg').toLowerCase() === 'png' ? 'png' : 'jpg';
  const scale = req.body.scale === undefined ? 2 : Math.max(0.2, Math.min(4, Number(req.body.scale) || 2));
  const result = await ops.pdfToImages(file.buffer, {
    format,
    scale,
    quality: Math.max(20, Math.min(98, asInteger(req.body.quality, 88))),
    pages: req.body.pages || req.body.ranges || '',
    maxPages: config.pdf.maxPages,
  });
  const base = baseNameOf(req, file.originalname);
  const ext = result.format === 'png' ? 'png' : 'jpg';

  if (result.files.length === 1) {
    const only = result.files[0];
    meta(res, {
      fileCount: 1,
      pageCount: 1,
      format: result.format,
      width: only.width,
      height: only.height,
      size: only.buffer.length,
    });
    sendFile(res, only.buffer, only.name, result.format === 'png' ? 'image/png' : 'image/jpeg');
    return;
  }

  const zip = await buildZip(result.files, { prefix: `${base}_${ext}` });
  meta(res, { fileCount: result.files.length, pageCount: result.pageCount, format: result.format, size: zip.length });
  sendFile(res, zip, `${base}_${result.pageCount}_images.zip`, ZIP_MIME);
}));

/* ------------------------------------------------------------------ *
 * 8. POST /api/pdf/from-jpg
 * ------------------------------------------------------------------ */

router.post('/from-jpg', guard(uploadImages), route(async (req, res) => {
  const files = requireFiles(req, 'files');
  const result = await ops.imagesToPdf(files.map(toInput), {
    pageSize: req.body.pageSize || 'auto',
    orientation: req.body.orientation || 'auto',
    margin: asInteger(req.body.margin, 0),
  });
  meta(res, { pageCount: result.pageCount, size: result.bytes.length, pageSize: result.pageSize });
  sendFile(res, result.bytes, `${baseNameOf(req, files[0].originalname)}_images.pdf`, PDF_MIME);
}));

/* ------------------------------------------------------------------ *
 * 9. POST /api/pdf/to-text
 * ------------------------------------------------------------------ */

router.post('/to-text', guard(uploadPdf), route(async (req, res) => {
  const file = requireFile(req);
  const result = await ops.pdfToText(file.buffer, { maxPages: config.pdf.maxPages });
  res.json({
    text: result.text,
    pages: result.pages,
    pageCount: result.pageCount,
    pagesWithText: result.pagesWithText,
    hasText: result.hasText,
    characterCount: result.characterCount,
    fileName: `${baseNameOf(req, file.originalname)}.txt`,
  });
}));

/* ------------------------------------------------------------------ *
 * 10. POST /api/pdf/ocr
 * ------------------------------------------------------------------ */

router.post('/ocr', guard(uploadPdf), route(async (req, res) => {
  const file = requireFile(req);
  const language = String(req.body.language || config.pdf.ocrLanguage).slice(0, 12);
  const includeSearchablePdf = asBoolean(req.body.searchablePdf, true);

  const result = await ops.runOcr(file.buffer, {
    language,
    maxPages: config.pdf.ocrMaxPages,
    scale: Math.max(1, Math.min(3, Number(req.body.scale) || 2)),
  });

  const base = baseNameOf(req, file.originalname);
  const payload = {
    text: result.text,
    pageCount: result.pageCount,
    wordCount: result.wordCount,
    averageConfidence: result.averageConfidence,
    hasText: result.hasText,
    textFileName: `${base}_ocr.txt`,
    pages: result.pages.map((entry) => ({ page: entry.page, confidence: entry.confidence, characterCount: entry.text.length })),
    searchablePdfBase64: null,
    searchablePdfName: null,
  };

  if (includeSearchablePdf) {
    const searchable = await ops.buildSearchablePdf(file.buffer, result.pages, { scale: 2 });
    payload.searchablePdfBase64 = searchable.bytes.toString('base64');
    payload.searchablePdfName = `${base}_searchable.pdf`;
  }

  res.json(payload);
}));

/* ------------------------------------------------------------------ *
 * 11. POST /api/pdf/watermark
 * ------------------------------------------------------------------ */

router.post('/watermark', guard(uploadPdf), route(async (req, res) => {
  const file = requireFile(req);
  const result = await ops.watermarkPdf(file.buffer, {
    text: req.body.text,
    fontSize: req.body.fontSize,
    angle: req.body.angle,
    opacity: req.body.opacity,
    color: req.body.color,
    position: req.body.position || 'diagonal',
    applyTo: req.body.applyTo || 'all',
    pages: req.body.pages || '',
    maxPages: config.pdf.maxPages,
  });
  meta(res, { pageCount: result.pageCount, position: result.position, applyTo: result.applyTo, size: result.bytes.length });
  sendFile(res, result.bytes, `${baseNameOf(req, file.originalname)}_watermarked.pdf`, PDF_MIME);
}));

/* ------------------------------------------------------------------ *
 * 12. POST /api/pdf/protect
 * ------------------------------------------------------------------ */

router.post('/protect', guard(uploadPdf), route(async (req, res) => {
  const file = requireFile(req);
  const result = await ops.protectPdf(file.buffer, {
    // Passwords are read, used to encrypt, and never logged or stored.
    userPassword: req.body.userPassword || '',
    ownerPassword: req.body.ownerPassword || '',
    allowPrint: asBoolean(req.body.allowPrint, true),
    allowCopy: asBoolean(req.body.allowCopy, true),
    allowFill: asBoolean(req.body.allowFill, true),
    allowModify: asBoolean(req.body.allowModify, false),
  });
  meta(res, { pageCount: result.pageCount, encrypted: true, size: result.bytes.length });
  sendFile(res, result.bytes, `${baseNameOf(req, file.originalname)}_protected.pdf`, PDF_MIME);
}));

/* ------------------------------------------------------------------ *
 * Capabilities + error handler
 * ------------------------------------------------------------------ */

router.get('/capabilities', (req, res) => {
  res.json({
    maxUploadBytes: config.pdf.maxUploadBytes,
    maxUploadMb: config.pdf.maxUploadMb,
    maxFiles: config.pdf.maxFiles,
    maxPages: config.pdf.maxPages,
    ocrMaxPages: config.pdf.ocrMaxPages,
    ocrLanguage: config.pdf.ocrLanguage,
    compressionLevels: Object.keys(ops.COMPRESSION_LEVELS),
  });
});

// eslint-disable-next-line no-unused-vars
router.use((err, req, res, next) => {
  if (err instanceof PdfError) {
    return res.status(err.status || 400).json({ error: err.message });
  }
  if (err && err.type === 'entity.too.large') {
    return res.status(413).json({ error: `That file is too large. The limit is ${config.pdf.maxUploadMb} MB.` });
  }
  if (err && err.type === 'entity.parse.failed') {
    return res.status(400).json({ error: 'The request could not be read. Please try again.' });
  }
  if (process.env.NODE_ENV !== 'production') {
    console.error('[pdf] unhandled error:', err && err.message);
  }
  return res.status(500).json({ error: 'The PDF could not be processed. Please try a different file.' });
});

module.exports = router;
