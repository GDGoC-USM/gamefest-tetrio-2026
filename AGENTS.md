# AI contributor instructions

These instructions apply to the entire repository. Read this file before running commands or making changes. Read any more-specific `AGENTS.md` in the directories you will change as well. Follow the instructions supported by your AI tool; this file is guidance, not an access-control mechanism.

## Before acting

1. Read `README.md` for structure, setup, verification and collaboration. `README_FIRST.txt` adds event context, but its project-creation, combined-deploy and some result/recovery instructions are historical; follow the current source and qualifications below when they conflict.
2. Understand the user's requested outcome and inspect the affected files before proposing or making edits. Do not assume this is a framework application.
3. Check the current branch and working-tree state. Preserve existing user and teammate changes. Do not reset, discard, stash, overwrite, or stage unrelated work.
4. Use a task branch before editing. Never commit or push directly to `main`.
   - For a new task with a clean working tree on `main`, update it with `git pull --ff-only origin main`, then create a descriptive branch such as `docs/setup-guide`, `fix/prediction-save`, or `feature/room-summary`.
   - If already on the task's branch, keep using it. Do not switch away from an active teammate's work or move dirty changes between branches without agreement.
   - If the correct branch or ownership is unclear, resolve that before editing.

## Repository conventions

- This is a static, multi-page application: HTML in `public/`, CSS in `public/css/`, and browser ES modules in `public/js/`.
- Firebase setup and shared helpers live in `public/js/shared.js`; browser project configuration lives in `public/js/firebase-config.js`.
- Firebase SDK imports currently use Google's CDN at version 11.10.0. Keep imports consistent.
- `firebase.json` serves `public/` and points Firestore rules at `public/firestore.rules`.
- There is no package manifest or build step. Existing `tests/*.test.mjs` use Node's built-in runner; rule tests use a loopback Firestore emulator and synthetic demo projects. Do not invent `npm test`, `npm run build` or root dependency installation. The only checked-in CI is the two Firebase Hosting workflows in `.github/workflows/`; they do not run tests or deploy Firestore rules.
- Reuse the existing page scripts, helpers, naming, and styling patterns. Keep changes focused; do not introduce a framework, dependency, or broad refactor without a task requirement.
- Escape untrusted values when rendering HTML; reuse `escapeHTML` from `shared.js` where appropriate.

### File responsibilities

- `public/js/tournament.js`: room configuration, result validation, feeders, targeted reset planning, legacy deduplication and absolute scoring.
- `public/js/admin.js`: authorization UI, room/status/result persistence, roster import, profile moderation and leaderboard recalculation.
- `public/js/roster-import.js`: pure CSV parsing and roster preview/identity validation.
- `public/js/predict.js`: owner profile initialization/editing and private prediction subscriptions/saves/resets.
- `public/js/usernames.js`: Unicode public-name validation, safe fallbacks and Google-name initialization policy.
- `public/js/leaderboard-sync.js`: persisted ranking and changed-row planning; `leaderboard.js`: public listener and shared-rank rendering.
- `public/js/lucky-draw-import.js`: pure bulk-name parsing, whitespace/case duplicate normalization, name/row limits and unique manual participant ID allocation.
- `public/js/luckydraw.js`: weighted wheel, saved pool, winner history and undo inside `public/admin/index.html`.
- `public/js/home.js` and `matches.js`: public room/result views. HTML/CSS remain page-specific; see README's structure map.
- There is no application server, Cloud Function or scheduled scorer. Browser SDK imports come from Google's CDN and require network access on first load.

## Project identity: do not change

The Firebase project ID is `gamefest-tetrio-2026`. It appears in `public/js/firebase-config.js` (`projectId`, `authDomain`, `storageBucket`), `.firebaserc`, both files in `.github/workflows/`, and `README.md`. The public site is served at `https://gamefest-tetrio-showdown.web.app/`.

