// Meadowbrook Church Hub: web server entry point.
import express from 'express';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { openDb, getSetting, SCHEMA_VERSION, purgeStale } from './db.js';
import { authRoutes, loadUser, requireAppHeader, requireRole } from './auth.js';
import { errorHandler } from './http.js';
import { devLoginAllowed, devLoginRequested } from './devlogin.js';
import setupRoutes from './routes/setup.js';
import peopleRoutes from './routes/people.js';
import teamRoutes from './routes/teams.js';
import serviceRoutes from './routes/services.js';
import songFileRoutes from './routes/songfiles.js';
import seriesRoutes from './routes/series.js';
import checkinRoutes from './routes/checkin.js';
import stationRoutes, { stationAuth } from './routes/stations.js';
import attendanceRoutes from './routes/attendance.js';
import dashboardRoutes from './routes/dashboard.js';
import fieldRoutes from './routes/fields.js';
import templateRoutes from './routes/templates.js';
import notificationRoutes from './routes/notifications.js';
import appRoutes from './routes/app.js';
import eventRoutes from './routes/events.js';
import searchRoutes from './routes/search.js';
import backupRoutes from './routes/backups.js';
import checkRoutes from './routes/checks.js';
import mediaRoutes from './routes/media.js';
import { syncMedia, checkLive } from './media.js';
import { muxTick } from './mux.js';
import { podcastSettings, podcastXml } from './podcast.js';
import { maybeNightly } from './backup.js';
import { isOffline, enableOffline, listenHost } from './offline.js';
import announcementRoutes, { sendDueAnnouncements } from './routes/announcements.js';
import chatRoutes from './routes/chat.js';
import groupRoutes from './routes/groups.js';
import taskRoutes, { sendTaskReminders } from './routes/tasks.js';
import callRoutes, { syncCalls } from './routes/calls.js';
import givingRoutes, { stripeWebhook } from './routes/giving.js';
import financeRoutes from './routes/finance.js';
import feedbackRoutes from './routes/feedback.js';
import formRoutes from './routes/forms.js';
import meRoutes from './routes/me.js';
import studyRoutes from './routes/studies.js';
import { sendReminders } from './notify.js';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

