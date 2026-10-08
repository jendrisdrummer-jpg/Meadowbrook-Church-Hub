// Settings → Backups (admins): status, the copies, "Back up now", downloads, Google Drive.
import { Router } from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { requireRole } from '../auth.js';
import { HttpError, notFound, int, audit } from '../http.js';
import { runBackup, backupStatus, backupDir, downloadFromDrive, disconnectDrive } from '../backup.js';

export default function backupRoutes(db, { uploadDir }) {
  const r = Router();
  // A run that was cut off by a restart never finished.
  db.prepare("UPDATE backups SET status = 'failed', error = 'Stopped by a server restart.' WHERE status = 'running'").run();

  r.get('/backups', requireRole('admin'), (_req, res) => {
    res.json({
      ...backupStatus(db),
      backups: db.prepare('SELECT id, name, size, files, status, error, drive_id IS NOT NULL in_drive, local, reason, created_at FROM backups ORDER BY id DESC LIMIT 40').all(),
    });
  });

  r.post('/backups/run', requireRole('admin'), async (req, res) => {
    audit(db, req, 'backup.run');
    const b = await runBackup(db, { uploadDir, reason: 'manual' });
    res.status(b.status === 'ok' ? 201 : 500).json(b.status === 'ok' ? b : { ...b, error: b.error });
  });

  // The encrypted copy itself (unlock it with the backup password and `npm run restore`).
  r.get('/backups/:id/download', requireRole('admin'), async (req, res) => {
    const b = db.prepare("SELECT * FROM backups WHERE id = ? AND status = 'ok'").get(int(req.params.id));
    if (!b) throw notFound('Backup');
    const local = path.join(backupDir(), b.name);
    let data;
    if (b.local && fs.existsSync(local)) data = fs.readFileSync(local);
    else if (b.drive_id) data = await downloadFromDrive(db, b.drive_id).catch((e) => { throw new HttpError(502, e.message); });
    else throw notFound('That copy (it was cleaned up)');
    audit(db, req, 'backup.download', b.name);
    res.setHeader('Content-Disposition', `attachment; filename="${b.name}"`);
    res.type('application/octet-stream').send(data);
  });

  r.delete('/backups/drive', requireRole('admin'), (req, res) => {
    disconnectDrive(db);
    audit(db, req, 'backup.drive.disconnect');
    res.json({ ok: true });
  });

  return r;
}
