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
- **The code** at the **same version as production**: a fresh clone of the repository on `main`.
  If the code is newer, the hub adds its newer database changes to the *copy* when it starts. That
  is harmless, but the check reports it.
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
     check the command.
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

| Date | Backup | Check | People / assignments / check-ins | Looked around | Who | Notes |
|---|---|---|---|---|---|---|
| | | | | | | First drill: before the staff beta |
