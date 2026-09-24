const nodemailer = require('nodemailer');

const HOST = process.env.SMTP_HOST || 'smtp.gmail.com';
const PORT = Number(process.env.SMTP_PORT || 465);
const USER = process.env.SMTP_USER;
const PASS = process.env.SMTP_PASS;
const FROM = process.env.EMAIL_FROM || USER || 'northstar@localhost';

let transporter = null;

function getTransporter() {
  if (!USER || !PASS) return null;

  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: HOST,
      port: PORT,
      secure: PORT === 465,
      auth: { user: USER.trim(), pass: PASS.trim() },
    });
  }
  return transporter;
}

async function sendResetEmail({ to, resetCode, expiresAt }) {
  const t = getTransporter();
  if (!t) return false;

  await t.sendMail({
    from: FROM,
    to,
    subject: 'Reset your Northstar password',
    text: `Hi,\n\nWe received a request to reset your Northstar account password.\n\nYour reset code is:\n\n${resetCode}\n\nEnter it on the reset page within 30 minutes (it expires at ${expiresAt.toUTCString()}). If you did not request this, you can safely ignore this email.\n\n- The Northstar team`,
    html: `<p>Hi,</p><p>We received a request to reset your Northstar account password.</p><p><strong>Your reset code is:</strong></p><p style="font-size:20px;letter-spacing:2px;font-weight:bold;">${resetCode}</p><p>Enter it on the reset page within 30 minutes (it expires at ${expiresAt.toUTCString()}). If you did not request this, you can safely ignore this email.</p><p>&mdash; The Northstar team</p>`,
  });

  return true;
}

module.exports = { sendResetEmail, getTransporter };