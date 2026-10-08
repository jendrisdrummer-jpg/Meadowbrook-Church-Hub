// Web Push (RFC 8030/8291/8292) with Node's built-in crypto: VAPID-signed, aes128gcm-encrypted
// messages to the browsers and installed apps people allowed notifications on.
import crypto from 'node:crypto';
import { getSetting, setSetting } from './db.js';

const b64u = (buf) => Buffer.from(buf).toString('base64url');
const fromB64u = (s) => Buffer.from(String(s), 'base64url');

// The server's VAPID key pair, made once and kept in settings.
export function vapidKeys(db) {
  let pub = getSetting(db, 'vapid_public', '');
  let priv = getSetting(db, 'vapid_private', '');
  if (!pub || !priv) {
    const ecdh = crypto.createECDH('prime256v1');
    ecdh.generateKeys();
    pub = b64u(ecdh.getPublicKey());
    priv = b64u(ecdh.getPrivateKey());
    setSetting(db, 'vapid_public', pub);
    setSetting(db, 'vapid_private', priv);
  }
  return { publicKey: pub, privateKey: priv };
}

function privateKeyObject(publicKey, privateKey) {
  const pub = fromB64u(publicKey);
  return crypto.createPrivateKey({
    key: { kty: 'EC', crv: 'P-256', d: b64u(fromB64u(privateKey)), x: b64u(pub.subarray(1, 33)), y: b64u(pub.subarray(33, 65)) },
    format: 'jwk',
  });
}

// The Authorization header for one push service (RFC 8292).
export function vapidHeader(endpoint, keys, subject) {
  const aud = new URL(endpoint).origin;
  const header = b64u(JSON.stringify({ typ: 'JWT', alg: 'ES256' }));
  const claims = b64u(JSON.stringify({ aud, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub: subject }));
  const sig = crypto.sign('sha256', Buffer.from(`${header}.${claims}`), { key: privateKeyObject(keys.publicKey, keys.privateKey), dsaEncoding: 'ieee-p1363' });
  return `vapid t=${header}.${claims}.${b64u(sig)}, k=${keys.publicKey}`;
}

// Encrypts a payload for one subscription (RFC 8291, aes128gcm content coding).
export function encrypt(payload, p256dh, auth) {
  const uaPublic = fromB64u(p256dh);
  const authSecret = fromB64u(auth);
  const ecdh = crypto.createECDH('prime256v1');
  const asPublic = ecdh.generateKeys();
  const shared = ecdh.computeSecret(uaPublic);
  const keyInfo = Buffer.concat([Buffer.from('WebPush: info\0'), uaPublic, asPublic]);
  const ikm = Buffer.from(crypto.hkdfSync('sha256', shared, authSecret, keyInfo, 32));
  const salt = crypto.randomBytes(16);
  const cek = Buffer.from(crypto.hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: aes128gcm\0'), 16));
  const nonce = Buffer.from(crypto.hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: nonce\0'), 12));
  const cipher = crypto.createCipheriv('aes-128-gcm', cek, nonce);
  // One record: the payload, then the 0x02 "last record" delimiter.
  const body = Buffer.concat([cipher.update(Buffer.concat([Buffer.from(payload), Buffer.from([2])])), cipher.final(), cipher.getAuthTag()]);
  const rs = Buffer.alloc(4);
  rs.writeUInt32BE(4096);
  return Buffer.concat([salt, rs, Buffer.from([asPublic.length]), asPublic, body]);
}

// Sends one message. Resolves to the push service's HTTP status (404/410 = subscription gone).
export async function sendPush(sub, message, keys, subject, { ttl = 24 * 3600, urgency = 'normal' } = {}) {
  const res = await fetch(sub.endpoint, {
    method: 'POST',
    headers: {
      authorization: vapidHeader(sub.endpoint, keys, subject),
      'content-encoding': 'aes128gcm',
      'content-type': 'application/octet-stream',
      ttl: String(ttl),
      urgency,
    },
    body: encrypt(JSON.stringify(message), sub.p256dh, sub.auth),
  });
  return res.status;
}
