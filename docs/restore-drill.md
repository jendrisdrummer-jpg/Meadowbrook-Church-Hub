# Backup restore drill

A backup only counts if it can be restored. This drill proves it on a laptop, using a real backup,
**without touching production**. It takes about 30 minutes.

**When:**
- before the staff beta goes live
- before each release that adds database changes (migrations)
- then every three months

**Who:** an admin, with the developer on hand the first time.

## Before you start
- **Laptop:** use one with an encrypted disk (FileVault on a Mac, BitLocker on Windows).
- **What the copy holds:**
  - everyone's details, including children's allergies and medical notes
  - live sign-in sessions
  - the keys for sending push notifications

  Treat it like the church's keys: never copy, share or upload it, and delete it the same day.
- **A drill folder outside the code folder:** `mkdir -m 700 ~/restore-drill`. The restore script
  refuses to write inside the code folder, so a copy can't be committed by mistake.
- **The code:** a fresh clone of the repository.
  - **Until `milestone-1` is deployed, check out `milestone-1`** (`git checkout milestone-1`), not
    `main`. The `--check` option and offline mode exist only in `milestone-1`: on `main`'s code,
    `MB_OFFLINE` is ignored, so starting the hub on a real copy would run its background jobs
    (push to members' phones, reminders). Starting it in step 4 also takes the copy through the
    next deploy's database changes (migrations 30–35, session hashing, the one-account index):
    this is the real-data rehearsal for that deploy ([deploy-runbook.md](deploy-runbook.md)).
  - After that, use the code at the **same version as production** (`main`), or the next release
    to rehearse it. If the code is newer, the hub adds its newer database changes to the *copy*
    when it starts. That is harmless, but the check reports it.
- **The backup password:** it is `MB_BACKUP_PASSWORD` in Render → the service → Environment.
  - The restore script asks for it without showing what you type.
  - Don't put it on the command line: it would be saved in your shell history.
  - Never put it in chat, email, a document or a commit.

## Steps
1. **Get a backup.**
   - In the hub, go to Settings → Backups.
   - Press **Back up now**, or use last night's copy.
   - Press **Download** on it. The file ends in `.db.gz.enc` and stays locked until step 2.
2. **Unlock and check it.** Run this from the repository folder; the copy goes into the drill folder:
   ```sh
   npm run restore -- ~/Downloads/<backup>.db.gz.enc ~/restore-drill/drill.db --check
   ```
   Type the password when asked.
   - Expect `Integrity: ok`, the schema version, a table of counts, and **Restore check passed**.
   - It never overwrites a file. If `drill.db` exists, choose another name.
   - The copy is readable by your account only.
3. **Compare the counts** with what you know. For example:
   - people: roughly your People count in the hub
   - services and assignments: recent Sundays are there
   - check-ins: last Sunday's are there

   A table that is empty but shouldn't be is a failure.
4. **Look around** (optional, recommended the first time). Start the hub against the copy in
   **offline mode**:
   ```sh
   MB_OFFLINE=1 MB_DEV_LOGIN=1 MB_DB=~/restore-drill/drill.db PORT=8197 node --disable-warning=ExperimentalWarning server/index.js
   ```
   - **Check it's offline:** the terminal must say **OFFLINE MODE**. If it doesn't, stop (Ctrl+C) and
     check the command (and that you're on `milestone-1` or later).
   - **Before a release with migrations,** copy the start-up lines into the drill record (they hold
     no names or emails): whether a `WARNING: … more than one account` line appeared and how many,
     and any `Session conversion failed` line. In a second terminal, also run the read-only audit
     on the copy and note its summary line:
     `MB_DB=~/restore-drill/drill.db node --disable-warning=ExperimentalWarning scripts/audit-account-links.js`
     (this is checklist item 1.7; no Render Shell needed).
   - **What offline mode blocks:**
     - every outgoing call: push to phones, Google Drive, payments, video and media
     - all background jobs: reminders, announcements, backups
     - email, which stays on the laptop even if email settings happen to be set
   - **Only this laptop can open it.** Others on the same Wi-Fi can't connect.
   - **Don't use `npm start` or a `.env` file** here: those could carry real settings.
   - Open http://localhost:8197 and sign in with test sign-in as yourself.
   - **Spot-check:**
     - a person you edited recently
     - next Sunday's schedule
     - last Sunday's check-in history
     - a team chat
   - Stop it with Ctrl+C. Test sign-in lets anyone using that laptop be anyone, so don't leave it
     running or walk away from it.
5. **One uploaded file** (photos, song files): backups store uploaded files separately in the Drive
   folder (`<folder>__<name>.enc`). Download one from Drive and unlock it:
   ```sh
   npm run restore -- ~/Downloads/people__p12-ab.jpg.enc ~/restore-drill/photo.jpg
   ```
   It should open as the original photo.
6. **Clean up.** Delete the drill folder and the downloaded files, then empty the bin:
   `rm -rf ~/restore-drill ~/Downloads/<backup>.db.gz.enc ~/Downloads/people__*.enc`
7. **Record it** in the table below, in a pull request or by asking the developer.

## If it fails
- Don't change anything on production. A failed drill means the *backup* needs fixing, not the data.
- Try the Google Drive copy of the same night, and an older copy.
- Tell the developer the exact message the check printed. They don't need the password or the file.
- Until a drill passes, don't merge releases that change the database.

## A real restore on production
That is a different, rare job and needs the owner's explicit approval:
1. stop the service
2. download the **current** database from the disk first, so nothing is lost
3. put the checked copy where `MB_DB` points
4. start the service again

The developer writes the step-by-step for that day. This drill is what makes it safe.

## Drill record

| Date | Code | Backup | Check | People / assignments / check-ins | Start-up log and audit | Looked around | Who | Notes |
|---|---|---|---|---|---|---|---|---|
| 2026-11-25 | `milestone-1` at `7c4aab4` | Made by hand 10:23 PM; on the server and in Google Drive | Passed: integrity ok, schema 29 | 303 / 2 / 0 | Offline start clean (no warnings or errors); duplicate-account audit: none; 1 active account not linked to a person | Yes: upgraded to 35; people, services, teams and chats all present | Owner, guided by the developer | First drill, before the staff beta and the first deploy. Drive copies began after the Google Drive API was enabled |
| 2026-11-26 | `claude/b8-attendance-access` at `7a13a97` (PR #87, migration 36) | Made by hand 3:54 PM; on the server and in Google Drive | Passed: integrity ok, schema 35 (code 36) | 303 / 2 / 0 | Offline start clean (OFFLINE MODE, no warnings or errors); upgraded to 36 at start | Yes: tidied families present; roll call marks people present; the new Attendance switch shows in Change access | Owner, guided by the developer | Before deploying B8. Also checked an earlier 2:35 PM copy (passed). 295 households for 303 people: moving people leaves empty families behind (cleanup noted) |
