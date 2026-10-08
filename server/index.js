// Meadowbrook Church Hub: web server entry point.
import express from 'express';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { openDb, getSetting } from './db.js';
import { authRoutes, loadUser, requireAppHeader, requireRole } from './auth.js';
import { errorHandler } from './http.js';
import setupRoutes from './routes/setup.js';
import peopleRoutes from './routes/people.js';
import teamRoutes from './routes/teams.js';
import serviceRoutes from './routes/services.js';
import seriesRoutes from './routes/series.js';
import checkinRoutes from './routes/checkin.js';
import attendanceRoutes from './routes/attendance.js';
import dashboardRoutes from './routes/dashboard.js';
import fieldRoutes from './routes/fields.js';
import templateRoutes from './routes/templates.js';
import notificationRoutes from './routes/notifications.js';
import appRoutes from './routes/app.js';
import chatRoutes from './routes/chat.js';
import taskRoutes, { sendTaskReminders } from './routes/tasks.js';
import callRoutes, { syncCalls } from './routes/calls.js';
import givingRoutes, { stripeWebhook } from './routes/giving.js';
import financeRoutes from './routes/finance.js';
import { sendReminders } from './notify.js';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

export function createApp({ db = openDb(), uploadDir = process.env.MB_UPLOADS || path.join(root, 'data', 'uploads') } = {}) {
  const app = express();
  app.disable('x-powered-by');
  // Behind a cloud load balancer / tunnel, trust its X-Forwarded-Proto so cookies are marked Secure.
  app.set('trust proxy', trustProxy(process.env.MB_TRUST_PROXY));

  app.use((_req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'same-origin');
    res.setHeader('X-Frame-Options', 'SAMEORIGIN'); // the App Builder previews the app in a frame
    next();
  });

  // Stripe's notices about gifts: the raw body is needed to check their signature, so this comes
  // before the JSON parser and the app-header check.
  app.post('/stripe/webhook', express.raw({ type: () => true, limit: '1mb' }), stripeWebhook(db));

  app.use(express.json({ limit: '2mb' }));
  app.use(loadUser(db));
  app.use(requireAppHeader);

  app.get('/healthz', (_req, res) => res.json({ ok: true }));
  authRoutes(app, db);

  const api = express.Router();
  api.use(setupRoutes(db, { uploadDir }));
  api.use(peopleRoutes(db, { uploadDir }));
  api.use(teamRoutes(db));
  api.use(serviceRoutes(db));
  api.use(seriesRoutes(db));
  api.use(checkinRoutes(db));
  api.use(attendanceRoutes(db));
  api.use(dashboardRoutes(db));
  api.use(fieldRoutes(db));
  api.use(templateRoutes(db));
  api.use(notificationRoutes(db));
  api.use(appRoutes(db, { uploadDir }));
  api.use(chatRoutes(db, { uploadDir }));
  api.use(taskRoutes(db));
  api.use(callRoutes(db));
  api.use(givingRoutes(db));
  api.use(financeRoutes(db));
  api.use((_req, res) => res.status(404).json({ error: 'Not found.' }));
  app.use('/api', api);

  // Home screen pictures are part of the public app.
  app.use('/uploads/app', express.static(path.join(uploadDir, 'app'), { maxAge: '30d', fallthrough: false }));
  // Photos include children, so they are only served to signed-in users.
  app.use('/uploads', requireRole('volunteer'), express.static(uploadDir, { maxAge: '7d', fallthrough: false }));

  // The installable app: its name, colours and icon come from Settings → Church.
  app.get('/manifest.webmanifest', (_req, res) => {
    // The staff dashboard, installable too; the member app has its own manifest under /app/.
    const name = `${getSetting(db, 'church_name', 'Church')} Hub`;
    const v = getSetting(db, 'app_icon_version', 0);
    res.type('application/manifest+json').json({
      id: '/',
      name,
      short_name: 'Hub',
      start_url: '/#/',
      scope: '/',
      display: 'standalone',
      background_color: '#ffffff',
      theme_color: getSetting(db, 'brand_color', '#135fd1'),
      icons: [
        { src: `/app-icon/192.png?v=${v}`, sizes: '192x192', type: 'image/png', purpose: 'any' },
        { src: `/app-icon/512.png?v=${v}`, sizes: '512x512', type: 'image/png', purpose: 'any' },
        { src: `/app-icon/512.png?v=${v}`, sizes: '512x512', type: 'image/png', purpose: 'maskable' },
      ],
    });
  });
  // An uploaded icon if there is one, otherwise the default.
  app.get('/app-icon/:size.png', (req, res) => {
    const size = ['180', '192', '512'].includes(req.params.size) ? req.params.size : '512';
    const custom = path.join(uploadDir, 'app-icon', `${size}.png`);
    res.setHeader('Cache-Control', 'public, max-age=86400');
    res.sendFile(fs.existsSync(custom) ? custom : path.join(root, 'public', 'icons', `icon-${size}.png`));
  });

  // The member app: its own address (MB_APP_URL, e.g. https://app.mbclife.church) opens it
  // straight away; on any address it also lives at /app/.
  const appHost = (() => { try { return new URL((process.env.MB_APP_URL || '').trim()).host; } catch { return ''; } })();
  app.get('/', (req, res, next) => (appHost && req.get('host') === appHost ? res.redirect('/app/') : next()));
  // Express matches /app and /app/ alike, so check the address itself.
  app.get('/app', (req, res, next) => (req.originalUrl.split('?')[0] === '/app' ? res.redirect('/app/') : next()));
  app.get('/app/manifest.webmanifest', (_req, res) => {
    const name = getSetting(db, 'church_name', 'Church');
    const v = getSetting(db, 'app_icon_version', 0);
    res.type('application/manifest+json').json({
      id: '/app/',
      name,
      short_name: getSetting(db, 'app_short_name', '') || name.split(' ')[0],
      start_url: '/app/',
      scope: '/app/',
      display: 'standalone',
      background_color: '#ffffff',
      theme_color: getSetting(db, 'brand_color', '#135fd1'),
      icons: [
        { src: `/app-icon/192.png?v=${v}`, sizes: '192x192', type: 'image/png', purpose: 'any' },
        { src: `/app-icon/512.png?v=${v}`, sizes: '512x512', type: 'image/png', purpose: 'any' },
        { src: `/app-icon/512.png?v=${v}`, sizes: '512x512', type: 'image/png', purpose: 'maskable' },
      ],
    });
  });

  const pub = path.join(root, 'public');
  app.use(express.static(pub, { extensions: ['html'], index: false }));
  const page = (file) => (_req, res) => res.sendFile(path.join(pub, file));
  app.get('/login', page('login.html'));
  app.get('/checkin', page('checkin.html'));
  app.get('/', page('app.html'));
  app.get('/app/', page('app/index.html'));
  app.get('/r/:id/:sig', page('respond.html'));
  app.get('/give', page('give.html'));
  // Back from Stripe after giving in the app: on to the app's thank-you.
  app.get('/app/give-done', (req, res) => res.redirect(`/app/#/give?done=${encodeURIComponent(String(req.query.session_id || '').replace(/[^\w]/g, ''))}`));

  app.use(errorHandler);
  return app;
}

