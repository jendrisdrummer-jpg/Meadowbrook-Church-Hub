// Sends email over SMTP (e.g. Gmail with the church's web@ account and an app password),
// using only Node's built-in TLS. Settings:
//   MB_SMTP_USER   the account to send from, e.g. web@mbclife.church
//   MB_SMTP_PASS   its app password (Google Account → Security → App passwords)
//   MB_SMTP_HOST   default smtp.gmail.com;  MB_SMTP_PORT  default 465 (TLS)
//   MB_MAIL_FROM   optional display name, e.g. "Meadowbrook Church"
// Without them (local testing), messages are kept in `outbox` and printed instead.
import tls from 'node:tls';
import crypto from 'node:crypto';

export const outbox = [];
export const mailConfigured = () => Boolean(process.env.MB_SMTP_USER && process.env.MB_SMTP_PASS);
export const canSendMail = () => mailConfigured() || process.env.MB_DEV_LOGIN === '1' || process.env.NODE_TEST_CONTEXT !== undefined;

// Header-safe text: no line breaks, non-ASCII encoded (RFC 2047).
const header = (s) => {
  const clean = String(s).replace(/[\r\n]+/g, ' ');
  return /^[\x20-\x7e]*$/.test(clean) ? clean : `=?UTF-8?B?${Buffer.from(clean).toString('base64')}?=`;
};
const addr = (s) => {
  const a = String(s).trim();
  if (!/^[^\s@<>",;]+@[^\s@<>",;]+$/.test(a)) throw new Error('Invalid email address.');
  return a;
};

function message({ from, fromName, to, subject, text, html }) {
  const boundary = `b${crypto.randomBytes(12).toString('hex')}`;
  const b64 = (s) => Buffer.from(s).toString('base64').replace(/.{76}/g, '$&\r\n');
  return [
    `From: ${fromName ? `${header(fromName)} ` : ''}<${from}>`,
    `To: <${to}>`,
    `Subject: ${header(subject)}`,
    `Date: ${new Date().toUTCString()}`,
    `Message-ID: <${crypto.randomUUID()}@${from.split('@')[1]}>`,
    'MIME-Version: 1.0',
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
    '',
    `--${boundary}`,
    'Content-Type: text/plain; charset=utf-8',
    'Content-Transfer-Encoding: base64',
    '',
    b64(text),
    `--${boundary}`,
    'Content-Type: text/html; charset=utf-8',
    'Content-Transfer-Encoding: base64',
    '',
    b64(html || `<pre style="font-family:inherit">${text.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c])}</pre>`),
    `--${boundary}--`,
    '',
  ].join('\r\n');
}

// A minimal SMTP conversation: greet, log in, send one message, quit.
function smtpSend({ host, port, user, pass }, from, to, data) {
  return new Promise((resolve, reject) => {
    const sock = tls.connect({ host, port, servername: host });
    sock.setTimeout(20000, () => sock.destroy(new Error('Email server timed out.')));
    let buf = '';
    const steps = [
      [null, 220],
      [`EHLO ${from.split('@')[1]}`, 250],
      [`AUTH PLAIN ${Buffer.from(`\0${user}\0${pass}`).toString('base64')}`, 235],
      [`MAIL FROM:<${from}>`, 250],
      [`RCPT TO:<${to}>`, 250],
      ['DATA', 354],
      [`${data.replace(/^\./gm, '..')}\r\n.`, 250],
      ['QUIT', 221],
    ];
    let i = 0;
    const next = () => {
      const [cmd] = steps[i];
      if (cmd) sock.write(`${cmd}\r\n`);
    };
    sock.on('data', (chunk) => {
      buf += chunk.toString();
      // A reply is complete when its last line has a space after the code ("250 OK").
      const lines = buf.split('\r\n').filter(Boolean);
      const last = lines.at(-1);
      if (!last || !/^\d{3} /.test(last) || !buf.endsWith('\r\n')) return;
      buf = '';
      const code = Number(last.slice(0, 3));
      if (code !== steps[i][1]) {
        sock.destroy();
        return reject(new Error(code === 535 ? 'The email account or app password was rejected.' : `Email server said: ${last}`));
      }
      i++;
      if (i >= steps.length) { sock.end(); return resolve(); }
      next();
    });
    sock.on('error', reject);
  });
}

export async function sendMail({ to, subject, text, html }) {
  to = addr(to);
  if (!mailConfigured()) {
    outbox.push({ to, subject, text, html, at: new Date().toISOString() });
    if (outbox.length > 50) outbox.shift();
    if (!process.env.NODE_TEST_CONTEXT) console.log(`[email not set up] To ${to}: ${subject}\n${text}`);
    return;
  }
  const user = process.env.MB_SMTP_USER.trim();
  const cfg = { host: (process.env.MB_SMTP_HOST || 'smtp.gmail.com').trim(), port: Number(process.env.MB_SMTP_PORT) || 465, user, pass: process.env.MB_SMTP_PASS.replace(/\s+/g, '') };
  const from = addr(user);
  await smtpSend(cfg, from, to, message({ from, fromName: process.env.MB_MAIL_FROM, to, subject, text, html }));
}
