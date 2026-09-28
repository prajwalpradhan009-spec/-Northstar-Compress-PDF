const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const morgan = require('morgan');
const path = require('path');
const fs = require('fs');

const config = require('../config/env');

const filesRouter = require('./routes/files');
const authRouter = require('./routes/auth');
const historyRouter = require('./routes/history');
const aiRouter = require('./routes/ai');
const pdfRouter = require('./routes/pdf');
const { verifyMailer } = require('./lib/mailer');

const app = express();
app.disable('x-powered-by');

/* ------------------------------------------------------------------ *
 * CORS — driven by ALLOWED_ORIGINS / FRONTEND_URL, never a blanket "*"
 * ------------------------------------------------------------------ */

app.use(cors({
  origin(origin, callback) {
    // Same-origin requests, curl and health checks send no Origin header.
    if (!origin) return callback(null, true);
    if (config.cors.origins.has(origin)) return callback(null, true);
    return callback(new Error(`Origin ${origin} is not allowed by ALLOWED_ORIGINS.`));
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-File-Name'],
  maxAge: 86400,
}));

if (config.env !== 'test') app.use(morgan('dev'));
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true, limit: '2mb' }));

/* ------------------------------------------------------------------ *
 * Security headers
 * ------------------------------------------------------------------ */

app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Permissions-Policy', 'geolocation=(), microphone=(), camera=(), payment=()');
  next();
});

/* ------------------------------------------------------------------ *
 * Uploads (account file archive) — served from a directory outside public
 * ------------------------------------------------------------------ */

if (!fs.existsSync(config.uploadsDir)) {
  fs.mkdirSync(config.uploadsDir, { recursive: true });
}
app.use('/uploads', express.static(config.uploadsDir));

/* ------------------------------------------------------------------ *
 * MongoDB — the app stays usable in standalone mode if the DB is down
 * ------------------------------------------------------------------ */

let mongoRetryTimer = null;
let mongoAttempt = 0;
let mongoWanted = Boolean(config.mongo.uri);

function connectWithRetry() {
  if (!mongoWanted) return;
  mongoAttempt += 1;
  mongoose
    .connect(config.mongo.uri, { serverSelectionTimeoutMS: 5000 })
    .then(() => {
      mongoAttempt = 0;
      console.log('Connected to MongoDB');
    })
    .catch((err) => {
      const delay = Math.min(30000, 2000 * mongoAttempt);
      console.warn(`MongoDB connection attempt ${mongoAttempt} failed: ${err.message}`);
      console.warn(`Backend running in standalone mode. Retrying in ${Math.round(delay / 1000)}s...`);
      clearTimeout(mongoRetryTimer);
      mongoRetryTimer = setTimeout(connectWithRetry, delay);
    });
}

mongoose.connection.on('disconnected', () => {
  if (!mongoWanted || mongoRetryTimer) return;
  console.warn('MongoDB disconnected. Scheduling reconnect...');
  clearTimeout(mongoRetryTimer);
  mongoRetryTimer = setTimeout(connectWithRetry, 2000);
});

mongoose.connection.on('connected', () => {
  clearTimeout(mongoRetryTimer);
  mongoRetryTimer = null;
});

if (mongoWanted) {
  connectWithRetry();
} else {
  console.warn('MONGODB_URI is not set. Accounts, history and saved files are disabled.');
}

/* ------------------------------------------------------------------ *
 * API routes
 * ------------------------------------------------------------------ */

app.use('/api/pdf', pdfRouter);
app.use('/api/files', filesRouter);
app.use('/api/auth', authRouter);
app.use('/api/history', historyRouter);
app.use('/api/ai', aiRouter);
// Same router, second mount point, so /api/chat also reaches Northstar AI.
app.use('/api/chat', aiRouter);

app.get('/api/ping', (req, res) => res.json({ ok: true, time: Date.now() }));

app.get('/api/health', (req, res) => {
  res.json({
    ok: true,
    env: config.env,
    database: mongoose.connection.readyState === 1 ? 'connected' : 'offline',
    gemini: config.gemini.apiKey ? 'configured' : 'not-configured',
    limits: {
      maxUploadMb: config.pdf.maxUploadMb,
      maxFiles: config.pdf.maxFiles,
      maxPages: config.pdf.maxPages,
    },
    time: Date.now(),
  });
});

/* ------------------------------------------------------------------ *
 * Static frontend (frontend/dist locally, backend/public on Render)
 * ------------------------------------------------------------------ */

const frontendDistPath = path.resolve(__dirname, '..', '..', 'frontend', 'dist');
const backendPublicPath = config.publicDir;

let staticPath = null;
if (fs.existsSync(frontendDistPath)) {
  staticPath = frontendDistPath;
} else if (fs.existsSync(backendPublicPath)) {
  staticPath = backendPublicPath;
}

if (staticPath) {
  console.log(`Serving static files from: ${staticPath}`);
  app.use(express.static(staticPath));
}

// SPA fallback for client-side routing
app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api') || req.path.startsWith('/uploads')) {
    return next();
  }

  const indexPath = staticPath ? path.join(staticPath, 'index.html') : null;
  if (indexPath && fs.existsSync(indexPath)) {
    return res.sendFile(indexPath);
  }

  res.status(200).send('Northstar Compress PDF is running.');
});

/* ------------------------------------------------------------------ *
 * Last-resort error handler — never leaks a stack trace
 * ------------------------------------------------------------------ */

app.use((err, req, res, next) => { // eslint-disable-line no-unused-vars
  if (err && /not allowed by ALLOWED_ORIGINS/.test(String(err.message))) {
    return res.status(403).json({ error: 'This origin is not allowed to use the Northstar API.' });
  }
  if (config.env !== 'production') {
    console.error('[server] unhandled error:', err && err.message);
  }
  return res.status(500).json({ error: 'Something went wrong on the server. Please try again.' });
});

const server = app.listen(config.port, () => {
  console.log(`Server listening on ${config.port} (${config.env})`);
  console.log(`Allowed origins: ${[...config.cors.origins].join(', ') || 'none configured'}`);
  // Fail loudly at boot if reset emails are broken, instead of on a user's
  // first password-reset attempt.
  verifyMailer().catch(() => {});
});

const shutdown = () => {
  server.close(() => {
    mongoose.connection.close(false).finally(() => process.exit(0));
  });
  setTimeout(() => process.exit(0), 8000).unref();
};

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

module.exports = app;
