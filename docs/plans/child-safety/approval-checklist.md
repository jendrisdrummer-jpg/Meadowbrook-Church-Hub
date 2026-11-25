# Child-safety plan: approval checklist (revision 3.1)

Chief Architect · 2026-11-25. "Where" refers to sections of `plan.md`; "Policy §" refers to
`operational-policy.md`.

**Totals:** 128 items.
- **Group I, church policy:** 53 items. 10 already decided by the owner on 2026-11-25; 43 need a decision now.
- **Group II, technical approvals:** 47 items. 8 already decided; 39 need a decision now.
- **Group III, deployment approvals:** 28 items. Each is approved at the time of that step, not now.
- In all, 110 items still need an owner decision or approval: 82 now and 28 later.
- Of the 82 needed now, the **owner decision sheet** below lists the **24 that need your judgement**. The other 58 are
  routine or technical, and one line accepts all of them.

---

## Owner decision sheet

### Already decided by you (2026-11-25), shown for reference
- I-01 Code design: server-leased prefixes, 5 or 6 characters, confirmed online, paper kit when offline without a
  lease
- I-02 A code is never enough on its own; anything ambiguous goes to the careful lane
- I-08 Tag holders allowed, with safeguards
- I-09 Collector minimum age 16
- I-11 Household told after a tag-holder pickup
- I-12 Daily coordinator review of tag-holder pickups
- I-16 Approvals by phone, online PIN or offline day code; nobody signs in on kiosks
- I-23 ID name and type recorded, never the number
- I-26 Three medical levels
- II-05 Build a legal hold before any clean-up
- II-17 Personal PIN online-only
- II-18 Offline-code cryptographic design
- II-24 Quick wins
- II-25 Dedicated check-in host
- II-28 Private care notes never on iPads; medical views logged
- II-31 Code changes from Q1
- II-40 Each purge job separately approved

