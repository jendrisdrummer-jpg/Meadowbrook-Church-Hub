// Settings → Backups: is everything set up, the copies, "Back up now", and how to restore.
import { get, post, del, html, mount, icon, toast, fail, confirm, fmtDate } from '../lib.js';
import { hashQuery } from '../app.js';

const size = (n) => (n > 1e6 ? `${(n / 1e6).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1e3))} KB`);
const when = (utc) => {
  const d = new Date(`${utc.replace(' ', 'T')}Z`);
  return `${fmtDate(d.toLocaleDateString('en-CA'), { weekday: 'short', month: 'short', day: 'numeric' })} · ${d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`;
};

export async function backups(panel) {
  const d = await get('/backups');
  const q = hashQuery();
  if (q.get('drive') === 'connected') { toast('Google Drive is connected. Backups will go there.'); history.replaceState(null, '', '#/settings/backups'); }
  const driveError = q.get('drive_error');
  const last = d.backups.find((b) => b.status !== 'running');
  const lastOk = d.backups.find((b) => b.status === 'ok');
  const step = (ok, title, body) => html`<div class="bk-step ${ok ? 'ok' : ''}"><span class="bk-mark">${icon(ok ? 'check' : 'alert')}</span><div class="grow"><b>${title}</b><div class="small">${body}</div></div></div>`;

  mount(panel, html`<div class="grid two bk-grid">
    <div class="card stack"><div class="card-head"><h2>Nightly backups</h2>
        <button class="btn primary" data-run ${d.password_set && !d.running ? '' : 'disabled'}>${icon('upload')} ${d.running ? 'Backing up…' : 'Back up now'}</button></div>
      ${driveError ? html`<div class="alert bad">${driveError}</div>` : ''}
      ${step(d.password_set, d.password_set ? 'Backups are locked with your password' : 'Add a backup password',
        d.password_set ? html`Set as <code>MB_BACKUP_PASSWORD</code> in Render. Keep a copy somewhere safe (a password manager): without it, no one can open a backup.`
          : html`In Render → your service → <b>Environment</b>, add <code>MB_BACKUP_PASSWORD</code> with a long password of your choosing, then save. Write it down somewhere safe.`)}
      ${step(Boolean(d.drive), d.drive ? html`Copies go to Google Drive (${d.drive.email || 'connected'})` : 'Connect Google Drive for an off-site copy',
        d.drive ? html`Look for the <b>Hub backups</b> folder in that Drive. <button class="btn small ghost" data-disconnect>Disconnect</button>`
          : d.google_ready ? html`Sign in with the Google account that should keep the backups. The hub can only see the files it puts there. <a class="btn small" href="/auth/google/drive" style="margin-top:6px">${icon('link')} Connect Google Drive</a>`
            : html`Google sign-in isn’t set up on the server yet (README → Google sign-in).`)}
      ${step(lastOk && last?.status === 'ok', lastOk ? `Last backup: ${when(lastOk.created_at)}` : 'No backup yet',
        last?.status === 'failed' ? html`<span class="bad-text">The last try didn’t finish: ${last.error}</span>` : html`Runs every night after 3:00 a.m. The last 14 copies are kept, plus one a month for a year.${d.files_backed_up ? ` ${d.files_backed_up} uploaded files (photos, song files) are backed up too.` : ''}`)}
    </div>
    <div class="card"><h2>Restoring</h2>
      <ol class="small bk-restore"><li>Download a copy below (or from the Drive folder).</li>
        <li>On a computer with the hub’s code: <code>MB_BACKUP_PASSWORD=… npm run restore -- the-file.db.gz.enc</code>. That gives you a <code>.db</code> file.</li>
        <li>With the hub stopped, put it where <code>MB_DB</code> points (on Render, the disk) and start the hub again.</li></ol>
      <p class="muted small" style="margin:8px 0 0">Uploaded files are in the folder’s <b>Uploaded files</b>, one locked file each, unlocked the same way.</p></div>
  </div>
  <div class="card" style="margin-top:14px"><h2>Copies</h2>
    ${d.backups.length ? html`<table class="list"><thead><tr><th>When</th><th>Size</th><th>Where</th><th>Status</th><th></th></tr></thead><tbody>
      ${d.backups.map((b) => html`<tr class="${b.status === 'failed' ? 'muted' : ''}"><td class="nowrap">${when(b.created_at)}${b.reason === 'manual' ? html` <span class="pill">By hand</span>` : ''}</td>
        <td class="small">${b.size ? size(b.size) : '—'}${b.files ? html`<div class="muted">+${b.files} files</div>` : ''}</td>
        <td class="small">${[b.in_drive ? 'Google Drive' : '', b.local ? 'This server' : ''].filter(Boolean).join(' · ') || html`<span class="muted">Cleaned up</span>`}</td>
        <td>${b.status === 'ok' ? html`<span class="pill good">OK</span>` : b.status === 'running' ? html`<span class="pill warn">Running</span>` : html`<span class="pill bad" title="${b.error}">Failed</span>`}</td>
        <td style="text-align:right">${b.status === 'ok' && (b.in_drive || b.local) ? html`<a class="btn small ghost" href="/api/backups/${b.id}/download">${icon('download')} Download</a>` : ''}</td></tr>`)}
    </tbody></table>` : html`<p class="muted" style="margin:0">No backups yet.</p>`}</div>`);

  panel.onclick = async (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.matches('[data-run]')) {
      b.disabled = true;
      b.textContent = 'Backing up…';
      try { const r = await post('/backups/run', {}); toast(r.drive_id ? 'Backed up to Google Drive.' : 'Backed up on this server. Connect Google Drive for an off-site copy.'); } catch (err) { fail(err); }
      return backups(panel);
    }
    if (b.matches('[data-disconnect]')) {
      if (!(await confirm('Disconnect Google Drive?', 'New backups stay on this server only until you connect it again. Copies already in Drive stay there.', 'Disconnect'))) return;
      try { await del('/backups/drive'); toast('Disconnected.'); backups(panel); } catch (err) { fail(err); }
    }
  };
}
