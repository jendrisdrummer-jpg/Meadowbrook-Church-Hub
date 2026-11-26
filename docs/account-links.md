# Account links: one account per person

An account (`users`) is linked to a person in People through `users.person_id`. Rules, by owner decision:

- An **admin** links an account to a person, by hand, in Settings → Sign-in & accounts. Nothing is linked
  by matching email, name or any other guess. (The one account born linked is someone brand new to the
  church: the app adds them to People as a new person; see [permissions.md](permissions.md).)
- **One person, one account.** Linking a person who already has an account is refused (409) on every
  path, and the database enforces it as well when it can.
- **Suggestions only:** next to each unlinked account, Settings shows the person with the same email (see
  "Suggestions" below). An admin still decides: the suggestion is a one-click shortcut to the same admin link.
- Every link and unlink is in the audit log (`user.link`, `user.unlink`, with the admin who did it).
- Existing links are never changed automatically. Nobody is unlinked or deleted for you.

## Suggestions (`server/link-suggestion.js`)

`GET /users` adds a `suggestion` to each row of `unlinked` so an admin does not have to search. It is a hint
only: **nothing is linked at sign-in or anywhere else**, and sign-in code is unchanged.

- A suggestion exists only when **exactly one non-archived person** has the account's email (trimmed, case
  ignored). Two people sharing an email, an archived person, or no match: no suggestion. Phone numbers and
  names are never used.
- It is shown only when that person is **in the admin's reach** (a campus-limited admin does not see people at
  other campuses; people with no campus count as in reach, as everywhere else).
- A note says when the match deserves a second look: "listed as a child", "a child or under 18" (the same adult
  rule as small groups, `isAdult` in `server/eligibility.js`), or "already has an account" (no one-click button
  is offered, since linking would be refused with 409).
- Settings → Accounts → "Accounts not linked to a person" shows "Same email as Jo Smith (North)" with a
  **Link to Jo Smith** button. It asks the admin to confirm, then uses the usual `PATCH /users/:id`
  (`person_id`), so every existing rule applies: reach, one account per person, the team-leader rule, and the
  `user.link` audit row.

## Check the data: `scripts/audit-account-links.js`

Read-only: it opens the database with `readOnly: true` and changes nothing. It follows `MB_DB` like the
server (default `data/meadowbrook.db`). In the Render Shell:

```
node --disable-warning=ExperimentalWarning scripts/audit-account-links.js
```

It prints:

1. People linked to more than one account: person id, and for each account its id, role, active or
   disabled, last sign-in and created date.
2. Accounts linked to an archived or missing person.
3. A summary line (also the count of active accounts not linked to anyone, and whether the database rule
   is on).

By default it prints **no emails or names**, so the output can be shared. Add `--show` to see them
(`... audit-account-links.js --show`); keep that output private.

## If there are duplicates (one person, two or more accounts)

The hub never decides this for you and never deletes anything. For each person listed:

1. Run the audit with `--show`, or open Settings → Sign-in & accounts, where a warning lists every person
   with more than one account.
2. Decide which account should stay linked (usually the one they actually sign in with: look at last
   sign-in, and ask them if unsure; an admin or staff account usually wins over a volunteer one).
3. For each **other** account: in Settings → Sign-in & accounts press **Find** next to it, open it, choose
   **Unlink**, and **Save**. The account keeps its sign-in and access but is unlinked, so it shows "We've let
   the church office know" until you link it to the right person (or disable it: untick "Can sign in").
   **Don't delete accounts to fix this.** Deleting removes sessions and devices and can't be undone.
4. Run the audit again. When it reports no duplicates, the one-account rule turns on at once (see below).

Merging two people in People is refused while both have an account (409); unlink one first.

## What the startup step does

When the server starts (after the migrations), `ensureAccountLinkIndex` in `server/db.js` counts people with
more than one account:

- **None:** it runs `CREATE UNIQUE INDEX IF NOT EXISTS users_person_unique ON users (person_id) WHERE person_id IS NOT NULL`.
  From then on the database itself refuses a second account for a person. Many unlinked accounts are fine.
- **Any:** it skips the index, logs one clear warning (counts and person ids, no emails) and carries on. The
  admin API (`GET /users` → `duplicate_links`) lists those people and Settings → Accounts shows the warning
  and guidance above. **No data is changed.** The code-level 409 check still applies to every new link.

It is not a migration on purpose: a migration that fails on duplicates would stop the deploy. The step also
runs again when an admin unlinks or deletes an account, so resolving the last duplicate turns the rule on
without a restart. It is safe to run repeatedly.

## Notes
- Unlink in Settings → Accounts with **Unlink**, then **Save**. Leader access that came only from
  leading a team (not set by hand) is taken back, and kids' check-in access goes with it.
- Linking applies the usual team-leader rule: someone who leads a team gets leader access, unless
  you change their access to something else in the same save. That leader access ends if they stop
  leading or are unlinked; to keep it regardless, choose another level, save, then choose Leader again.
- A campus-limited admin can link accounts only to people at their own campuses, or with no campus, and only accounts in their reach; they can't link or unlink their own account. See [permissions.md](permissions.md#campus-limited-admins).
- Merging two people moves the duplicate's account to the kept person (an admin's explicit choice,
  audited as `user.link` with `via: merge`); if both have an account, unlink one first.
