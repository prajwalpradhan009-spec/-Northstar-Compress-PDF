const express = require('express');
const mongoose = require('mongoose');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const File = require('../models/File');

const router = express.Router();

const uploadDir = path.join(__dirname, '..', 'uploads');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => {
    const sanitized = file.originalname.replace(/[^a-zA-Z0-9.-]/g, '_');
    cb(null, `${Date.now()}-${sanitized}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 50 * 1024 * 1024 }, // 50 MB limit
});

function isDbReady() {
  return mongoose.connection.readyState === 1;
}

router.post('/', upload.single('file'), async (req, res) => {
  try {
    const file = req.file;
    if (!file) return res.status(400).json({ error: 'No file uploaded' });

    let metadata = {};
    if (req.body.metadata) {
      try {
        metadata = typeof req.body.metadata === 'string' ? JSON.parse(req.body.metadata) : req.body.metadata;
      } catch {
        metadata = {};
      }
    }

    const publicPath = `/uploads/${path.basename(file.path)}`;

    if (!isDbReady()) {
      return res.status(201).json({
        originalName: file.originalname,
        mimeType: file.mimetype,
        size: file.size,
        path: publicPath,
        metadata,
        persistedToDb: false,
      });
    }

    const doc = new File({
      originalName: file.originalname,
      mimeType: file.mimetype,
      size: file.size,
      path: publicPath,
      metadata,
    });
    await doc.save();
    res.status(201).json(doc);
  } catch (err) {
    console.error('File upload error:', err);
    res.status(500).json({ error: 'Server error while saving file.' });
  }
});

router.get('/', async (req, res) => {
  try {
    if (!isDbReady()) {
      return res.json([]);
    }
    const docs = await File.find().sort({ createdAt: -1 }).limit(100);
    res.json(docs);
  } catch (err) {
    console.error('Fetch files error:', err);
    res.status(500).json({ error: 'Server error while fetching files.' });
  }
});

router.get('/:id', async (req, res) => {
  try {
    if (!isDbReady()) {
      return res.status(503).json({ error: 'Database is currently offline.' });
    }
    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(400).json({ error: 'Invalid file ID format.' });
    }
    const doc = await File.findById(req.params.id);
    if (!doc) return res.status(404).json({ error: 'File record not found.' });
    res.json(doc);
  } catch (err) {
    console.error('Fetch file by ID error:', err);
    res.status(500).json({ error: 'Server error while fetching file.' });
  }
});

router.delete('/:id', async (req, res) => {
  try {
    if (!isDbReady()) {
      return res.status(503).json({ error: 'Database is currently offline.' });
    }
    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(400).json({ error: 'Invalid file ID format.' });
    }
    const doc = await File.findById(req.params.id);
    if (!doc) return res.status(404).json({ error: 'File record not found.' });

    if (doc.path) {
      const diskFilename = path.basename(doc.path);
      const filePath = path.join(uploadDir, diskFilename);
      if (fs.existsSync(filePath)) {
        try {
          fs.unlinkSync(filePath);
        } catch (e) {
          console.warn('Could not remove file from disk:', e.message);
        }
      }
    }

    await File.deleteOne({ _id: doc._id });
    res.json({ ok: true });
  } catch (err) {
    console.error('Delete file error:', err);
    res.status(500).json({ error: 'Server error while deleting file.' });
  }
});

module.exports = router;
