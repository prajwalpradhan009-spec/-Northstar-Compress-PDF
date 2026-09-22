const express = require('express');
const History = require('../models/History');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

router.post('/', requireAuth, async (req, res) => {
  try {
    const { operation, fileName, status } = req.body || {};
    if (!operation || !fileName) {
      return res.status(400).json({ error: 'operation and fileName are required.' });
    }
    const doc = await History.create({
      user: req.user._id,
      operation: String(operation),
      fileName: String(fileName),
      status: status === 'Failed' ? 'Failed' : 'Completed',
    });
    res.status(201).json(doc);
  } catch (err) {
    console.error('History create error:', err);
    res.status(500).json({ error: 'Server error while saving history.' });
  }
});

router.get('/', requireAuth, async (req, res) => {
  try {
    const docs = await History.find({ user: req.user._id }).sort({ createdAt: -1 }).limit(50);
    res.json(docs);
  } catch (err) {
    console.error('History fetch error:', err);
    res.status(500).json({ error: 'Server error while fetching history.' });
  }
});

router.delete('/', requireAuth, async (req, res) => {
  try {
    await History.deleteMany({ user: req.user._id });
    res.json({ ok: true });
  } catch (err) {
    console.error('History clear error:', err);
    res.status(500).json({ error: 'Server error while clearing history.' });
  }
});

module.exports = router;