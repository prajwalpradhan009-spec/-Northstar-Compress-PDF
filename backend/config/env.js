const path = require('path');
const fs = require('fs');

const ROOT_DIR = path.resolve(__dirname, '..');

/**
 * Locate and load the backend .env file.
 * Render injects real environment variables, so a missing file is not fatal there.
 */
function loadEnvFile() {
  const candidates = [
    path.join(ROOT_DIR, '.env'),
    path.join(ROOT_DIR, '..', '.env'),
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }
  return null;
}

const dotenv = require('dotenv');
const envFile = loadEnvFile();
dotenv.config(envFile ? { path: envFile } : undefined);

const PLACEHOLDERS = new Set([
  'replace_with_a_long_random_secret',
  'replace-with-a-long-random-secret',
  'your_jwt_secret_here',
  'changeme',
  'secret',
  'northstar-secret-key',
]);

function readString(key, fallback = '') {
  const raw = process.env[key];
  if (typeof raw !== 'string') return fallback;
  const trimmed = raw.trim();
  return trimmed.length ? trimmed : fallback;
}

function readNumber(key, fallback) {
  const raw = readString(key);
  if (!raw) return fallback;
  const value = Number(raw);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function readList(key) {
  return readString(key)
    .split(',')
    .map((item) => item.trim().replace(/\/+$/, ''))
    .filter(Boolean);
}

const nodeEnv = readString('NODE_ENV', 'development');
const isProduction = nodeEnv === 'production';
const isTest = nodeEnv === 'test';

const port = readNumber('PORT', 4000);
const mongoUri = readString('MONGODB_URI');
const jwtSecret = readString('JWT_SECRET');
const geminiApiKey = readString('GEMINI_API_KEY');
const smtpHost = readString('SMTP_HOST', 'smtp.gmail.com');
const smtpPort = readNumber('SMTP_PORT', 465);
const smtpUser = readString('SMTP_USER');
const smtpPass = readString('SMTP_PASS');
const emailFrom = readString('EMAIL_FROM', smtpUser || 'Northstar <no-reply@northstar.local>');

const frontendUrl = readString('FRONTEND_URL').replace(/\/+$/, '');
const allowedOrigins = readList('ALLOWED_ORIGINS');

/**
 * Allow the configured FRONTEND_URL as an origin too, so a single value is enough.
 * Requests with no Origin header (curl, health checks, same-origin navigation) pass through.
 */
const corsOrigins = new Set(allowedOrigins);
if (frontendUrl) corsOrigins.add(frontendUrl);

const maxUploadMb = readNumber('PDF_MAX_UPLOAD_MB', isProduction ? 40 : 60);
const maxFilesPerUpload = readNumber('PDF_MAX_FILES', 20);
const maxPages = readNumber('PDF_MAX_PAGES', 500);
const ocrMaxPages = readNumber('OCR_MAX_PAGES', 30);
const ocrLanguage = readString('OCR_LANGUAGE', 'eng');

const problems = [];

if (!mongoUri) {
  problems.push('Missing required environment variable: MONGODB_URI');
}

if (!jwtSecret) {
  problems.push('Missing required environment variable: JWT_SECRET');
} else if (PLACEHOLDERS.has(jwtSecret.toLowerCase())) {
  problems.push(
    isProduction
      ? 'JWT_SECRET still uses the placeholder value. Generate a long random secret before deploying.'
      : 'JWT_SECRET is still the placeholder value. Sessions are insecure until you replace it.',
  );
}

if (!readString('PORT') && isProduction) {
  console.warn('[env] PORT is not set. Render normally injects PORT automatically.');
}

if (!corsOrigins.size) {
  problems.push(
    'Missing required environment variable: ALLOWED_ORIGINS (or FRONTEND_URL) — browser requests will be blocked by CORS.',
  );
}

if (!geminiApiKey) {
  console.warn('[env] GEMINI_API_KEY is not set. Northstar AI features will return "not configured".');
}

if (!smtpUser || !smtpPass) {
  console.warn('[env] SMTP_USER / SMTP_PASS are not set. Password reset emails will be skipped.');
}

if (problems.length && !isTest) {
  const details = problems.map((line) => `  - ${line}`).join('\n');
  console.error(`\n[env] Invalid server configuration:\n${details}\n`);
  console.error(`[env] Expected a .env file at: ${envFile || path.join(ROOT_DIR, '.env')}`);
  console.error('[env] See backend/.env.example for the full list of supported variables.\n');
  if (isProduction) {
    throw new Error('Invalid server configuration. See the logs above for details.');
  }
}

const config = Object.freeze({
  env: nodeEnv,
  isProduction,
  isTest,
  port,
  rootDir: ROOT_DIR,
  publicDir: path.join(ROOT_DIR, 'public'),
  uploadsDir: path.join(ROOT_DIR, 'src', 'uploads'),
  envFile,

  mongo: { uri: mongoUri },
  auth: { jwtSecret },
  gemini: {
    apiKey: geminiApiKey,
    model: readString('GEMINI_MODEL', 'gemini-3.6-flash'),
    timeoutMs: readNumber('GEMINI_TIMEOUT_MS', 60000),
    maxDocumentChars: readNumber('GEMINI_MAX_DOCUMENT_CHARS', 250000),
  },
  mailer: {
    host: smtpHost,
    port: smtpPort,
    user: smtpUser,
    pass: smtpPass,
    from: emailFrom,
    timeoutMs: readNumber('SMTP_TIMEOUT_MS', 15000),
  },
  cors: { frontendUrl, allowedOrigins, origins: corsOrigins },

  pdf: {
    maxUploadBytes: Math.round(maxUploadMb * 1024 * 1024),
    maxUploadMb,
    maxFiles: maxFilesPerUpload,
    maxPages,
    ocrMaxPages,
    ocrLanguage,
  },
});

module.exports = config;
