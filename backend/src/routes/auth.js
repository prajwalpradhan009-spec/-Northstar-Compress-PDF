const express = require('express');
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const User = require('../models/User');
const { sendResetEmail } = require('../lib/mailer');

const router = express.Router();
const JWT_SECRET = process.env.JWT_SECRET || 'northstar-secret-key';
const RESET_CODE_TTL_MS = 30 * 60 * 1000;

function hashResetCode(code) {
  return crypto.createHash('sha256').update(String(code).trim()).digest('hex');
}

const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const STRONG_PASSWORD_REGEX = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^A-Za-z0-9]).{8,}$/;
const STRONG_PASSWORD_ERROR = 'Password must be at least 8 characters and include uppercase, lowercase, a number, and a symbol like @ # $.';

function getToken(req) {
  const header = req.get('authorization') || '';
  return header.startsWith('Bearer ') ? header.slice(7) : null;
}

function publicUser(user) {
  return { id: user._id, name: user.name, email: user.email, createdAt: user.createdAt };
}

function checkDbReady(res) {
  if (mongoose.connection.readyState !== 1) {
    res.status(503).json({ error: 'Database is currently offline. Please ensure MongoDB is connected.' });
    return false;
  }
  return true;
}

router.post('/signup', async (req, res) => {
  try {
    if (!checkDbReady(res)) return;

    const { name, email, password } = req.body;

    if (!name || !email || !password) {
      return res.status(400).json({ error: 'Name, email, and password are required.' });
    }

    const trimmedName = String(name).trim();
    const normalizedEmail = String(email).trim().toLowerCase();

    if (trimmedName.length < 2) {
      return res.status(400).json({ error: 'Name must be at least 2 characters.' });
    }

    if (!emailRegex.test(normalizedEmail)) {
      return res.status(400).json({ error: 'Please provide a valid email address.' });
    }

    if (!STRONG_PASSWORD_REGEX.test(String(password))) {
      return res.status(400).json({ error: STRONG_PASSWORD_ERROR });
    }

    const existingUser = await User.findOne({ email: normalizedEmail });
    if (existingUser) {
      return res.status(409).json({ error: 'An account with this email already exists.' });
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    const user = await User.create({
      name: trimmedName,
      email: normalizedEmail,
      password: hashedPassword,
    });

    const token = jwt.sign({ id: user._id, email: user.email }, JWT_SECRET, { expiresIn: '7d' });

    return res.status(201).json({
      token,
      user: publicUser(user),
    });
  } catch (error) {
    console.error('Signup error:', error);
    return res.status(500).json({ error: 'Unable to create account.' });
  }
});

router.post('/login', async (req, res) => {
  try {
    if (!checkDbReady(res)) return;

    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required.' });
    }

    const normalizedEmail = String(email).trim().toLowerCase();
    const user = await User.findOne({ email: normalizedEmail });
    if (!user) {
      return res.status(401).json({ error: 'Invalid email or password.' });
    }

    const passwordMatches = await bcrypt.compare(password, user.password);
    if (!passwordMatches) {
      return res.status(401).json({ error: 'Invalid email or password.' });
    }

    const token = jwt.sign({ id: user._id, email: user.email }, JWT_SECRET, { expiresIn: '7d' });

    return res.json({
      token,
      user: publicUser(user),
    });
  } catch (error) {
    console.error('Login error:', error);
    return res.status(500).json({ error: 'Unable to log in.' });
  }
});

router.post('/forgot-password', async (req, res) => {
  try {
    if (!checkDbReady(res)) return;

    const { email } = req.body;
    if (!email || !emailRegex.test(String(email).trim())) {
      return res.status(400).json({ error: 'Please provide a valid email address.' });
    }

    const normalizedEmail = String(email).trim().toLowerCase();
    const user = await User.findOne({ email: normalizedEmail });

    if (!user) {
      return res.json({ ok: true, emailed: false });
    }

    const resetCode = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + RESET_CODE_TTL_MS);
    user.passwordResetToken = hashResetCode(resetCode);
    user.passwordResetExpires = expiresAt;
    await user.save();

    let emailed = false;
    let emailError = '';
    try {
      emailed = await sendResetEmail({ to: user.email, resetCode, expiresAt });
    } catch (error) {
      emailError = error.message || 'Unknown SMTP error';
      console.error('Failed to send reset email:', emailError);
    }

    if (!emailed) {
      return res.status(500).json({
        error: `Your reset code was not emailed because sending failed. ${emailError || 'Check SMTP_USER/SMTP_PASS in backend/.env.'}`,
      });
    }

    return res.json({ ok: true, emailed: true });
  } catch (error) {
    console.error('Forgot password error:', error);
    return res.status(500).json({ error: 'Unable to process the request.' });
  }
});

router.post('/reset-password', async (req, res) => {
  try {
    if (!checkDbReady(res)) return;

    const { token, password } = req.body;

    if (!token || !password) {
      return res.status(400).json({ error: 'Reset code and a new password are required.' });
    }

    if (!STRONG_PASSWORD_REGEX.test(String(password))) {
      return res.status(400).json({ error: STRONG_PASSWORD_ERROR });
    }

    const user = await User.findOne({ passwordResetToken: hashResetCode(token) });
    if (!user || !user.passwordResetExpires || user.passwordResetExpires.getTime() < Date.now()) {
      return res.status(400).json({ error: 'This reset code is invalid or has expired. Request a new one.' });
    }

    user.password = await bcrypt.hash(password, 10);
    user.passwordResetToken = null;
    user.passwordResetExpires = null;
    await user.save();

    return res.json({ ok: true });
  } catch (error) {
    console.error('Reset password error:', error);
    return res.status(500).json({ error: 'Unable to reset the password.' });
  }
});

router.get('/me', async (req, res) => {
  try {
    if (!checkDbReady(res)) return;

    const token = getToken(req);
    if (!token) return res.status(401).json({ error: 'Authentication required.' });

    const payload = jwt.verify(token, JWT_SECRET);
    const user = await User.findById(payload.id);
    if (!user) return res.status(401).json({ error: 'Account no longer exists.' });

    return res.json({ user: publicUser(user) });
  } catch (error) {
    if (error.name === 'JsonWebTokenError' || error.name === 'TokenExpiredError') {
      return res.status(401).json({ error: 'Your session has expired. Please sign in again.' });
    }
    console.error('Session verification error:', error);
    return res.status(500).json({ error: 'Unable to verify session.' });
  }
});

module.exports = router;
