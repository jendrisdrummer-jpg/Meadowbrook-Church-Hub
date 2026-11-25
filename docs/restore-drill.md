# Backup restore drill

A backup only counts if it can be restored. This drill proves it on a laptop, using a real backup,
**without touching production**. It takes about 30 minutes.

**When:**
- before the staff beta goes live
- before each release that adds database changes (migrations)
- then every three months

**Who:** an admin, with the developer on hand the first time.

## Before you start
- Use a laptop with an encrypted disk (FileVault on a Mac, BitLocker on Windows). The unlocked copy
  holds everyone's details, including children's allergies and medical notes.
- Have the code at the **same version as production**: a fresh clone of the repository on `main`.
  If the code is newer, the hub adds its newer database changes to the *copy* when it starts. That
  is harmless, but the check reports it.
- You need the backup password. It is `MB_BACKUP_PASSWORD` in Render → the service → Environment.
  Type it into your terminal only. Never put it in chat, email, a document or a commit.

## Steps
1. **Get a backup.**
   - In the hub, go to Settings → Backups.
   - Press **Back up now**, or use last night's copy.
   - Press **Download** on it. The file ends in `.db.gz.enc` and stays locked until step 2.
2. **Unlock and check it**, in the repository folder:
   ```sh
   MB_BACKUP_PASSWORD='…' npm run restore -- ~/Downloads/<backup>.db.gz.enc drill.db --check
   ```
   - Expect `Integrity: ok`, the schema version, a table of counts, and **Restore check passed**.
   - It never overwrites a file. If `drill.db` exists, choose another name.
3. **Compare the counts** with what you know. For example:
   - people: roughly your People count in the hub
   - services and assignments: recent Sundays are there
   - check-ins: last Sunday's are there

   A table that is empty but shouldn't be is a failure.
4. **Look around** (optional, recommended the first time). Start the hub against the copy in
   **offline mode**:
   ```sh
   MB_OFFLINE=1 MB_DEV_LOGIN=1 MB_DB=drill.db PORT=8197 node --disable-warning=ExperimentalWarning server/index.js
   ```
   - The terminal must say **OFFLINE MODE**. If it doesn't, stop (Ctrl+C) and check the command.
   - Offline mode refuses every outgoing call (push to phones, Google Drive, payments, video, media)
     and starts no background jobs (reminders, announcements, backups).
   - Email can't go out because the SMTP settings live only on Render.
   - Don't use `npm start` or a `.env` file here: those could carry real email settings.
   - Open http://localhost:8197 and sign in with test sign-in as yourself.
   - Spot-check: a person you edited recently, next Sunday's schedule, last Sunday's check-in
     history, a team chat.
   - Stop it with Ctrl+C. Test sign-in lets anyone at that laptop be anyone, so don't leave it running.
5. **One uploaded file** (photos, song files): backups store uploaded files separately in the Drive
   folder (`<folder>__<name>.enc`). Download one from Drive and unlock it:
   ```sh
   MB_BACKUP_PASSWORD='…' npm run restore -- ~/Downloads/people__p12-ab.jpg.enc
   ```
   It should open as the original photo.
6. **Clean up.** Delete `drill.db`, its `-wal` and `-shm` files, the unlocked photo and the downloaded
   backup, then empty the bin.
7. **Record it** in the table below, in a pull request or by asking the developer.

## If it fails
- Don't change anything on production. A failed drill means the *backup* needs fixing, not the data.
- Try the Google Drive copy of the same night, and an older copy.
- Tell the developer with the exact message the check printed. They don't need the password or the
  file.
- Until a drill passes, don't merge releases that change the database.

## A real restore on production
That is a different, rare job and needs the owner's explicit approval:
1. stop the service
2. download the **current** database from the disk first, so nothing is lost
3. put the checked copy where `MB_DB` points
4. start the service again

The developer writes the step-by-step for that day. This drill is what makes it safe.

## Drill record

| Date | Backup | Check | People / assignments / check-ins | Looked around | Who | Notes |
|---|---|---|---|---|---|---|
| | | | | | | First drill: before the staff beta |