// MB_TRUST_PROXY: a number of proxy hops ("1" on Render, Railway or Fly), "true", or a list of addresses.
function trustProxy(v) {
  if (!v) return 'loopback, linklocal, uniquelocal';
  if (/^\d+$/.test(v)) return Number(v);
  if (v === 'true' || v === 'false') return v === 'true';
  return v;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const port = Number(process.env.PORT) || 8090;
  const db = openDb();
  if (!process.env.GOOGLE_CLIENT_ID && process.env.MB_DEV_LOGIN !== '1') {
    console.warn('Google sign-in is not configured. Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET (see README), or MB_DEV_LOGIN=1 for local testing.');
  }
  fs.mkdirSync(path.join(root, 'data'), { recursive: true });
  createApp({ db }).listen(port, () => console.log(`Meadowbrook Church Hub on http://localhost:${port}`));
  // Serving reminders go out a day or two ahead (Settings: reminder_hours); task reminders the
  // morning before and the morning of.
  const remind = () => {
    try { sendReminders(db); } catch (e) { console.error('Reminders failed:', e.message); }
    try { sendTaskReminders(db); } catch (e) { console.error('Task reminders failed:', e.message); }
  };
  setTimeout(remind, 60e3).unref();
  setInterval(remind, 15 * 60e3).unref();
  // Video calls: meeting reminders, closing empty rooms, the monthly minutes limit.
  setInterval(() => syncCalls(db).catch((e) => console.error('Call sync failed:', e.message)), 60e3).unref();
}