- Do not rename, replace, or "fix" the project ID, the hosting site name, the repository name, or any of the values above, even though they contain "2026" and the event branding drops the year. Branding changes apply to visible text only: page titles, headings, footers, share metadata, and alt text.
- A search-and-replace for "2026" or "gamefest" must exclude `firebase-config.js`, `.firebaserc`, `.github/`, and URLs. Review every match by hand.
- Do not edit `.firebaserc`, `firebase.json`, or `.github/workflows/*` unless the user explicitly asks. Do not add other project IDs, aliases, or deploy targets.
- Changing the project ID would point the site at a different (or non-existent) database and break sign-in, saved predictions, and admin access.
- Pushing to `main` triggers `firebase-hosting-merge.yml`, which deploys to the live site (`channelId: live`). Never push to `main`. Pull requests trigger a preview deploy, so open one only when authorized.
- Never commit or print the `FIREBASE_SERVICE_ACCOUNT_GAMEFEST_TETRIO_2026` secret or any other credential.
- All data-writing verification must use loopback Firebase emulators with synthetic `demo-*` projects/accounts. Never use a production or PR-preview backend for tests, including this configured project ID. Keep tracked Firebase identifiers unchanged.

## Firebase and data safety

- Treat deployed and PR-preview hosts as live-backend clients. Emulator routing applies only to `localhost`, `127.0.0.1` and `[::1]` in `shared.js`; a LAN IP/custom hostname does not opt in.
- On those loopback hosts, Auth/Firestore connect to `127.0.0.1:9099`/`127.0.0.1:8080` with no production fallback. Run Auth, Firestore and Hosting together. The browser still uses project ID `gamefest-tetrio-2026`, while README's safe CLI command uses `demo-gamefest`; `--project` does not rewrite browser configuration. This namespace mismatch blocks treating demo UI accounts/rules as a verified browser setup. See README's caveat; never silently change tracked identifiers.
- Do not change the Firebase project, authentication providers, authorized domains, rules deployment, or deployment automation unless the user requests it.
- Do not deploy, alter remote data, publish/reopen tournament results, generate live brackets, or run/undo live draws without explicit authorization. Use a dedicated test project for checks that write data.
- Never commit passwords, service-account files, private keys, tokens, or real participant data. Public Firebase web configuration is not a privileged credential.
- Administrator authorization depends on Firebase Authentication plus `admins/<UID>` with `role: "admin"`. Preserve server-enforced Firestore permissions; do not replace them with a client-only check or a hardcoded password.
- Preserve owner-only profile/prediction access, valid Google-name initialization and moderator reset limits. Draw/revision changes must not expose Auth emails, broaden profile reads, grant roles or weaken Firestore validation. Scoring stays one correct pick = one point = one entry.
- A `.gitignore` rule does not remove a secret already committed to Git. If you discover one, report it without repeating its value; do not rewrite history or rotate credentials on your own.

## Behavior to preserve

Unless the task explicitly changes these rules:

