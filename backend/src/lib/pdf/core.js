const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

let pdfjsPromise = null;

/**
 * pdf.js is ESM-only. It is imported lazily and memoised so the CommonJS backend
 * can still `require` this module.
 */
async function getPdfjs() {
  if (!pdfjsPromise) {
    pdfjsPromise = import('pdfjs-dist/legacy/build/pdf.mjs').then((mod) => {
      const lib = mod.default && mod.default.getDocument ? mod.default : mod;
      lib.GlobalWorkerOptions.workerSrc = require.resolve('pdfjs-dist/legacy/build/pdf.worker.min.mjs');
      return lib;
    });
  }
  return pdfjsPromise;
}

function getStandardFontDataUrl() {
  try {
    const base = path.dirname(require.resolve('pdfjs-dist/package.json'));
    let url = `file:///${path.join(base, 'standard_fonts').replace(/\\/g, '/')}`;
    if (!url.endsWith('/')) url += '/';
    return url;
  } catch {
    return undefined;
  }
}

class PdfError extends Error {
  constructor(status, message) {
    super(message);
    this.name = 'PdfError';
    this.status = status;
    this.expose = true;
  }
}

const badRequest = (message) => new PdfError(400, message);

/* ------------------------------------------------------------------ *
 * Input validation
 * ------------------------------------------------------------------ */

const PDF_SIGNATURE = Buffer.from('%PDF-');

/** Confirm the bytes really are a PDF, not just a file with a .pdf name. */
function assertLooksLikePdf(buffer, label = 'file') {
  if (!buffer || !buffer.length) {
    throw badRequest(`The ${label} is empty.`);
  }
  // The header is allowed to appear anywhere in the first 1 KB per the PDF spec.
  const head = buffer.subarray(0, Math.min(buffer.length, 1024));
  if (!head.includes(PDF_SIGNATURE)) {
    throw new PdfError(415, `"${label}" is not a valid PDF file.`);
  }
  if (!buffer.subarray(Math.max(0, buffer.length - 2048)).includes(Buffer.from('%%EOF'))) {
    throw new PdfError(422, `"${label}" looks incomplete or corrupted.`);
  }
}

const IMAGE_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.webp', '.bmp', '.gif', '.tif', '.tiff', '.avif']);

function assertLooksLikeImage(buffer, label = 'file') {
  if (!buffer || !buffer.length) throw badRequest(`The ${label} is empty.`);
  const isPng = buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47;
  const isJpeg = buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
  const isGif = buffer.subarray(0, 3).toString('latin1') === 'GIF';
  const isBmp = buffer[0] === 0x42 && buffer[1] === 0x4d;
  const isRiff = buffer.subarray(0, 4).toString('latin1') === 'RIFF' && buffer.subarray(8, 12).toString('latin1') === 'WEBP';
  const isTiff = (buffer[0] === 0x49 && buffer[1] === 0x49 && buffer[2] === 0x2a) || (buffer[0] === 0x4d && buffer[1] === 0x4d && buffer[2] === 0x2a);
  if (!isPng && !isJpeg && !isGif && !isBmp && !isRiff && !isTiff) {
    throw new PdfError(415, `"${label}" is not a supported image (JPG, PNG, WebP, BMP, GIF or TIFF).`);
  }
  const ext = path.extname(label).toLowerCase();
  if (ext && !IMAGE_EXTENSIONS.has(ext)) {
    throw new PdfError(415, `"${label}" is not a supported image (JPG, PNG, WebP, BMP, GIF or TIFF).`);
  }
}

/* ------------------------------------------------------------------ *
 * Page-range parsing — shared by split / rotate / extract / to-jpg
 * ------------------------------------------------------------------ */

/**
 * Parse inputs such as "1-3, 7, 9-12" or "every 2" into a sorted, de-duplicated
 * list of 1-based page numbers clamped to the document length.
 */
function parsePageSelection(input, pageCount, { allowEvery = true } = {}) {
  const raw = Array.isArray(input) ? input.join(',') : String(input ?? '');
  const pages = new Set();

  for (const chunk of raw.split(/[,;\s]+/).map((part) => part.trim()).filter(Boolean)) {
    if (allowEvery) {
      const every = chunk.match(/^every\s*(\d+)$/i);
      if (every) {
        const step = Math.max(1, parseInt(every[1], 10));
        for (let p = 1; p <= pageCount; p += step) pages.add(p);
        continue;
      }
    }
    if (/^all$/i.test(chunk)) {
      for (let p = 1; p <= pageCount; p += 1) pages.add(p);
      continue;
    }
    const range = chunk.match(/^(\d+)\s*(?:-\s*(\d+))?$/);
    if (!range) {
      throw badRequest(`"${chunk}" is not a valid page or range. Use formats like 1-3, 5 or every 2.`);
    }
    const start = parseInt(range[1], 10);
    const end = range[2] ? parseInt(range[2], 10) : start;
    if (start < 1 || end < 1) throw badRequest('Page numbers start at 1.');
    if (start > pageCount) throw badRequest(`Page ${start} does not exist — this document has ${pageCount} page${pageCount === 1 ? '' : 's'}.`);
    const [from, to] = start <= end ? [start, end] : [end, start];
    for (let p = from; p <= to; p += 1) {
      if (p > pageCount) break;
      pages.add(p);
    }
  }

  return [...pages].sort((a, b) => a - b);
}

