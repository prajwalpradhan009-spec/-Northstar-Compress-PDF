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

const app = express();
app.use(cors());
app.use(morgan('dev'));
app.use(express.json());

// Serve uploaded files
app.use('/uploads', express.static(path.join(__dirname, '..', 'uploads')));

const mongoUri = process.env.MONGODB_URI || 'mongodb://localhost:27017/file_studio';
mongoose
  .connect(mongoUri, { serverSelectionTimeoutMS: 5000 })
  .then(() => console.log('Connected to MongoDB'))
  .catch((err) => {
    console.warn('MongoDB connection warning:', err.message);
    console.warn('Backend running in standalone mode (database features may be limited).');
  });

app.use('/api/files', filesRouter);
app.use('/api/auth', authRouter);

app.get('/api/ping', (req, res) => res.json({ ok: true, time: Date.now() }));

// Serve frontend static assets
const distPath = path.join(__dirname, '..', '..', 'frontend', 'dist');
const publicPath = path.join(__dirname, '..', 'public');

if (fs.existsSync(distPath)) {
  app.use(express.static(distPath));
} else if (fs.existsSync(publicPath)) {
  app.use(express.static(publicPath));
}

app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api') || req.path.startsWith('/uploads')) {
    return next();
  }
  const indexPath = fs.existsSync(distPath)
    ? path.join(distPath, 'index.html')
    : (fs.existsSync(publicPath) ? path.join(publicPath, 'index.html') : null);

  if (indexPath && fs.existsSync(indexPath)) {
    return res.sendFile(indexPath);
  }
  res.status(200).send('Northstar Compress PDF API is running.');
});

const port = process.env.PORT || 4000;
app.listen(port, () => console.log(`Server listening on ${port}`));