- Groups `A`–`D` have eight slots each; blanks are allowed. Client readiness requires at least two distinct real players. Five cumulative group FFA rounds are the documented event format, but the application records only two ordered qualifiers, not group-round scores. Roster order never determines seeds.
- Two-player quarter-finals are FT7: `QF1=A1/B2`, `QF2=C1/D2`, `QF3=B1/A2`, `QF4=D1/C2`; 1/2 mean published group qualifier order.
- `SF1` takes QF1/QF2 winners; `SF2` takes QF3/QF4 winners; both are two-player FT9. Their winners enter `FINAL` (two-player FT11); their losers enter `THIRD` (two-player FT9).
- QF1–QF4 losers enter four-player `PLACEMENT`: five ordered FFA rounds, 4/3/2/1 points per round. Tied totals leave placings pending unless an organiser supplies a complete ranking consistent with unequal totals. Publishing unresolved ties is allowed. These competition points are not audience prediction points.
- Groups accept two distinct qualifier picks, unordered for scoring; every series, including THIRD, accepts one winner. PLACEMENT has no predictions. Each correct pick earns **1 point and 1 Lucky Draw entry**, without base participation awards, multipliers or podium bonuses.
- Predictions require sign-in, an open stage, ready/confirmed players, an unlocked room, unpublished results and status other than `completed`. FINAL/THIRD share the `final` stage. `live` does not automatically lock picks. Keep client behavior and Firestore validation aligned.
- Only `predictionsLocked === true` locks a room; a missing field means unlocked. Locking blocks creation, edits and owner resets, not saved-pick reads/scoring. Admin unlocking changes only that flag and does not override other restrictions. Locks survive normal roster/result/dependency changes and migration.
- Stored statuses are `upcoming`, `live`, `completed`; the UI calls the last **Ended**. Status-only saves do not publish, advance feeders, delete picks or recalculate. Only valid `resultsPublished: true` results advance competitors and score picks.
- Published rosters/status require **Reopen / Unpublish Results** before editing. Published results can be corrected directly with **Correct published results**, subject to the downstream guard. Reopening clears results, returns Upcoming and retains its own roster/predictions.
- The dependency guard rejects publishing, correction, reopening and roster changes when any transitive dependent has published results **or Ended status**, even for identical/same-winner submissions. Reopen published dependents deepest-first; use Save Room to change an unpublished Ended dependent's status because it has no Reopen control.
- Normal room operations commit fresh dependency/stale-state checks and room updates in one transaction. Only feeder rooms whose ordered confirmed player keys change reset; their predictions are deleted afterwards in batches of 450. Same-player corrections preserve downstream picks only when the guard permits correction. Existing feeder drift can also enter reset planning; review the confirmation.
- Initialization/migration is explicitly confirmed, never automatic. It fences fresh rooms and the leaderboard revision transactionally, then performs targeted prediction cleanup; never use it as routine cleanup.
- Lucky Draw certifies authoritative `leaderboard.correct` counts and configured manual-participant tickets (whole numbers 0–10,000), excluding zero-ticket participants and past winner UIDs. Manual identity is `manual:<id>`, never a name; reject duplicate/missing IDs, leaderboard UID collisions, missing names, invalid ticket counts and separate manual ticket overrides. Additions, removals and ticket edits invalidate certification until refresh. Every spin transaction reads `settings/leaderboardRevision` and `ticketAwards/currentDraw`, rejects stale/dirty pools and atomically saves history/exclusion. Undo atomically restores eligibility and historical tickets; refresh must validate current weights before another spin. Leaderboard ticket overrides cannot differ from prediction awards; manual tickets never create leaderboard/base points.

### Identity, names and ranking

- Competitor identities are immutable string keys in `rooms/<id>.players`, with separate `playerDetails[key].participantId` (text, preserving leading zeroes) and trimmed `username`. These are not audience Firebase UIDs. Never merge people by display name.
- CSV imports replace only listed A–D rosters, preserve matching keys and reject case-insensitive duplicate participant IDs/usernames, including omitted-group collisions. Manual editing has weaker ID/name validation. CSV preview can list more dependents than targeted save resets; do not document either limitation as stronger validation.
- Audience Firebase UID keys profiles, predictions, leaderboard rows and exclusions; duplicate full names are allowed. Google popup sign-in exists on Home/Predict/admin; admin also supports Email/Password. Matches/Leaderboard lack equivalent auth controls. `getAuth()` has no explicit persistence policy; do not infer disabled persistence or cross-origin sharing.
- Predict transactionally initializes a missing profile from a valid Google display name, never email. Valid custom names and timestamped `Participant` profiles survive. Only legacy `Participant` without `updatedAt` can auto-repair; no valid default means a temporary label and owner-edit prompt.
- Full Name editing is independent of prediction locks. Validation allows 3–80 Unicode code points from letters/marks/numbers, ordinary spaces and `. , ' ’ · ( ) _ -`, with a letter/number; reject emails, HTML, controls and invisible formatting. Trim ordinary edge spaces.
- Public names come from profiles at successful admin recalculation, not private prediction identity/Auth email. Moderator resets can only set another user's name to `Participant`; owners may edit again. Renaming changes ordering, not UID ownership, scores or exclusions.
- Scoring deduplicates UID/room submissions, preferring version 2 and then latest same-version timestamp. Legacy FINAL contributes only champion; series award at most one point. Unresolved/unpublished picks remain pending. Recalculation replaces absolute totals, never increments for resaving results.
- Recalculation follows normal result/roster operations and initialization, or the explicit button; not admin sign-in, stage/lock toggles or status-only saves. It reads predictions/rooms/existing rows, queries distinct profiles in groups of at most 30 UIDs and writes changed/malformed rows or deletes obsolete rows in batches of 450. Unchanged rows retain `updatedAt`.
- Keep the revision protocol on every scoring-affecting room/roster/migration and leaderboard writer, including future cleanup: atomically change its unique `version` and mark `ready:false` before changing source data. Only an owning, complete recalculation may set `ready:true`. Row chunks check ownership transactionally; never certify partial writes. Draw-only changes never change scores or public profiles.
- Persisted ranks are sequential after correct-count/name sorting, with stable equal-name ordering. Public ranks are competition ties (1, 1, 3), sorting equal scores by name then UID. Do not use stored rank as the displayed tie rank.

