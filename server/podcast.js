// The podcast: each message streamed or uploaded through Mux gets an audio-only file (made by
// Mux from its trimmed copy when it's trimmed), and /podcast.xml lists them in the format Apple
// Podcasts, Spotify and the other podcast apps read. Submit that address to them once; they
// check it on their own, so new messages show up there with no one uploading anything.
import { getSetting, setSetting } from './db.js';

export const PODCAST_DEFAULTS = {
  enabled: false,
  title: '',
  author: '',
  description: '',
  email: '',
  image: '',
  category: 'Religion & Spirituality',
  subcategory: 'Christianity',
  language: 'en-us',
};
export const podcastSettings = (db) => {
  const s = { ...PODCAST_DEFAULTS, ...getSetting(db, 'podcast', {}) };
  const church = getSetting(db, 'church_name', 'Church');
  return { ...s, title: s.title || `${church} Messages`, author: s.author || church };
};
export const savePodcast = (db, changes) => setSetting(db, 'podcast', { ...getSetting(db, 'podcast', {}), ...changes });

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c]));
const site = () => (process.env.PUBLIC_URL || '').trim().replace(/\/+$/, '');
const abs = (url, base) => (!url ? '' : /^https?:\/\//.test(url) ? url : `${base}${url}`);

// Which Mux video an episode's audio comes from: the trimmed copy once it's ready, or the whole
// recording when it isn't trimmed. null while a trimmed copy is still being made.
export function audioSource(m) {
  if (m.source !== 'mux' || !m.playback_id) return null;
  const trimmed = m.start_sec || m.end_sec != null;
  const clipOk = m.clip_status === 'ready' && m.clip_asset_id && m.clip_start === m.start_sec && (m.clip_end ?? null) === (m.end_sec ?? null);
  if (clipOk) return { asset: m.clip_asset_id, playback: m.clip_playback_id };
  if (m.raw_deleted && m.clip_asset_id && m.clip_status === 'ready') return { asset: m.clip_asset_id, playback: m.clip_playback_id };
  if (trimmed) return null;
  return { asset: m.mux_asset_id, playback: m.playback_id };
}

// Every minute (from the Mux check): ask Mux for the audio files episodes need, and notice when
// they're ready. mux: the Mux API call from mux.js.
export async function podcastAudio(db, mux) {
  if (!podcastSettings(db).enabled) return;
  const rows = db.prepare("SELECT * FROM media WHERE status = 'published' AND podcast = 1 AND source = 'mux' AND playback_id IS NOT NULL ORDER BY day DESC LIMIT 200").all();
  let asked = 0;
  for (const m of rows) {
    const want = audioSource(m);
    if (!want) continue;
    if (m.audio_asset_id !== want.asset) {
      if (asked++ >= 10) continue; // a few at a time
      try {
        await mux('POST', `/video/v1/assets/${want.asset}/static-renditions`, { resolution: 'audio-only' });
      } catch (e) {
        // Already asked for (409/400 "exists"): fine, just wait for it. Anything else: try again later.
        if (![400, 409].includes(e.status)) continue;
      }
      db.prepare("UPDATE media SET audio_asset_id = ?, audio_playback_id = ?, audio_status = 'making', audio_size = NULL WHERE id = ?").run(want.asset, want.playback, m.id);
      continue;
    }
    if (m.audio_status !== 'making') continue;
    try {
      const { data: a } = await mux('GET', `/video/v1/assets/${m.audio_asset_id}`);
      const file = (a.static_renditions?.files || []).find((f) => f.resolution === 'audio-only' || f.name === 'audio.m4a');
      if (file?.status === 'ready') db.prepare("UPDATE media SET audio_status = 'ready', audio_size = ? WHERE id = ?").run(Number(file.filesize) || null, m.id);
      else if (['errored', 'skipped'].includes(file?.status)) db.prepare("UPDATE media SET audio_status = 'failed' WHERE id = ?").run(m.id);
    } catch (e) {
      if (e.status === 404) db.prepare("UPDATE media SET audio_status = 'failed', audio_asset_id = NULL WHERE id = ?").run(m.id);
    }
  }
}

// The episodes: published, in the podcast, with their audio ready (and still the right audio).
export function episodes(db, limit = 300) {
  return db.prepare("SELECT * FROM media WHERE status = 'published' AND podcast = 1 AND audio_status = 'ready' ORDER BY day DESC, recorded_at DESC LIMIT ?")
    .all(limit).filter((m) => audioSource(m)?.asset === m.audio_asset_id);
}

const rfc822 = (utc) => new Date(`${String(utc).replace(' ', 'T')}Z`).toUTCString();

// The feed itself (RSS 2.0 with Apple's podcast tags). base: the hub's own address.
export function podcastXml(db, base) {
  const p = podcastSettings(db);
  const root = site() || base;
  const items = episodes(db).map((m) => {
    const length = Math.max(0, (m.end_sec ?? m.duration ?? 0) - (m.start_sec || 0));
    const notes = [m.speaker && `Speaker: ${m.speaker}`, m.series && `Series: ${m.series}`, m.scripture && `Scripture: ${m.scripture}`, m.description].filter(Boolean).join('\n');
    const image = abs(m.image, root);
    return `    <item>
      <title>${esc(m.title)}</title>
      <guid isPermaLink="false">mb-media-${m.id}</guid>
      <pubDate>${rfc822(m.recorded_at)}</pubDate>
      <link>${esc(`${root}/app/#/watch/${m.id}`)}</link>
      <description>${esc(notes)}</description>
      <enclosure url="https://stream.mux.com/${esc(m.audio_playback_id)}/audio.m4a" length="${m.audio_size || 0}" type="audio/x-m4a"/>
      <itunes:duration>${length}</itunes:duration>${m.speaker ? `\n      <itunes:author>${esc(m.speaker)}</itunes:author>` : ''}${image ? `\n      <itunes:image href="${esc(image)}"/>` : ''}
      <itunes:explicit>false</itunes:explicit>
      <itunes:episodeType>full</itunes:episodeType>
    </item>`;
  });
  const image = abs(p.image, root);
  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:itunes="http://www.itunes.com/dtds/podcast-1.0.dtd" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>${esc(p.title)}</title>
    <link>${esc(`${root}/app/#/watch`)}</link>
    <atom:link href="${esc(`${root}/podcast.xml`)}" rel="self" type="application/rss+xml"/>
    <language>${esc(p.language)}</language>
    <description>${esc(p.description || p.title)}</description>
    <itunes:author>${esc(p.author)}</itunes:author>
    <itunes:owner><itunes:name>${esc(p.author)}</itunes:name><itunes:email>${esc(p.email)}</itunes:email></itunes:owner>${image ? `\n    <itunes:image href="${esc(image)}"/>` : ''}
    <itunes:category text="${esc(p.category)}">${p.subcategory ? `<itunes:category text="${esc(p.subcategory)}"/>` : ''}</itunes:category>
    <itunes:explicit>false</itunes:explicit>
    <itunes:type>episodic</itunes:type>
${items.join('\n')}
  </channel>
</rss>
`;
}