### A. Families and pickups: policy trade-offs (10)
| ID | Decision | Recommended default |
|---|---|---|
| I-10 | "List only" families: what happens to someone not on the list | **Coordinator, after speaking to a parent by phone; otherwise the child stays.** Families may choose "strict" (never released). |
| I-13 | Babies and non-speaking children collected by a tag holder | **No extra coordinator step**; the room leader confirms the child knows the adult |
| I-14 | Lost tag | **An adult helper may release to a known household adult with photo or ID**; anyone else needs a coordinator |
| I-19 | How old the iPad's offline safety list may be | **180 minutes, and the same day** |
| I-20 | When to check ID | **Anyone not recognised**, and always in the careful lane |
| I-24 | Parent tag and child label content | **Code, date, check-in time, initials and count; "EPI: YES"; no family name; tag always printed** |
| I-27 | How the iPad knows the operator is an adult | **Pick from today's kids-team schedule, with age from the birthdate. Tag-holder releases need confirmation from the volunteer's own phone** (Security's recommendation) |
| I-36 | Trial period | **Two trial Sundays, with the paper kit plus a spare new iPad as fallback; no old-app iPad** |
| I-52 | Full care notes need a connection (fetched on tap); offline, only the safety line shows | **Accept.** The safety line (allergy, EpiPen, action, where the medicine is) is always on the iPad and on the label. |
| I-53 | Offline tag-holder and lost-tag pickups need a coordinator at the desk with their offline code | **Accept** |

### B. People, money and outside parties (6)
| ID | Decision | Recommended default |
|---|---|---|
| I-06 | Who are the first coordinators and helpers at each campus | You name them; an admin grants them before explicit mode |
| I-18 | Duty rota: two approving coordinators and a runner per service | **Yes**, entered in the hub |
| I-31 | Check-in hours per campus | You supply the hours; "Open check-in now" available for extra events |
| I-45 | Label stock roughly doubles | **Accept** |
| I-46 | iPad device policy, and whether to pay for MDM | **Guided Access (free) at minimum**; MDM only if you approve the cost |
| I-51 | Who is the second person for releasing a hold, approving a permitted deletion, and the relaxation switch | **A second admin, or you (the owner).** For the relaxation switch, a coordinator may be the second person. |

### C. Risks you accept (5)
| ID | Decision | Recommended default |
|---|---|---|
| II-02 | Staff can no longer delete or retime past services, positions or assignments; they cancel, archive or mark them removed | **Accept** |
| II-19 | Offline-code residual risk: Low with the device policy and check-in host, Medium without the host | **Accept Low** |
| II-32 | Old-app iPads can't check children out once pickup sessions are on | **Accept** |
| II-36 | Recorded residual risks: copied iPads are detected rather than prevented; the operator pick is self-attested; roster not encrypted on the iPad | **Accept** |
| II-41 | Today's code-only check-out continues until pickup sessions start (P4, about 10–13 weeks), with only the "two families" guard added | **Accept** |
| I-17 | Offline day-code length raised from 8 to 10 digits after your decision (8 digits can be cracked in under 2 hours on one GPU if an iPad's storage is copied) | **Confirm 10 digits** (12 is safer but slower to type at the desk) |

### D. Needs the insurer or attorney before it takes effect (3)
| ID | Decision | Recommended default |
|---|---|---|
| I-34 | How pickup alerts are requested and recorded (court orders, parent requests) | Draft procedure; **attorney to confirm** |
| I-38 | Retention policy | Draft (plan §4.10); **insurer and attorney must review before any clean-up is switched on** |
| I-49 | Privacy notice for families | Draft; **attorney to confirm** |

### Everything else
☐ **I accept the recommended default for every other item in groups I and II that is not listed above (58 routine or
technical items).** Group III deployment approvals will come to me one at a time.

Signed: ____________________ Date: __________

---

## I. Church policy decisions (53)

| ID | Item | Owner approval required (co-signers) | Recommended default | Where | Status |
|---|---|---|---|---|---|
| I-01 | Code design: server-leased prefixes only (letter → 5 characters, digit-led → 6); online codes confirmed before print; one issuing window per iPad; clone detection; no server-invented codes; no lease + offline → paper kit | Yes (Security) | As stated | §3.2 | **Decided (owner, 2026-11-25)** |
| I-02 | Codes are never the only authorisation; an ambiguous match always goes to the careful lane | Yes (Security) | As stated | §3.3 | **Decided (owner, 2026-11-25)** |
| I-03 | Wording of the promise about codes (revised per L1) | Yes | "…the server notices as soon as the iPads are online. At any time, a code only finds a family…" | §3.2, Policy §1 | Pending (routine) |
| I-04 | Signed-in (unpaired) check-in devices | Yes (Security) | Retire on kiosks; pair every desk iPad. Any hub-host laptops are online-only, with no cache, no verifiers and no restriction data | §3.2, §3.9, §10 L14 | Pending (routine) |
| I-05 | Check-in permission model: helper and coordinator levels, then explicit mode | Yes (Security) | Yes | §3.6 | Pending (routine) |
| I-06 | The first coordinators and helpers per campus | Yes | Named list; granted before explicit mode | §3.6, P5 | Pending (**sheet B**) |
| I-07 | Two pickup lanes chosen by data | Yes | Yes | §3.3 | Pending (routine) |
| I-08 | Tag holder not on the list, allowed with safeguards | Yes (Security) | As stated | §3.5, Policy §4 | **Decided (owner, 2026-11-25)** |
| I-09 | Collector minimum age | Yes | 16, set by the church | §3.5 | **Decided (owner, 2026-11-25)** |
| I-10 | "List only" behaviour for someone not on the list | Yes (insurer and attorney for strict mode) | Coordinator plus a parent phone call, otherwise not released; strict mode is the family's choice | §3.5, Policy §6 | Pending (**sheet A**) |
| I-11 | Household told after a tag-holder pickup (anyone named in a restriction excluded) | Yes | As stated | §3.5 | **Decided (owner, 2026-11-25)** |
| I-12 | Daily coordinator review of tag-holder pickups | Yes | End of day; admins reminded next morning | §3.5 | **Decided (owner, 2026-11-25)** |
| I-13 | Babies and non-speaking children with a tag holder | Yes | Room leader confirms the child knows the adult | §3.5 | Pending (**sheet A**) |
| I-14 | Lost tag tiers (offline: day code, I-53) | Yes | Known household adult with photo or ID → adult helper; anyone else → coordinator; code revoked | §3.3, Policy §5 | Pending (**sheet A**) |
| I-15 | Do-not-release is a hard block | Yes | No override by anyone; the relaxation switch never lifts it | §3.3, §4.8 | Pending (routine) |
| I-16 | Approval routes: phone, online PIN, offline day code; no sign-in on kiosks | Yes (Security) | As stated; alert children by phone only (II-47) | §3.7 | **Decided (owner, 2026-11-25)** |
| I-17 | Offline day-code length | Yes (Security) | 10 digits | §3.7.2 | Pending: the owner approved the approach when it said 8 digits; Security raised it to 10 (8 digits fall in under 2 hours on one GPU). Owner to confirm. |
| I-18 | Duty rota per service (two approvers and a runner), in the hub | Yes | Yes | §3.7.2, §6 | Pending (**sheet B**) |
| I-19 | Offline safety-list age limit | Yes | 180 minutes and the same day | §3.8 | Pending (**sheet A**) |
| I-20 | ID check policy | Yes | `unrecognised`; careful lane always checks ID | §3.5 | Pending (**sheet A**) |
| I-21 | "Not yet known" window for newly added household adults | Yes | 14 days, set by staff only | §3.5 | Pending (routine) |
| I-22 | How long "ID seen" is remembered | Yes | 12 months | §3.5 | Pending (routine) |
| I-23 | ID record: name and type, never the number | Yes | As stated | §3.5 | **Decided (owner, 2026-11-25)** |
| I-24 | Parent tag and child label content | Yes | Code, date, check-in time, initials and count; "EPI: YES"; no family name; always printed | §3.14 | Pending (**sheet A**) |
| I-25 | Phone numbers on iPads | Yes | Last 4 digits for search, plus the household's main phone | §3.13 | Pending (routine) |
| I-26 | Three medical levels | Yes (Security) | As stated | §3.12, Policy §9 | **Decided (owner, 2026-11-25)** |
| I-27 | Operator adult or teen; `attested` or `phone` mode | Yes (Security) | `attested`, but **phone confirmation required for tag-holder releases**; birthdates filled in before P4 | §3.10 | Pending (**sheet A**) |
| I-28 | Per-child "print full note on label", re-confirmed each term | Yes | Yes | §3.12 | Pending (routine) |
| I-29 | Existing notes (and `allergies`) sorted into levels by hand | Yes | Yes, using a review list | §3.12 | Pending (routine) |
| I-30 | Medical access log review | Yes | Monthly, by the safeguarding lead | §3.12 | Pending (routine) |
| I-31 | Check-in hours per campus | Yes | You supply the hours; "Open now" available | §3.9, §3.11 | Pending (**sheet B**) |
| I-32 | Which families each iPad holds | Yes | This campus, plus 12 months anywhere, plus online all-campus search | §3.13 | Pending (routine) |
| I-33 | Ending a pickup alert | Yes | A **different** coordinator or admin confirms; never the requester or the child's household | §3.4 | Pending (routine) |
| I-34 | Intake of pickup alerts | Yes (attorney) | Custodial parent or court order; paper locked; two trained staff; weekly expiry review; incident note | §3.4, Policy §7 | Pending (**sheet D**) |
| I-35 | Hard-block script | Yes | Don't argue; keep the child; Alert button; 911 if threatened; pastor told | Policy §7 | Pending (routine) |
| I-36 | Deploy windows and soak | Yes | Weekday mornings; two Sundays with the paper kit plus a spare new iPad; you list the midweek programmes | §4.7, §5.4 | Pending (**sheet A**) |
| I-37 | Christmas freeze | Yes | No deploys in Advent or Christmas week | §7 | Pending (routine) |
| I-38 | Retention policy | Yes (**insurer and attorney**) | The draft in §4.10 | §4.10, Policy §14 | Pending (**sheet D**) |
| I-39 | Legal-hold procedure ("set the hold first"; who can set it) | Yes (attorney) | Any admin or the safeguarding lead sets it; release needs two people (I-51) | §4.9 | Pending (routine) |
| I-40 | Undo release | Yes | A coordinator, within 30 minutes, with a reason | §3.3 | Pending (routine) |
| I-41 | Optional P9 (offline quick-add for first-time families) | Yes | Include, after P4 and before Easter | §7 | Pending (routine) |
| I-42 | What is deferred to the roadmap | Yes | As listed | §1, §3.13 | Pending (routine) |
| I-43 | Training, desk card, signage, family communication | Yes | As in §6 | §6, Policy | Pending (routine) |
| I-44 | Paper kit and daily alerts sheet; **paper pickup follows R1** (who's collecting first, names first, keep the tag half, tag-holder rules, teen limits) | Yes | As in Policy §12 | §3.2, Policy §12 | Pending (routine) |
| I-45 | Label stock costs | Yes | Accept about double | §6 | Pending (**sheet B**) |
| I-46 | Device policy and MDM cost | Yes (Security; cost approval if MDM is paid) | Guided Access at minimum | §3.7.9, Policy §11 | Pending (**sheet B**) |
| I-47 | Lost or stolen iPad procedure (uploads afterwards quarantined) | Yes (Security) | As in Policy §11 | §3.7.7, §3.9.4 | Pending (routine) |
| I-48 | Procedure when a coordinator's account is compromised | Yes (Security) | Disable → codes rotate → remove level → review 30 days | §3.7.7 | Pending (routine) |
| I-49 | Privacy notice for families | Yes (attorney) | First-visit form and privacy page | §4.10 | Pending (**sheet D**) |
| I-50 | Past serving records are corrected by marking them removed or cancelled, never deleted or retimed | Yes | Yes | §4.2 | Pending (routine) |
| I-51 | **New.** Second person for hold release, permitted deletions and the relaxation switch | Yes | A second admin or the owner; a coordinator may be the second person for the switch | §4.2, §4.8, §4.9 | Pending (**sheet B**) |
| I-52 | **New (M9).** Full care notes fetched on tap, online only; offline shows Level 1 only | Yes (Security) | Accept | §3.12, §3.8 | Pending (**sheet A**) |
| I-53 | **New (M7).** Offline tag-holder and lost-tag releases need a coordinator's day code | Yes (Security) | Accept | §3.5, §3.7.5, §3.8 | Pending (**sheet A**) |

---

## II. Technical approvals required by project rules (47)

| ID | Item | Owner approval required (co-signers) | Recommended default | Where | Status |
|---|---|---|---|---|---|
| II-01 | Migration m30: holds (two-person release fields), permits (two-person), `history_deletions` tombstone, delete **and update** guard triggers, soft columns | Yes (rule 1) | Approve | §4.2, §4.3 | Pending (routine) |
| II-02 | Route behaviour changes: no delete or retime of past services with history; position → archive; past assignment → removed (volunteers can't change past status); series edits clamped; merge keeps duplicate past assignments | Yes (rule 7) | Approve | §4.2 | Pending (**sheet C**) |
| II-03 | Guard method: triggers, not a table rebuild | Yes | Triggers | §4.2 | Pending (routine) |
| II-04 | Permitted deletes: two admins, 10-minute expiry, hold check inside the trigger, tombstone copy, no UI button | Yes (Security) | Approve | §4.2 | Pending (routine) |
| II-05 | Legal hold, pausing Drive backup deletion: two-person release, 7-day cooling-off, local pruning continues only for files safe in Drive, Drive disconnect refused during a hold | Yes (rule 7) | Approve the revision-3 details | §4.9 | **Decided (owner, 2026-11-25)** (build it); M2/M10 details by recommendation |
| II-06 | Migration m31: audit events (append-only, no FKs to users, people or devices), release and operator columns, revoke | Yes (rule 1) | Approve | §4.3 | Pending (routine) |
| II-07 | Migration m32: check-in host device columns | Yes (rule 1) | Approve | §4.3 | Pending (routine) |
| II-08 | Migration m33: leases, pickups, "list only", verification | Yes (rule 1) | Approve | §4.3 | Pending (routine) |
| II-09 | Migration m34: levels, PIN (with expiry), duty rota, offline codes (`secret_kid`), verifiers, quarantine, `migrating_at` | Yes (rule 1) | Approve | §4.3 | Pending (routine) |
| II-10 | Migration m35: restrictions, contacts, `pickup_contact_notes`, overrides, extra delete guards | Yes (rule 1) | Approve | §4.3 | Pending (routine) |
| II-11 | Migration m36: Level 1 fields, `person_care_notes`, label confirmation, `sensitive_access_log` | Yes (rule 1) | Approve | §4.3 | Pending (routine) |
| II-12 | Backup before every deploy; rehearsal on a restored copy | Yes | Approve | §5.4 | Pending (routine) |
| II-13 | Person merge also moves the new references | Yes | Approve | §4.3 | Pending (routine) |
| II-14 | New check-in levels; only admins grant coordinator | Yes (rule 7; Security) | Approve | §3.6 | Pending (routine) |
| II-15 | Switch to explicit mode | Yes (rule 7) | Approve; flip on a Monday | §3.6, §4.8 | Pending (routine) |
| II-16 | Station `[method, path]` allow-list, today only | Yes (Security) | Approve | §3.9.2 | Pending (routine) |
| II-17 | Personal PIN online-only, generated by the server, checked by the server, async scrypt | Yes (rule 7; Security) | Approve | §3.7.1 | **Decided (owner, 2026-11-25)** (online-only) |
| II-18 | Offline day-code cryptographic design | Yes (Security) | As specified | §3.7.2–3.7.6 | **Decided (owner, 2026-11-25)** |
| II-19 | Accept the residual risk of offline codes | Yes (Security) | Accept Low; Medium only by a separate acceptance | §3.7.9 | Pending (**sheet C**) |
| II-20 | Environment secrets `MB_CHECKIN_CODE_SECRET` and `MB_CHECKIN_SYNC_KEY` set by the owner in Render | Yes | Approve | §3.7.2 | Pending (routine) |
| II-21 | `__Host-` station cookie, rotation with 2-minute grace, revoke with a reason | Yes (Security) | Approve | §3.9.2 | Pending (routine) |
| II-22 | Check-in hours enforced | Yes (Security) | Approve; allowed networks off | §3.9 | Pending (routine) |
| II-23 | Enforcement never behind a flag. The **relaxation switch** never lifts do-not-release, needs two people and lasts at most 4 hours (M1) | Yes (Security) | Approve | §4.8 | Pending (routine) |
| II-24 | Quick wins: station token wins; no kiosk sign-in; kiosk sessions ended server-side when both credentials arrive (M12); CSP; `frame-ancestors`; XFO DENY; HSTS; SRI; no-store | Yes (Security) | As stated | §3.9.1 | **Decided (owner, 2026-11-25)** (M12 addition by recommendation) |
| II-25 | Dedicated check-in host on the same Render service | Yes (Security) | As stated; DNS from the owner (III-04) | §3.9.2–3.9.3 | **Decided (owner, 2026-11-25)** |
| II-26 | Rate-limiter factory | Yes | Approve | §3.11 | Pending (routine) |
| II-27 | Station photo endpoint, limited to today's open pickups | Yes (Security) | Approve | §3.5 | Pending (routine) |
| II-28 | Level 3 never on iPads; medical views logged | Yes (Security) | As stated (implementation detail in II-45) | §3.12 | **Decided (owner, 2026-11-25)** |
| II-29 | Custody restrictions as a new sensitive category | Yes (Security) | Approve | §3.4 | Pending (routine) |
| II-30 | Alert notification kind that can't be muted | Yes | Approve | §3.11 | Pending (routine) |
| II-31 | Q1 code changes | Yes (Security) | As stated | §3.2, §3.3 | **Decided (owner, 2026-11-25)** |
| II-32 | Old-app code-only check-outs refused once pickup sessions are on; no old-app iPad during the soak | Yes (Security) | Approve | §4.6, §4.7 | Pending (**sheet C**) |
| II-33 | Push to household adults after a tag-holder pickup | Yes (Security) | Approve | §3.5 | Pending (routine) |
| II-34 | Birthdate used to tell adults from teens; roster carries only `is_adult` | Yes (Security) | Approve | §3.10 | Pending (routine) |
| II-35 | Device data minimisation and purges; roster encryption deferred | Yes (Security) | Approve | §3.13 | Pending (routine) |
| II-36 | Accepted residual risks in tech-debt: clone clashes detected rather than prevented; attested operator; FK cascade neutralised by trigger; unencrypted roster | Yes (Security) | Accept | §4.4, §3.10 | Pending (**sheet C**) |
| II-37 | Outbox v2, check-in service worker, compatibility contract | Yes | Approve | §4.5, §4.6 | Pending (routine) |
| II-38 | Order in which flags are turned on | Yes | Approve | §4.8, §7 | Pending (routine) |
| II-39 | Dependencies and costs: none (MDM is a separate decision) | Yes (rule 6) | Confirm none | §8 | Pending (routine) |
| II-40 | Each purge job separately approved after insurer and attorney sign-off; Security sign-off per phase | Yes (Security; insurer and attorney) | As stated | §4.10, §7 | **Decided (owner, 2026-11-25)** |
| II-41 | **New (L4).** Accept today's code-only check-out until pickup sessions are enabled (P4); the Phase 2 ambiguity guard is the only change before then; expected about 10–13 weeks | Yes (Security) | Accept | §2 (R1), §4.6 | Pending (**sheet C**) |
| II-42 | **New (M4).** Key ids and `_PREV` keys (14 days) for both secrets; `kid` in the envelope and HKDF info; rotation and leak runbook; README entries | Yes (Security) | Approve | §3.7.2, §3.7.4 | Pending (routine) |
| II-43 | **New (M8).** Server-enforced drain-only tokens after Move and after day 60; sensitive data only to check-in-host tokens; Replace gated on server-side pending = 0, with a fresh prefix if the old one was used; `x-station` never on the check-in host | Yes (Security) | Approve | §3.9.2, §3.9.3 | Pending (routine) |
| II-44 | **New (M3).** Trigger-list invariant test and the rebuild rule; no FKs from append-only tables; delete guards on restrictions, contacts, pickups and overrides | Yes (Security) | Approve | §4.2, §4.3 | Pending (routine) |
| II-45 | **New (H2).** Level 3 and contact notes in separate tables; column allow-lists replace `SELECT *` on people and pickups (including `finance.js`); router-wide canary sweep | Yes (Security) | Approve | §3.5, §3.12, §4.3 | Pending (routine) |
| II-46 | **New (M5, M6).** Release reports bound to their approval (one each; uploader must match); single revoked-token rule (lost or stolen → quarantined; replaced → applied, no time limit) | Yes (Security) | Approve | §3.7.4, §3.9.4 | Pending (routine) |
| II-47 | **New (H3).** PIN may approve only children with no pickup alert (alert children: phone only); real-time notice on every use; 90-day rotation and rotation after "Not you?"; no digit echo | Yes (rule 7; Security) | Approve | §3.7.1 | Pending (routine) |

---

## III. Deployment approvals (28): each one is an owner act at the time

| ID | Item | Owner approval required (co-signers) | Recommended default | Where | Status |
|---|---|---|---|---|---|
| III-01 | Merge and deploy P1 (history protection, legal hold); backup first | Yes (Security review done) | Weekday morning | P1 | Pending |
| III-02 | Merge and deploy P2 | Yes (Security) | Weekday morning | P2 | Pending |
| III-03 | **Sign out every check-in iPad** (end the hub sessions seen on station devices) and tell the users; kiosk sign-in links removed | Yes | With P2 | §3.9.1 | Pending |
| III-04 | DNS for `checkin.<domain>` and the Render custom domain (you provide them) | Yes (owner action) | Before P3 | §3.9.2, A4, A5 | Pending |
| III-05 | Merge and deploy P3 (dark) | Yes (Security) | Weekday | P3 | Pending |
| III-06 | Pilot migration of one iPad, then go or no-go | Yes | Mid-week | §3.9.3 | Pending |
| III-07 | Migrate all iPads, campus by campus | Yes | Outside check-in hours | §3.9.3 | Pending |
| III-08 | End date for the old host (60 days); drain-only after that | Yes | 60 days | §3.9.3 | Pending |
| III-09 | Merge and deploy P4 (dark) | Yes (Security) | Weekday | P4 | Pending |
| III-10 | Family communication two weeks before pickup sessions start | Yes | 2 weeks ahead | §6 | Pending |
| III-11 | Turn on `checkin_pickups` per campus | Yes | One campus at a time | §4.7 | Pending |
| III-12 | Go or no-go after the two-Sunday soak | Yes (church operations) | Targets in §5.4 | §5.4 | Pending |
| III-13 | Merge and deploy P5 (dark) | Yes (Security) | Weekday | P5 | Pending |
| III-14 | Grant helper and coordinator levels | Yes | Before III-15 | §3.6 | Pending |
| III-15 | Switch to explicit mode | Yes | On a Monday | §4.8 | Pending |
| III-16 | Set the secrets (with kids) in Render; set up the duty rota | Yes | Before III-17 | §3.7.2 | Pending |
| III-17 | Turn on offline codes per campus (after the timing check) | Yes (Security) | One campus first | §3.7 | Pending |
| III-18 | Merge and deploy P6 (dark) | Yes (Security) | Weekday | P6 | Pending |
| III-19 | Turn on pickup alerts (server-checked preconditions) | Yes (Security) | Weekday | §3.4 | Pending |
| III-20 | Enter the first pickup alerts | Yes | Two trained staff | §3.4 | Pending |
| III-21 | Go or no-go after the soak Sunday following P6 | Yes | — | §5.4 | Pending |
| III-22 | Merge and deploy P7; coordinators sort existing notes | Yes (Security) | Weekday | P7 | Pending |
| III-23 | Turn on adult-only care-note display (birthdates filled in) | Yes | After A8 | §3.10, §3.12 | Pending |
| III-24 | Merge and deploy P8; release checklist signed | Yes (Chief Architect) | — | P8 | Pending |
| III-25 | Retention policy signed by the insurer and attorney | Yes (insurer and attorney) | — | §4.10 | Pending |
| III-26 | Turn on each purge job (one at a time; dry-run counts first) | Yes (Security; after III-25) | One job at a time | §4.10 | Pending |
| III-27 | Any use of the relaxation switch: two different people, at most 4 hours, never lifts do-not-release | Yes (two people per I-51; owner told) | Never, unless an emergency | §4.8 | Pending (standing rule) |
| III-28 | Merge and deploy optional P9 | Yes (Security) | After P4 | P9 | Pending |

---

**Totals**
| Group | Items | Decided | Pending now | Pending later |
|---|---|---|---|---|
| I | 53 | 10 | 43 | — |
| II | 47 | 8 | 39 | — |
| III | 28 | 0 | — | 28 |
| **Total** | **128** | **18** | **82** | **28** |

Of the 82 needed now, 24 are on the owner decision sheet (sections A–D) and 58 are routine, covered by the
"accept all other defaults" line.
