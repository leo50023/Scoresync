/**
 * ScoreSync Mailer — sends emails via Gmail SMTP
 * Requires env vars: GMAIL_USER and GMAIL_APP_PASSWORD
 * Get app password: https://myaccount.google.com/apppasswords
 */
import nodemailer from 'nodemailer';

let _transporter = null;

function getTransporter() {
  if (_transporter) return _transporter;

  const user = process.env.GMAIL_USER;
  const pass = process.env.GMAIL_APP_PASSWORD;

  if (!user || !pass) {
    console.warn('[mailer] GMAIL_USER or GMAIL_APP_PASSWORD not set — email sending disabled.');
    return null;
  }

  _transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: { user, pass },
    tls: { rejectUnauthorized: false },
  });

  return _transporter;
}

/**
 * Send an email. Silently fails if credentials not configured.
 * @param {object} opts - { to, subject, text, html }
 */
export async function sendMail({ to, subject, text, html }) {
  const transporter = getTransporter();
  if (!transporter) return;
  try {
    await transporter.verify();
  } catch (verifyErr) {
    console.error('[mailer] SMTP verify failed:', verifyErr);
  }
  try {
    await transporter.sendMail({
      from: `"ScoreSync" <${process.env.GMAIL_USER}>`,
      to, subject, text, html,
    });
  } catch (err) {
    console.error('[mailer] Failed to send email:', err);
  }
}

/**
 * Send judge assignment notification email.
 */
export async function sendJudgeAssignedEmail({ judgeName, judgeEmail, eventName, eventDate, eventVenue }) {
  const subject = `You've been assigned as Judge — ${eventName}`;
  const text =
    `Dear ${judgeName || 'Judge'},\n\n` +
    `You have been assigned as an official judge for:\n\n` +
    `Event: ${eventName}\n` +
    `Date: ${eventDate || 'TBA'}\n` +
    `Venue: ${eventVenue || 'TBA'}\n\n` +
    `Please log in to ScoreSync to view your assigned event and submit scores when the event goes live.\n\n` +
    `Login: https://scoresync.site/login\n\n` +
    `Best regards,\nScoreSync`;

  const html = `
    <div style="font-family:Inter,sans-serif;max-width:520px;margin:0 auto;background:#0a0f1e;color:#e2e8f0;border-radius:16px;overflow:hidden">
      <div style="background:linear-gradient(135deg,#1e3a8a,#4f46e5);padding:28px 32px">
        <div style="font-size:11px;font-weight:800;letter-spacing:.12em;text-transform:uppercase;color:rgba(196,181,253,0.8);margin-bottom:8px">ScoreSync</div>
        <h1 style="font-size:22px;font-weight:900;color:#fff;margin:0">You've been assigned as Judge</h1>
      </div>
      <div style="padding:28px 32px">
        <p style="color:#94a3b8;font-size:14px;margin:0 0 20px">Dear <strong style="color:#e2e8f0">${judgeName || 'Judge'}</strong>,</p>
        <p style="color:#94a3b8;font-size:14px;margin:0 0 20px">You have been assigned as an official judge for the following event:</p>
        <div style="background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.1);border-radius:12px;padding:18px 20px;margin-bottom:24px">
          <div style="margin-bottom:10px"><span style="font-size:11px;color:#64748b;text-transform:uppercase;letter-spacing:.08em">Event</span><div style="font-size:16px;font-weight:800;color:#e2e8f0;margin-top:2px">${eventName}</div></div>
          <div style="display:flex;gap:24px;flex-wrap:wrap">
            <div><span style="font-size:11px;color:#64748b;text-transform:uppercase;letter-spacing:.08em">Date</span><div style="font-size:13px;font-weight:600;color:#e2e8f0;margin-top:2px">${eventDate || 'TBA'}</div></div>
            <div><span style="font-size:11px;color:#64748b;text-transform:uppercase;letter-spacing:.08em">Venue</span><div style="font-size:13px;font-weight:600;color:#e2e8f0;margin-top:2px">${eventVenue || 'TBA'}</div></div>
          </div>
        </div>
        <a href="https://scoresync.site/login" style="display:inline-block;background:linear-gradient(135deg,#4f46e5,#7c3aed);color:#fff;font-weight:700;font-size:14px;padding:12px 28px;border-radius:10px;text-decoration:none">Log in to ScoreSync →</a>
        <p style="color:#475569;font-size:12px;margin-top:24px">If you have questions, contact the event organizer.</p>
      </div>
    </div>`;

  await sendMail({ to: judgeEmail, subject, text, html });
}