/* ------------------------------------------------------------------ *
 * Loading
 * ------------------------------------------------------------------ */

async function loadWithPdfLib(buffer, { label = 'file' } = {}) {
  const { PDFDocument } = require('pdf-lib');
  let doc;
  try {
    doc = await PDFDocument.load(buffer, {
      ignoreEncryption: true,
      throwOnInvalidObject: false,
      capNumbers: true,
      updateMetadata: false,
    });
  } catch (err) {
    throw new PdfError(422, `"${label}" could not be read. It may be corrupted or not a real PDF.`);
  }
  if (doc.isEncrypted) {
    throw new PdfError(422, `"${label}" is password-protected. Remove the password, then try again.`);
  }
  const count = doc.getPageCount();
  if (!count) throw new PdfError(422, `"${label}" does not contain any pages.`);
  return doc;
}

async function loadWithPdfJs(buffer, { maxPages, label = 'file' } = {}) {
  const pdfjs = await getPdfjs();
  const task = pdfjs.getDocument({
    data: new Uint8Array(buffer),
    isEvalSupported: false,
    disableFontFace: true,
    useSystemFonts: true,
    standardFontDataUrl: getStandardFontDataUrl(),
    verbosity: 0,
  });
  try {
    const doc = await task.promise;
    if (maxPages && doc.numPages > maxPages) {
      throw new PdfError(413, `This document has ${doc.numPages} pages. The limit for this tool is ${maxPages} pages.`);
    }
    return { doc, task, pdfjs };
  } catch (err) {
    await task.destroy().catch(() => {});
    if (err instanceof PdfError) throw err;
    if (err && (err.name === 'PasswordException' || err.code === 1 || err.code === 2)) {
      throw new PdfError(422, `"${label}" is password-protected. Remove the password, then try again.`);
    }
    throw new PdfError(422, `"${label}" could not be read. It may be corrupted or not a real PDF.`);
  }
}

/* ------------------------------------------------------------------ *
 * Rendering
 * ------------------------------------------------------------------ */

const RENDER_SCALE_LIMIT = 4;

async function renderPageToBuffer(pdfjs, doc, pageNumber, { scale = 2, format = 'jpg', quality = 88 } = {}) {
  const { createCanvas } = require('@napi-rs/canvas');
  const safeScale = Math.min(Math.max(Number(scale) || 1, 0.2), RENDER_SCALE_LIMIT);
  const page = await doc.getPage(pageNumber);
  const viewport = page.getViewport({ scale: safeScale });
  const canvas = createCanvas(Math.max(1, Math.ceil(viewport.width)), Math.max(1, Math.ceil(viewport.height)));
  const context = canvas.getContext('2d');
  if (format !== 'png') {
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, canvas.width, canvas.height);
  }
  await page.render({ canvasContext: context, viewport, canvas }).promise;
  page.cleanup();
  const buffer = format === 'png'
    ? canvas.toBuffer('image/png')
    : canvas.toBuffer('image/jpeg', Math.min(99, Math.max(20, Number(quality) || 88)) / 100);
  return { buffer, width: canvas.width, height: canvas.height };
}

async function extractTextPerPage(pdfjs, doc) {
  const pages = [];
  for (let n = 1; n <= doc.numPages; n += 1) {
    const page = await doc.getPage(n);
    const content = await page.getTextContent();
    // Rebuild line structure from item positions so the .txt output keeps its shape.
    const lines = [];
    let current = null;
    for (const item of content.items) {
      if (typeof item.str !== 'string') continue;
      const y = Math.round(item.transform[5]);
      if (!current || Math.abs(current.y - y) > 2) {
        current = { y, parts: [] };
        lines.push(current);
      }
      current.parts.push({ text: item.str, hasEol: item.hasEOL });
    }
    const text = lines
      .map((line) => line.parts.map((part) => part.text).join('').replace(/[ \t]+/g, ' ').trim())
      .filter(Boolean)
      .join('\n');
    pages.push(text);
    page.cleanup();
  }
  return pages;
}

/* ------------------------------------------------------------------ *
 * Output helpers
 * ------------------------------------------------------------------ */

function stripPdfInfo(doc) {
  try {
    doc.setTitle('');
    doc.setAuthor('');
    doc.setSubject('');
    doc.setKeywords([]);
    doc.setProducer('Northstar');
    doc.setCreator('Northstar');
  } catch {
    /* metadata is best-effort */
  }
}

function makeJobId() {
  return `${Date.now().toString(36)}-${crypto.randomBytes(8).toString('hex')}`;
}

/** Per-request scratch directory; always removed in the route's finally block. */
function makeTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'northstar-pdf-'));
}

function removeTempDir(dir) {
  if (!dir) return;
  fs.rm(dir, { recursive: true, force: true }, () => {});
}

function safeBaseName(name, fallback = 'document') {
  const base = String(name || '')
    .replace(/\.[^.]+$/, '')
    .replace(/[^a-zA-Z0-9 _-]/g, '')
    .trim()
    .slice(0, 80);
  return base || fallback;
}

function clientRequestedName(headerValue, fallback) {
  return safeBaseName(headerValue, fallback);
}

module.exports = {
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
  makeJobId,
  makeTempDir,
  removeTempDir,
  safeBaseName,
  clientRequestedName,
  getPdfjs,
};
