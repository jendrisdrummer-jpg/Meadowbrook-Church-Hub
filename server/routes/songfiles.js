// Files on songs: chord charts, lyrics and sheet music (PDF, image or text) and audio to learn
// from. Anyone signed in can open them from a service plan; leaders and up add and remove them.
import { Router } from 'express';
import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { requireRole } from '../auth.js';
import { bad, notFound, int, str, oneOf, audit } from '../http.js';

export const KINDS = ['chart', 'lyrics', 'sheet', 'audio', 'other'];
const TYPES = {
  'application/pdf': 'pdf', 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'text/plain': 'txt',
  'audio/mpeg': 'mp3', 'audio/mp3': 'mp3', 'audio/mp4': 'm4a', 'audio/x-m4a': 'm4a', 'audio/aac': 'aac', 'audio/wav': 'wav', 'audio/x-wav': 'wav', 'audio/ogg': 'ogg',
};

// What a file probably is, from its type and name ("Way Maker - Lyrics.pdf").
function guessKind(mime, name) {
  if (mime.startsWith('audio/')) return 'audio';
  if (/lyric/i.test(name)) return 'lyrics';
  if (/chord|chart/i.test(name)) return 'chart';
  if (/sheet|lead|score|vocal|piano/i.test(name)) return 'sheet';
  return mime === 'application/pdf' || mime === 'text/plain' ? 'chart' : 'other';
}

export function filesForSongs(db, songIds) {
  const ids = [...new Set(songIds.filter(Boolean))];
  if (!ids.length) return new Map();
  const rows = db.prepare(`SELECT id, song_id, kind, name, song_key, mime, size FROM song_files WHERE song_id IN (${ids.map(() => '?').join(',')}) ORDER BY kind = 'audio', kind, song_key, name`).all(...ids);
  return Map.groupBy(rows, (f) => f.song_id);
}

export default function songFileRoutes(db, { uploadDir }) {
  const r = Router();
  const dir = path.join(uploadDir, 'songs');
  const song = (id) => {
    const s = db.prepare('SELECT id, title FROM songs WHERE id = ?').get(int(id));
    if (!s) throw notFound('Song');
    return s;
  };

  r.get('/songs/:id/files', requireRole('volunteer'), (req, res) => {
    const s = song(req.params.id);
    res.json(filesForSongs(db, [s.id]).get(s.id) || []);
  });

  // The file itself: ?name=… (the original file name) and the type from Content-Type.
  r.post('/songs/:id/files', requireRole('leader'), express.raw({ type: () => true, limit: '40mb' }), (req, res) => {
    const s = song(req.params.id);
    const mime = String(req.get('content-type') || '').split(';')[0].trim().toLowerCase();
    if (!TYPES[mime]) throw bad('Add a PDF, picture, text file or audio (MP3, M4A, WAV).');
    if (!Buffer.isBuffer(req.body) || !req.body.length) throw bad('That file is empty.');
    const name = str(req.query.name, 120).replace(/[\\/]/g, '-') || `${s.title}.${TYPES[mime]}`;
    const file = `${crypto.randomBytes(12).toString('hex')}.${TYPES[mime]}`;
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, file), req.body);
    const kind = KINDS.includes(req.query.kind) ? req.query.kind : guessKind(mime, name);
    const id = db.prepare('INSERT INTO song_files (song_id, kind, name, song_key, file, mime, size, uploaded_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .run(s.id, kind, name, str(req.query.key, 12), file, mime, req.body.length, req.user.id).lastInsertRowid;
    audit(db, req, 'song.file', `${s.title}: ${name}`);
    res.status(201).json(db.prepare('SELECT id, song_id, kind, name, song_key, mime, size FROM song_files WHERE id = ?').get(id));
  });

  r.patch('/song-files/:id', requireRole('leader'), (req, res) => {
    const f = db.prepare('SELECT * FROM song_files WHERE id = ?').get(int(req.params.id));
    if (!f) throw notFound('File');
    const b = req.body || {};
    db.prepare('UPDATE song_files SET name = ?, kind = ?, song_key = ? WHERE id = ?')
      .run(str(b.name ?? f.name, 120) || f.name, oneOf(b.kind ?? f.kind, KINDS, f.kind), str(b.song_key ?? f.song_key, 12), f.id);
    res.json(db.prepare('SELECT id, song_id, kind, name, song_key, mime, size FROM song_files WHERE id = ?').get(f.id));
  });

  r.delete('/song-files/:id', requireRole('leader'), (req, res) => {
    const f = db.prepare('SELECT * FROM song_files WHERE id = ?').get(int(req.params.id));
    if (!f) throw notFound('File');
    db.prepare('DELETE FROM song_files WHERE id = ?').run(f.id);
    fs.rm(path.join(dir, f.file), { force: true }, () => {});
    res.json({ ok: true });
  });

  // Opens in the browser (PDFs, pictures) or plays (audio, with seeking); ?download=1 saves it.
  r.get('/song-files/:id', requireRole('volunteer'), (req, res) => {
    const f = db.prepare('SELECT * FROM song_files WHERE id = ?').get(int(req.params.id));
    if (!f) throw notFound('File');
    const disp = req.query.download ? 'attachment' : 'inline';
    res.setHeader('Content-Disposition', `${disp}; filename*=UTF-8''${encodeURIComponent(f.name)}`);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.sendFile(path.join(dir, f.file), { headers: { 'Content-Type': f.mime }, maxAge: '1d' });
  });

  return r;
}
