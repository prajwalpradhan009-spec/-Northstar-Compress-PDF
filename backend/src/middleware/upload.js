const path = require('path');
const crypto = require('crypto');
const multer = require('multer');
const config = require('../../config/env');
const { PdfError } = require('../lib/pdf/core');

const PDF_EXTENSIONS = new Set(['.pdf']);
const PDF_MIME_TYPES = new Set(['application/pdf', 'application/x-pdf', 'application/octet-stream', 'application/zip']);

const IMAGE_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.webp', '.bmp', '.gif', '.tif', '.tiff', '.avif']);
const IMAGE_MIME_TYPES = new Set([
  'image/jpeg',
  'image/jpg',
  'image/pjpeg',
  'image/png',
  'image/webp',
  'image/bmp',
  'image/x-ms-bmp',
  'image/gif',
  'image/tiff',
  'image/avif',
  'application/octet-stream',
]);

/**
 * Filenames are never trusted. Multer only ever sees a random name and the
 * server never reads a path from the client.
 */
const storage = multer.memoryStorage();

function makeFilter({ extensions, mimeTypes, label }) {
  return function fileFilter(req, file, cb) {
    const ext = path.extname(String(file.originalname || '')).toLowerCase();
    if (!extensions.has(ext)) {
      return cb(new PdfError(415, `"${file.originalname}" is not a supported ${label} file.`));
    }
    if (file.mimetype && !mimeTypes.has(file.mimetype)) {
      return cb(new PdfError(415, `"${file.originalname}" has an unsupported file type (${file.mimetype}).`));
    }
    return cb(null, true);
  };
}

const baseLimits = {
  fileSize: config.pdf.maxUploadBytes,
  files: config.pdf.maxFiles,
  fields: 40,
  parts: config.pdf.maxFiles + 40,
};

const uploadPdf = multer({
  storage,
  limits: baseLimits,
  fileFilter: makeFilter({ extensions: PDF_EXTENSIONS, mimeTypes: PDF_MIME_TYPES, label: 'PDF' }),
}).single('file');

const uploadPdfs = multer({
  storage,
  limits: baseLimits,
  fileFilter: makeFilter({ extensions: PDF_EXTENSIONS, mimeTypes: PDF_MIME_TYPES, label: 'PDF' }),
}).array('files', config.pdf.maxFiles);

const uploadImages = multer({
  storage,
  limits: baseLimits,
  fileFilter: makeFilter({ extensions: IMAGE_EXTENSIONS, mimeTypes: IMAGE_MIME_TYPES, label: 'image' }),
}).array('files', config.pdf.maxFiles);

/** Translate multer's own errors into clean, user-facing messages. */
function handleUploadError(err, req, res, next) {
  if (err instanceof multer.MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(413).json({ error: `That file is too large. The limit is ${config.pdf.maxUploadMb} MB.` });
    }
    if (err.code === 'LIMIT_FILE_COUNT' || err.code === 'LIMIT_PART_COUNT') {
      return res.status(413).json({ error: `Too many files. Up to ${config.pdf.maxFiles} files can be processed at once.` });
    }
    if (err.code === 'LIMIT_UNEXPECTED_FILE') {
      return res.status(400).json({ error: 'Unexpected file field in the upload.' });
    }
    return res.status(400).json({ error: 'The upload could not be read. Please try again.' });
  }
  if (err instanceof PdfError) {
    return res.status(err.status || 400).json({ error: err.message });
  }
  return next(err);
}

/** Wrap a multer middleware so rejections become JSON instead of an HTML stack trace. */
function guard(middleware) {
  return function wrapped(req, res, next) {
    middleware(req, res, (err) => {
      if (err) return handleUploadError(err, req, res, next);
      return next();
    });
  };
}

/** Read a required uploaded file from disk-less memory storage. */
function requireFile(req, field = 'file') {
  const file = req.file;
  if (!file || !file.buffer || !file.buffer.length) {
    throw new PdfError(400, 'No file was uploaded. Choose a file and try again.');
  }
  return file;
}

function requireFiles(req, field = 'files') {
  const files = Array.isArray(req.files) ? req.files.filter((item) => item && item.buffer && item.buffer.length) : [];
  if (!files.length) {
    throw new PdfError(400, 'No files were uploaded. Choose at least one file and try again.');
  }
  return files;
}

function displayName(file) {
  return String(file.originalname || 'file').slice(0, 120);
}

const toInput = (file) => ({ buffer: file.buffer, name: displayName(file) });

/** Read the client-suggested output filename from a header, sanitised. */
function requestedBaseName(req) {
  const raw = req.get('x-file-name') || req.body?.fileName || '';
  try {
    return decodeURIComponent(String(raw));
  } catch {
    return String(raw);
  }
}

const requestId = () => crypto.randomBytes(8).toString('hex');

module.exports = {
  uploadPdf,
  uploadPdfs,
  uploadImages,
  guard,
  handleUploadError,
  requireFile,
  requireFiles,
  toInput,
  displayName,
  requestedBaseName,
  requestId,
  PDF_EXTENSIONS,
  IMAGE_EXTENSIONS,
};
