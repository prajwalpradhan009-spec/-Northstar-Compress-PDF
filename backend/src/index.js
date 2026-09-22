const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const morgan = require('morgan');
const dotenv = require('dotenv');
const path = require('path');
const fs = require('fs');

dotenv.config();

const filesRouter = require('./routes/files');
const authRouter = require('./routes/auth');
const historyRouter = require('./routes/history');

const app = express();
app.use(cors());
app.use(morgan('dev'));
app.use(express.json());

// Security headers
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Permissions-Policy', 'geolocation=(), microphone=(), camera=(), payment=()');
  next();
});

// Serve uploaded files
app.use('/uploads', express.static(path.join(__dirname, '..', 'uploads')));

const mongoUri = process.env.MONGODB_URI || 'mongodb://localhost:27017/file_studio';

let mongoRetryTimer = null;
let mongoAttempt = 0;

function connectWithRetry() {
  mongoAttempt += 1;
  mongoose
    .connect(mongoUri, { serverSelectionTimeoutMS: 5000 })
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
  if (mongoRetryTimer) return;
  console.warn('MongoDB disconnected. Scheduling reconnect...');
  clearTimeout(mongoRetryTimer);
  mongoRetryTimer = setTimeout(connectWithRetry, 2000);
});

mongoose.connection.on('connected', () => {
  clearTimeout(mongoRetryTimer);
  mongoRetryTimer = null;
});

connectWithRetry();

app.use('/api/files', filesRouter);
app.use('/api/auth', authRouter);
app.use('/api/history', historyRouter);

app.get('/api/ping', (req, res) => res.json({ ok: true, time: Date.now() }));

// Serve frontend static assets from frontend/dist or backend/public
const frontendDistPath = path.resolve(__dirname, '..', '..', 'frontend', 'dist');
const backendPublicPath = path.resolve(__dirname, '..', 'public');

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

// Fallback SPA route for client-side routing
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

const port = process.env.PORT || 4000;
app.listen(port, () => console.log(`Server listening on ${port}`));
