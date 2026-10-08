// Stripe: the few REST calls giving needs, without the SDK. Keys come from the environment
// (Render → Environment): STRIPE_SECRET_KEY, STRIPE_PUBLISHABLE_KEY and STRIPE_WEBHOOK_SECRET.
// STRIPE_API_URL is only for tests.
import crypto from 'node:crypto';

const base = () => (process.env.STRIPE_API_URL || 'https://api.stripe.com/v1').replace(/\/+$/, '');
export const stripeConfigured = () => Boolean((process.env.STRIPE_SECRET_KEY || '').trim() && (process.env.STRIPE_PUBLISHABLE_KEY || '').trim());
export const publishableKey = () => (process.env.STRIPE_PUBLISHABLE_KEY || '').trim();

// Stripe takes form fields with nested names: line_items[0][price_data][currency]=usd.
export function encode(obj, prefix = '', out = new URLSearchParams()) {
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined || v === null) continue;
    const key = prefix ? `${prefix}[${k}]` : k;
    if (Array.isArray(v)) v.forEach((x, i) => (typeof x === 'object' ? encode(x, `${key}[${i}]`, out) : out.append(`${key}[${i}]`, String(x))));
    else if (typeof v === 'object') encode(v, key, out);
    else out.append(key, String(v));
  }
  return out;
}

export async function stripe(method, path, params) {
  const query = method === 'GET' && params ? `?${encode(params)}` : '';
  const res = await fetch(base() + path + query, {
    method,
    headers: { authorization: `Bearer ${process.env.STRIPE_SECRET_KEY.trim()}`, 'content-type': 'application/x-www-form-urlencoded', 'stripe-version': '2024-06-20' },
    body: method !== 'GET' && params ? encode(params) : undefined,
    signal: AbortSignal.timeout(20e3),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.error?.message || `Payment service error (${res.status}).`);
    err.status = res.status;
    throw err;
  }
  return data;
}

// Checks a webhook really came from Stripe (the Stripe-Signature header: t=…,v1=…).
export function verifyWebhook(raw, header, secret = (process.env.STRIPE_WEBHOOK_SECRET || '').trim(), toleranceSec = 600) {
  if (!secret || !header) return null;
  const parts = Object.fromEntries(header.split(',').map((p) => p.split('=')).filter((p) => p.length === 2).map(([k, v]) => [k, v]));
  const sigs = header.split(',').filter((p) => p.startsWith('v1=')).map((p) => p.slice(3));
  const t = Number(parts.t);
  if (!t || !sigs.length || Math.abs(Date.now() / 1000 - t) > toleranceSec) return null;
  const expected = crypto.createHmac('sha256', secret).update(`${t}.${raw}`).digest('hex');
  const ok = sigs.some((s) => s.length === expected.length && crypto.timingSafeEqual(Buffer.from(s), Buffer.from(expected)));
  if (!ok) return null;
  try { return JSON.parse(raw); } catch { return null; }
}

// What a giver adds to cover the fee, so the church receives the full amount:
// gross = (amount + fixed) / (1 - percent), rounded up to the cent.
export function coverFee(amountCents, percent, fixedCents) {
  const gross = Math.ceil((amountCents + fixedCents) / (1 - percent / 100));
  return Math.max(0, gross - amountCents);
}