export function createApp({ db = openDb(), uploadDir = process.env.MB_UPLOADS || path.join(root, 'data', 'uploads'), now } = {}) {
  const app = express();
  app.disable('x-powered-by');
  // Behind a cloud load balancer / tunnel, trust its X-Forwarded-Proto so cookies are marked Secure.
  app.set('trust proxy', trustProxy(process.env.MB_TRUST_PROXY));

  app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    if (req.secure) res.setHeader('Strict-Transport-Security', 'max-age=15552000');
    // Not a full CSP (scripts are untouched): no plugins, no <base> tricks, and only this site may frame us.
    res.setHeader('Content-Security-Policy', "object-src 'none'; base-uri 'self'; frame-ancestors 'self'");
    // Camera, microphone and payment are left out on purpose: Daily's call frame and Stripe's
    // checkout frame are other sites, and a narrow list here would stop them working.
    res.setHeader('Permissions-Policy', 'geolocation=()');
    // Other sites see only our address (never a page or link), which YouTube needs to play
    // embedded videos (without it: "Error 153").
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('X-Frame-Options', 'SAMEORIGIN'); // the App Builder previews the app in a frame
    next();
  });

  // Stripe's notices about gifts: the raw body is needed to check their signature, so this comes
  // before the JSON parser and the app-header check.
  app.post('/stripe/webhook', express.raw({ type: () => true, limit: '1mb' }), stripeWebhook(db));

  app.use(express.json({ limit: '2mb' }));
  app.use(loadUser(db));
  app.use(requireAppHeader);

  // Public and quick: the database answers and is at the schema this code expects. No details.
  app.get('/healthz', (_req, res) => {
    try {
      db.prepare('SELECT 1').get();
      if (db.prepare('PRAGMA user_version').get().user_version !== SCHEMA_VERSION) throw new Error('schema');
      res.json({ ok: true });
    } catch {
      res.status(503).json({ ok: false, reason: 'database' });
    }
  });
  const auth = authRoutes(app, db);

  const api = express.Router();
  // Paired iPads (no one signed in) may use check-in, and nothing else.
  api.use(stationAuth(db));
  api.use(setupRoutes(db, { uploadDir }));
  api.use(peopleRoutes(db, { uploadDir }));
  api.use(teamRoutes(db));
  api.use(serviceRoutes(db));
  api.use(songFileRoutes(db, { uploadDir }));
  api.use(seriesRoutes(db));
  api.use(stationRoutes(db));
  api.use(checkinRoutes(db));
  api.use(attendanceRoutes(db));
  api.use(dashboardRoutes(db));
  api.use(fieldRoutes(db));
  api.use(templateRoutes(db));
  api.use(notificationRoutes(db));
  api.use(appRoutes(db, { uploadDir }));
  api.use(eventRoutes(db));
  api.use(searchRoutes(db));
  api.use(backupRoutes(db, { uploadDir }));
  api.use(checkRoutes(db, { codeCapHitAt: auth.codeCapHitAt }));
  api.use(mediaRoutes(db));
  api.use(announcementRoutes(db));
  api.use(chatRoutes(db, { uploadDir }));
  api.use(groupRoutes(db));
  api.use(taskRoutes(db));
  api.use(callRoutes(db));
  api.use(givingRoutes(db));
  api.use(financeRoutes(db));
  api.use(feedbackRoutes(db));
  api.use(formRoutes(db));
  api.use(studyRoutes(db, { now }));
  api.use(meRoutes(db));
  api.use((_req, res) => res.status(404).json({ error: 'Not found.' }));
  app.use('/api', api);

  // Home screen pictures are part of the public app.
  app.use('/uploads/app', express.static(path.join(uploadDir, 'app'), { maxAge: '30d', fallthrough: false }));
  // Photos include children, so they are only served to signed-in users.
  // Chat and song files have their own checked routes (/api/chat-files, /api/song-files); never the open folder.
  // The path is decoded and its dot segments resolved first, so %63hat, ./chat and x/../chat can't slip past.
  app.use('/uploads', (req, res, next) => {
    let p;
    try { p = path.posix.normalize(decodeURIComponent(req.path)); } catch { return res.status(404).end(); }
    return /^\/*(chat|songs)(\/|$)/i.test(p) ? res.status(404).end() : next();
  });
  app.use('/uploads', requireRole('volunteer'), express.static(uploadDir, {
    cacheControl: false, fallthrough: false,
    setHeaders: (res) => res.setHeader('Cache-Control', 'private, max-age=604800'), // photos of children: never a shared cache
  }));

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

  // The podcast feed podcast apps check (Media → Podcast).
  app.get('/podcast.xml', (req, res) => {
    if (!podcastSettings(db).enabled) return res.status(404).type('text').send('No podcast.');
    res.setHeader('Cache-Control', 'public, max-age=900');
    res.type('application/rss+xml').send(podcastXml(db, `${req.protocol}://${req.get('host')}`));
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
  // Back from paying for an event (when Stripe had to leave the page).
  app.get('/app/event-done', (req, res) => {
    const n = (v) => String(v || '').replace(/[^\w]/g, '');
    res.redirect(`/app/#/events/${n(req.query.event)}?signup=${n(req.query.signup)}&key=${n(req.query.key)}`);
  });

  app.use(errorHandler);
  return app;
}

// MB_TRUST_PROXY: a number of proxy hops ("2" on Render: its Cloudflare edge plus its load balancer;
// usually "1" on Railway or Fly), "true", or a list of addresses. Settings → Checks accepts 1 or 2.
export function trustProxy(v) {
  v = String(v ?? '').trim(); // pasted values often pick up stray spaces; the Checks page trims too
  if (!v) return 'loopback, linklocal, uniquelocal';
  if (/^\d+$/.test(v)) return Number(v);
  if (v === 'true' || v === 'false') return v === 'true';
  return v;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const port = Number(process.env.PORT) || 8090;
  const db = openDb();
  if (devLoginRequested() && !devLoginAllowed()) {
    console.warn('WARNING: MB_DEV_LOGIN=1 is set but IGNORED, because this server looks live (RENDER or NODE_ENV=production). Test sign-in stays off. Remove MB_DEV_LOGIN from the environment settings.');
  }
  if (!process.env.GOOGLE_CLIENT_ID && !devLoginAllowed()) {
    console.warn('Google sign-in is not configured. Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET (see README), or MB_DEV_LOGIN=1 for local testing.');
  }
  fs.mkdirSync(path.join(root, 'data'), { recursive: true });
  const offline = isOffline();
  if (offline) {
    enableOffline();
    console.warn('OFFLINE MODE: no push, Drive, payments, video or media calls, and no background jobs. For restore drills and local copies only.');
  }
  createApp({ db }).listen(port, listenHost(), () => console.log(`Meadowbrook Church Hub on http://localhost:${port}${offline ? ' (this computer only)' : ''}`));
  // Background jobs. Not in offline mode: they would reach real people and services.
  if (!offline) startJobs();
  function startJobs() {
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
    setInterval(() => sendDueAnnouncements(db), 60e3).unref();
    // Expired sessions and old sign-in codes, once a day (and shortly after start-up).
    const tidy = () => { try { purgeStale(db); } catch (e) { console.error('Clean-up failed:', e.message); } };
    setTimeout(tidy, 5 * 60e3).unref();
    setInterval(tidy, 24 * 3600e3).unref();
    // Nightly backup (from 3 a.m. church time; see Settings → Backups).
    setInterval(() => maybeNightly(db, { uploadDir: process.env.MB_UPLOADS || path.join(root, 'data', 'uploads') }), 10 * 60e3).unref();
    // Media: new videos from the YouTube channel every hour; around service times, every two
    // minutes, whether we're live.
    const mediaSync = () => syncMedia(db).catch((e) => console.error('Media sync failed:', e.message));
    setTimeout(mediaSync, 2 * 60e3).unref();
    setInterval(mediaSync, 60 * 60e3).unref();
    setInterval(() => checkLive(db).catch((e) => console.error('Live check failed:', e.message)), 2 * 60e3).unref();
    // Streaming through Mux: live or not, finished recordings and trimmed copies, every minute.
    setInterval(() => muxTick(db).catch((e) => console.error('Mux check failed:', e.message)), 60e3).unref();
  }
}
