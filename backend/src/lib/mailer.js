const nodemailer = require('nodemailer');
const config = require('../../config/env');

const HOST = config.mailer.host;
const PORT = config.mailer.port;
const USER = config.mailer.user;
const PASS = config.mailer.pass;
const FROM = config.mailer.from;

let transporter = null;

function getTransporter() {
  if (!USER || !PASS) return null;

  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: HOST,
      port: PORT,
      secure: PORT === 465,
      auth: { user: USER.trim(), pass: PASS.trim() },
      // Without these, a dead or throttled SMTP server leaves the request
      // hanging for minutes and the browser sits on "Please wait…".
      connectionTimeout: config.mailer.timeoutMs,
      greetingTimeout: config.mailer.timeoutMs,
      socketTimeout: config.mailer.timeoutMs,
      dnsTimeout: config.mailer.timeoutMs,
      dnsTimeoutCount: 1,
    });
  }
  return transporter;
}

/** Structured, non-leaking classification of an SMTP failure. */
function describeSmtpError(error) {
  const code = (error && (error.code || error.responseCode)) || '';
  const message = String((error && error.message) || '');

  if (code === 'EAUTH' || /535|Invalid login|BadCredentials|authentication/i.test(message)) {
    return {
      reason: 'invalid-credentials',
      log: 'SMTP rejected the username or password (535). The Gmail App Password is wrong, revoked, or 2-Step Verification is off.',
      client: 'Email could not be sent. The server\'s Gmail App Password is invalid. Sign in with your current password, or ask the site owner to create a new App Password in the Google Account security settings.',
    };
  }
  if (code === 'ECONNECTION' || code === 'ETIMEDOUT' || /getaddrinfo|ENOTFOUND|timeout|connect/i.test(message)) {
    return {
      reason: 'connection',
      log: `Could not reach ${HOST}:${PORT} (${code || 'timeout'}).`,
      client: 'Email could not be sent because the mail server is unreachable. Try again in a few minutes.',
    };
  }
  if (code === 'ECONNRESET' || code === 'EDNS' || /socket hang up/i.test(message)) {
    return {
      reason: 'connection',
      log: `The connection to ${HOST}:${PORT} was interrupted (${code}).`,
      client: 'Email could not be sent because the mail server closed the connection. Try again in a few minutes.',
    };
  }
  return {
    reason: 'unknown',
    log: `Unhandled SMTP error: ${code || 'no code'} — ${message}`,
    client: 'Email could not be sent right now. Try again in a few minutes.',
  };
}

/**
 * Verify the SMTP credentials once at startup so a broken mail config is
 * visible in the logs immediately, instead of on a user's first reset attempt.
 */
async function verifyMailer() {
  const t = getTransporter();
  if (!t) {
    console.warn('[mailer] SMTP_USER / SMTP_PASS are not set. Password reset emails are disabled.');
    return { ok: false, reason: 'not-configured' };
  }
  try {
    await t.verify();
    console.log('[mailer] SMTP credentials verified.');
    return { ok: true, reason: 'verified' };
  } catch (error) {
    const described = describeSmtpError(error);
    console.error(`[mailer] SMTP verification failed (${described.reason}): ${described.log}`);
    return { ok: false, reason: described.reason };
  }
}

async function sendResetEmail({ to, resetCode, expiresAt }) {
  const t = getTransporter();
  if (!t) {
    const error = new Error('Mailer is not configured.');
    error.smtpReason = 'not-configured';
    throw error;
  }

  try {
    await t.sendMail({
      from: FROM,
      to,
      subject: 'Reset your Northstar password',
      text: `Hi,\n\nWe received a request to reset your Northstar account password.\n\nYour reset code is:\n\n${resetCode}\n\nEnter it on the reset page within 30 minutes (it expires at ${expiresAt.toUTCString()}). If you did not request this, you can safely ignore this email.\n\n- The Northstar team`,
      html: `<p>Hi,</p><p>We received a request to reset your Northstar account password.</p><p><strong>Your reset code is:</strong></p><p style="font-size:20px;letter-spacing:2px;font-weight:bold;">${resetCode}</p><p>Enter it on the reset page within 30 minutes (it expires at ${expiresAt.toUTCString()}). If you did not request this, you can safely ignore this email.</p><p>&mdash; The Northstar team</p>`,
    });
  } catch (error) {
    // Full detail to the logs, clean message to the browser.
    console.error('[mailer] sendResetEmail failed:', error && (error.code || ''), error && error.message);
    const wrapped = new Error('Reset email could not be sent.');
    wrapped.smtpReason = error.smtpReason || describeSmtpError(error).reason;
    wrapped.clientMessage = describeSmtpError(error).client;
    throw wrapped;
  }

  return true;
}

module.exports = { sendResetEmail, getTransporter, verifyMailer, describeSmtpError };