### Firestore data and permissions

These are current client-written shapes, not a claim that legacy data is migrated. Rules enforce exact fields for profiles, new predictions and leaderboard rows; room/settings/draw writes trust authorized admins.

| Path | Fields / purpose | Browser permissions |
| --- | --- | --- |
| `admins/<uid>` | `role: "admin"` | Own/admin read; no client writes |
| `rooms/<id>` | `name`, `stage`, sometimes `stageId`, `players`, `playerDetails`, `formatVersion: 2`, `status`, `resultsPublished`, `predictionsLocked`, timestamps, optional `feeders` | Public read; admin write |
| Room results | Groups: `qualifiers`; series: `scores`, `winner`, `loser`; PLACEMENT: `rounds` map, `totals`, `placings`, `tied`, `decision` | Room permissions |
| `settings/rounds_<stage>` | `predictionsOpen`, `updatedAt` | Public read; admin write |
| `settings/leaderboardRevision` | Exactly `version` (unique string), `ready`, `cleanupPending`, server `updatedAt` | Admin get/write only; no list/public read/delete |
| `profiles/<uid>` | Exactly `username`, `updatedAt` server timestamp | Owner/admin get; admin list; owner valid save or admin reset; no deletes |
| `predictions/<uid>_<roomId>` | Exactly `uid`, `roomId`, `stageId`, `displayName`, `selectedPlayers`, `formatVersion: 2`, `updatedAt` server timestamp | Owner/admin read; owner validated saves; available owner reset or admin delete |
| `leaderboard/<uid>` | Exactly `uid`, `displayName`, `correct`, `points` (= `correct`), `pending`, sequential `rank`, `updatedAt` server timestamp | Public read; admin validated write/delete |
| `ticketAwards/currentDraw` | `entries[{uid,displayName}]`, `excludedUids`, draw `version`, certified `leaderboardVersion`, saved editor settings, `updatedAt`, optional `lastWinner{uid,displayName,ticketsAtWin,drawnAt}`, `lastWinnerHistoryId` | Admin access; owner read only if a document has matching `uid` |
| `ticketAwards/<historyId>` | `type: "winner"`, `uid`, `displayName`, `ticketsAtWin`, server `drawnAt` | Admin write/read; matching owner read |
| `matches/<id>` | Legacy collection, not the current bracket source | Public read; admin write |

All other paths are denied. Prediction rules independently validate stage, membership and series feeders, but do not recompute official scores or enforce all admin room invariants. The client writes prediction `displayName: "Participant"`; rules only constrain that compatibility field to a string of at most 100 characters.

### Spark and failure recovery

- Firestore free quota currently includes 50,000 reads/day, 20,000 writes/day, 20,000 deletes/day, 1 GiB storage and 10 GiB outbound/month. Hosting has separate project-wide quotas; see README's Firebase references. Source does not establish the live billing plan or remaining quota.
- Subscriptions incur initial/update/reconnect reads: 150 viewers × 150 rows imply about 22,500 initial reads. Changed-row suppression does not cap usage. Avoid broad profile listeners and per-prediction profile reads.
- Keep Spark-compatible browser-only operations: no paid services, Functions, new listeners or per-ticket/per-prediction reads. Certified spins use two application document reads and two writes before transaction retries/rule lookups; refresh reads the leaderboard once, not once per ticket.
- Prediction cleanup follows the room/revision transaction. Query/delete failures keep draws blocked and skip automatic recalculation. Resolve leftovers before explicit recalculation or republishing. Interrupted cleanup can leave `cleanupPending:true`; only an authorized maintainer may clear it after confirming cleanup has stopped and resolving leftovers. Never bypass it automatically.
- Draw selection/history/exclusion and undo/history deletion each commit atomically. All editors use draw-version checks to avoid overwriting concurrent winners. Never select from cached/offline leaderboard reads or announce a winner before its transaction commits.
- For synthetic cleanup, follow README's Reopen/Unpublish sequence, preserve own-room picks, resolve deletion failures before republishing and undo test winners separately. Never bulk-delete production collections or use initialization as cleanup.
- Open issues are proposals, not permission to implement them. Base participation points, audience/Form import/linking, wheel safeguards/presentation, unified auth, name refinements and personal statistics are not current feature guarantees; see README.

## Verify changes

- Run the narrowest available check that exercises the changed behavior. Do not claim a check passed unless you ran it.
- For interface changes, serve the site over HTTP and inspect the actual affected page, including relevant mobile layout and browser console errors.
- For authentication, predictions, scoring, or draw changes, verify the affected flow with isolated test accounts/data and check failure or unauthorized paths where relevant.
- For rule changes, verify allowed and denied requests in a safe test environment. Do not weaken rules just to make a manual test pass.
- For documentation-only changes, verify referenced local paths, links, commands, and configuration claims. Do not contact or mutate the live backend just to check documentation.
- If tooling, permissions, or a safe test backend is unavailable, state the limitation and distinguish verified behavior from assumptions.
- Update relevant documentation when behavior, setup, or the workflow changes.
- Use README's root-directory Node and `firebase emulators:exec --only firestore --project demo-gamefest` commands for focused regression/rule checks. Rule tests install rules into unique demo namespaces, reject non-loopback hosts and clean fixtures. A skip is not a pass.
- Java 21+ must be selected by `JAVA_HOME`/`PATH`, not merely installed. Disclose the current browser/demo namespace mismatch; empty local pages or demo rule tests do not prove an authenticated browser flow.
- Deploy only with authorization: compatible rules first, then Hosting, coordinating rules before any Hosting-only main workflow cutover. Preview Hosting is not a test database. Follow README's pause/reload/privacy-preserving rollback procedure; never deploy to verify documentation.

## Commits and pull requests

- Commit only the task's intended changes, with a descriptive message. Never include unrelated staged or unstaged work.
- Do not force-push, rewrite shared history, or bypass branch protection.
- Do not push a branch or open a PR unless the user requests or authorizes that remote action.
- When authorized to open a PR, target `main`, explain the change, list checks and limitations, add screenshots for visual changes, and flag configuration/rules/data impacts.
- Request review from at least one human teammate. Wait for approval; do not merge automatically or merge an unreviewed PR. A maintainer handles the merge.
- If no PR was opened, finish by reporting the branch, changed files, checks performed, and that the branch still needs pushing and a PR.

The full beginner-friendly Git workflow is in `README.md`. GitHub branch protection or rulesets must be configured separately by a repository administrator; writing these instructions does not protect `main` by itself.