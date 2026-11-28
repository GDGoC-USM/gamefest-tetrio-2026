# AI contributor instructions

## Before acting

1. Read `README.md` and, before significant modifications, the human-written `For thou in the future.md`. Preserve that document verbatim, including tone and closing. Preserve historical event results/screenshots; never use real participant data as test fixtures.
2. Understand the static architecture and affected source/tests before proposing edits. Verify behavior rather than blindly trusting documentation, closed issues or AI output. `README_FIRST.txt` is historical; its project-creation, combined-deploy, cleanup and pre-base-ticket instructions are not current authority.
3. Inspect branch/status, staged/unstaged changes, untracked files and recent history. Preserve user/teammate work; never discard, reset, stash or stage unrelated changes. Keep the current task branch. Never commit/push directly to `main`.
4. For a new task with a clean tree on `main`, update with `git pull --ff-only origin main` then create a descriptive branch. When asked to synchronize an existing branch, fetch/compare latest main and upstream first; fast-forward when possible. Do not move dirty work between branches or overwrite conflicts.
5. Stay within scope. Prefer existing patterns; no unnecessary features, dependencies, frameworks or architectural complexity. Report application issues instead of fixing them in documentation tasks.

## Structure and responsibilities

Static multi-page app: `public/*.html`, `public/admin/index.html`, page styles in `public/css/`, browser ES modules in `public/js/`. No package manifest, build step, app server, Cloud Function or scheduled scorer. Firebase SDK imports use Google's CDN at **11.10.0**; keep versions consistent.

| Modules under `public/js/` | Responsibility |
| --- | --- |
| `shared.js`, `firebase-config.js` | Firebase setup/exports, loopback routing, auth/escaping and public configuration |
| `auth-ui.js`, `profiles.js`, `usernames.js` | Shared auth states, transactional profile initialization and Unicode names |
| `tournament.js` | Pure formats, validation, feeders, targeted resets, legacy deduplication and absolute scoring |
| `roster-import.js` | Pure competitor CSV parsing/identity validation/preview |
| `home.js`, `matches.js`, `predict.js` | Public rooms/results, owner predictions and Full Name editor |
| `leaderboard.js`, `leaderboard-sync.js` | Public/personal statistics, competition ranks and changed-row planning |
| `leaderboard-recalculate.js`, `leaderboard-revision.js` | Profile-aware scoring persistence and revision fencing |
| `admin.js`, `participant-cleanup.js` | Dashboard, rooms/results/moderation and durable UID cleanup/recovery |
| `luckydraw.js`, `lucky-draw-sync.js` | Wheel UI/presentation and transactional refresh/spin/undo |
| `lucky-draw-import.js`, `lucky-wheel-geometry.js`, `lucky-confetti.js` | Bulk manual names/IDs, pointer geometry and reduced-motion-aware celebration |

`public/faq.html` is the participant guide, not scoring authority; its base-ticket wording is stale. `tests/*.test.mjs` use Node's runner; rules tests use isolated Firestore. `tests/lucky-draw.browser.mjs` prepares an ignored aligned demo copy. Historical images: `docs/screenshots/dday-results/`; relocated development images: `docs/screenshots/tests/`; browser regressions: `tests/screenshots/pr51/`. No separate supported backup/offline draw app exists.

## Project identity and production safety

- Keep Firebase project **`gamefest-tetrio-2026`**, browser identifiers, `.firebaserc`, `firebase.json` and `.github/workflows/*` unchanged unless explicitly requested. Current documented website: `https://gamefest-tetrio-2026.web.app/`; the showdown hostname in the handover is historical. Branding edits must not replace IDs/URLs.
- Never deploy, reset/migrate or modify production data, publish/reopen live results, recalculate live scores or run/undo live draws without explicit authorization. Production and PR-preview pages are live-backend clients, not test environments.
- Test only with isolated loopback Firebase emulators and synthetic `demo-*` projects/accounts. Never use real participant records/exports for testing or expose emails, Auth directories, credentials, tokens, service-account keys or billing identifiers.
- Exactly `localhost`, `127.0.0.1` and `[::1]` enable Auth `127.0.0.1:9099` and Firestore `127.0.0.1:8080` with no production fallback. LAN/custom hosts do not. Run Auth, Firestore and Hosting together.
- `--project demo-gamefest` does not rewrite browser configuration: the generic preview retains the production project namespace on loopback. Use README's ignored `.local/pr51` demo preparation/aligned namespace for authenticated checks; never edit tracked IDs to solve the mismatch.
- Public Firebase configuration is not a privileged secret. Report actual secrets without repeating them; do not rotate credentials/rewrite history on your own. Ignoring a file does not remove it from Git history.
- Historical screenshot publication approval is artifact-specific; recheck consent/redaction for new images/reuse. MIT authority is pending: do not add a license/badge without organisation/copyright-holder approval, or imply it covers private data, fonts or third-party branding.

## Tournament and prediction invariants

- A–D: eight slots each, blanks allowed; client readiness needs two distinct real players. Five cumulative group FFA rounds are documented but only two ordered qualifiers stored. Roster order never sets seeds.
- QFs FT7: `QF1=A1/B2`, `QF2=C1/D2`, `QF3=B1/A2`, `QF4=D1/C2`. `SF1` takes QF1/QF2 winners, `SF2` QF3/QF4 winners; both FT9. Winners enter FINAL FT11; losers THIRD FT9.
- QF losers enter PLACEMENT: five ordered four-player FFA rounds, 4/3/2/1 competition points. Tied totals need a complete organiser ranking consistent with unequal totals; unresolved publication is allowed. Never silently break ties or award audience points for placement.
- Groups accept two distinct qualifier picks, unordered for scoring; series including THIRD accept one winner. No PLACEMENT predictions. Correct pick = **one point and one additional draw ticket**; no bonuses/multipliers/base leaderboard points. Unresolved/unpublished picks remain pending.
- Preserve UID/room deduplication: prefer format version 2, then latest same-version timestamp. Legacy FINAL scores champion only; series max one point. Recalculation replaces absolute totals, never increments.
- Saves/resets require sign-in, stage open, ready/confirmed players, unlocked room, unpublished results and status not `completed`. FINAL/THIRD share `final`; Live does not lock. Only `predictionsLocked === true` locks; missing means unlocked. Locks block creates/edits/resets, not reads/scoring, and survive roster/result/dependency/migration changes.
- Stored statuses: `upcoming`, `live`, `completed` (UI Ended). Status-only saves do not publish/advance/delete/recalculate. Only valid published results feed competitors.
- Reopen published rooms before roster/status edits; direct result correction is available subject to the dependency guard. Reopening clears results, returns Upcoming and preserves own roster/picks/locks.
- Block publishing/correction/reopening/roster changes whenever any transitive dependent has published results **or Ended status**, even same-winner/identical submissions. Reopen published descendants deepest-first; use Save Room for unpublished Ended descendants.
- Fresh dependency/stale-source checks and normal room writes share one transaction. Reset only feeders whose ordered confirmed keys change (including drift); delete their predictions afterwards in batches of 450. Guard-permitted same-player corrections preserve downstream picks. Initialization/migration is explicit, transactionally fenced and never automatic/routine cleanup.
- Competitor keys are immutable strings; `playerDetails[key].participantId` is text preserving zeroes, username trimmed. CSV replaces listed A–D only, retains matching keys and rejects case-insensitive ID/username collisions including omitted groups. Manual edits have weaker checks; preview dependents can exceed actual resets.

## Identity, auth and privacy

- Audience Firebase UID owns profiles/predictions/leaderboard/exclusions. Duplicate full names are valid; never merge by name or equate competitor/manual IDs with audience accounts.
- All four main public pages share Google popup auth/restoration states. Admin supports Google and Email/Password. Denied Admin access keeps the audience signed in but dashboard hidden. SDK persistence is unchanged; do not claim disabled persistence, cross-origin sharing or guaranteed blocked-storage restoration.
- `profiles.js` initializes missing profiles transactionally from valid Google display names, never email/local parts. Preserve custom names and timestamped `Participant`; auto-repair only legacy timestampless placeholders. Missing/invalid defaults prompt owner editing; do not infer provenance or silently migrate.
- Full Name edits are independent of locks. Allow 3–80 Unicode code points from letters/marks/numbers, ordinary spaces and `. , ' ’ · ( ) _ -`, with a letter/number; reject HTML/emails/controls/invisible formatting and trim ordinary edge spaces.
- Public names come from profiles at successful recalculation, never prediction/Auth email. Moderator writes only reset another name to `Participant`; owners may edit again. Prediction compatibility `displayName` stays `Participant`. UI fallback does not remove historical public fields.
- Keep account/epoch guards and clear old private state/subscriptions on sign-out/switch. Escape untrusted rendering with `escapeHTML` in appropriate HTML contexts, or use text APIs; it is not a URL/JS sanitizer.
- Admin authorization is Auth plus protected `admins/<UID>.role == "admin"`, enforced by rules. Never use a hardcoded password/client-only check or weaken rules to make an implementation work.

## Firestore contracts and transactional integrity

| Path | Contract / permissions |
| --- | --- |
| `admins/<uid>` | Own/admin read; no browser writes |
| `rooms/<id>`, legacy `matches/<id>` | Public read; admin write |
| `settings/rounds_<stage>` | Public stage settings; admin write |
| `settings/leaderboardRevision` | Admin-only get/create/update; exactly `version`, `ready`, `cleanupPending`, server `updatedAt`; no list/delete |
| `settings/participantCleanup` | Admin-only get/create/update; exactly `id`, `version`, `uids`, `phase`, `deletedPredictions`, `deletedRows`, server `updatedAt`; no list/delete |
| Other settings | Public read; admin write |
| `profiles/<uid>` | Exactly `username`, server `updatedAt`; owner/admin get, admin list, owner valid save/admin reset-only; no delete |
| `predictions/<uid>_<roomId>` | Exactly UID/room/stage, compatibility displayName, selectedPlayers, formatVersion 2, server updatedAt; private owner/admin reads, validated owner saves/resets/admin deletes |
| `leaderboard/<uid>` | Exactly `uid`, `displayName`, `correct`, `points` (= correct), `pending`, sequential `rank`, server `updatedAt`; public read, validated admin write/delete |
| `ticketAwards/currentDraw` | Entries/settings/manual participants/overrides, removedUids, excludedUids, version, leaderboardVersion, ticketPolicy, optional last winner; admin access |
| `ticketAwards/<historyId>` | Winner UID/name/ticketsAtWin/server drawnAt, type winner; admin access/matching owner read |

Unmatched paths are denied. Current draw owner reads require a matching document UID, normally absent. Rules validate prediction ownership/stage/status/locks/players/feeders, not every admin result/transaction invariant; admin room/draw writes are trusted. Strict schemas do not retroactively migrate old documents.

- Every scoring-affecting room/roster/migration/leaderboard writer must atomically invalidate the unique revision before source changes. Reject pending cleanup overlap. Revision-checked row chunks retain ownership; only complete owning recalculation sets ready true. Draw-only operations do not alter scores/profiles.
- Persisted ranks are sequential after correct/name sorting with stable equal-name order. Public ranks are competition ties, then name/UID order; personal rank must match the public table, never stored rank/name matching. Personal Submitted Tickets counts unique saved rooms, not draw tickets.
- Durable participant cleanup previews/revalidates UID predictions/rows, blocks award/exclusion conflicts, preserves Auth/profiles/other participants, and freezes selected owners' prediction mutations while active. Phases: review/deleting/recalculating/complete. Each deletion chunk (max 450 plus job update) checks revision/job ownership; final recalculation completes job/revision atomically.
- Resume participant cleanup through Load participants → Preview interrupted cleanup, review/confirm. Never manually clear that job/fence. Ordinary room prediction cleanup is separate: failures block draws/automatic recalculation; resolve leftovers before republishing. Only an authorized maintainer may clear its interrupted fence after proving cleanup stopped and resolving leftovers.
- If future sources can recreate leaderboard rows (registration/linking/base awards), integrate them into revision fencing and UID-scoped preview/revalidation/deletion/recovery before release; do not invent those records now.

## Lucky Draw fairness and ticket policy

- Website tickets are **1 + authoritative leaderboard.correct**, including zero-correct rows; no base points. Sign-in alone grants no row/ticket. Bulk manual rows start at one ticket; configured manual tickets are whole numbers 0–10,000 and never create leaderboard/base points.
- Preserve `ticketPolicy: 2`; old/absent policy certification cannot spin until refresh. Website overrides must equal 1 + correct. Reject manual overrides, invalid counts/names/IDs, duplicate manual IDs and leaderboard UID collisions.
- Manual identity is `manual:<id>`, not name. Bulk names accept max 200 rows, max 60 characters/name; trim edges/ignore blanks, preview/confirm. Normalized duplicate names are warnings, not blocks/merges. Reimport creates distinct IDs; no Forms/Auth linking or real-person deduplication exists.
- Exclude zero-ticket manual participants, winner excludedUids and administrator removedUids. Removals persist through refresh/reload/import; restore derives current eligibility without changing scores/accounts or undoing a winner.
- Refresh brackets one server leaderboard query with revision checks and version-checks currentDraw. Edits invalidate certification. Spin reads revision/currentDraw, rejects stale/dirty state/policy, atomically saves history/exclusion before animation/announcement. Keep random sample fixed across transaction retries and winner geometry stable through reveal.
- Undo deletes history/restores historical tickets atomically; refresh validates current weights before another spin. Never select from cached/offline sources or bypass certification. Review overlapping manual/website identities for duplicate real-person eligibility.

## Efficiency, testing and release

- Avoid unnecessary Firestore reads/listeners/recalculations, per-ticket reads and per-prediction profile lookups. Reuse browser-only design; do not add paid services/Functions casually.
- Recalculate after successful scoring-affecting room/roster/init operations or explicit repair, not sign-in, locks, stage toggles or status-only saves. Query profiles in groups of at most 30, write changed/malformed rows/delete obsolete rows in ownership-checked chunks of 450; unchanged timestamps stay unchanged.
- Unchanged recalculation still reads sources and claims/finishes revision; refresh draw afterward. Initial/update/reconnect subscriptions cost reads. Leaderboard currently duplicates its owner-profile initialization read for the personal card; do not claim one profile read per page everywhere.
- Spin uses two application document reads/two writes before retries/rules lookups. Draw stores every ticket in one document and renders per-ticket segments without an aggregate cap; review document-size/rendering costs before scaling. Historical usage does not prove current plan/quota.
- Choose narrow root-directory `node --test tests/<affected>.test.mjs` checks; no npm/build scripts exist. Rules checks use README's `firebase emulators:exec --only firestore --project demo-gamefest` commands. Java 21+ must actually be selected. Tests reject non-loopback hosts/use disposable namespaces; skips are not passes.
- UI changes require actual HTTP desktop/mobile inspection and console checks. Auth/prediction/scoring/draw changes require synthetic allowed/denied, account-switch and stale/concurrent paths where relevant. Use the aligned browser harness, not empty generic demo pages as proof.
- Documentation-only work: verify local links/anchors, commands/config/source claims, preservation and `git diff --check`; do not access production or run unrelated tests. Report only checks run and limitations; update docs with behavior/workflow changes.
- Deploy only with explicit authorization and human review: pause admin operations, compatible rules before Hosting, reload tabs and refresh old-policy pools. Workflows only deploy Hosting: live on main pushes, preview on same-repository PRs; no test/rules CI. Preview is not isolated. Preserve privacy on rollback; no data deletion/weaker rules as shortcuts.

## Unresolved work and collaboration

D-Day `Participant` names and ~10-second draw startup at ~200 entries are reported observations, not diagnosed causes. Investigate initialization/synchronization and synthetic timing before fixes. Valid-name requirements before predictions, UI/UX, realistic load/offline planning, billing and admin anti-abuse remain follow-up decisions. Open #15/#37 concern anti-abuse/security triage, not a confirmed exploit. Closed #29 does not mean Forms linking/base points shipped. FAQ/public “Entries” labels omit base tickets; personal statistics lack dedicated direct regression tests. Font/branding rights need review.

Commit only intended changes; no unrelated staging, force-push, shared-history rewrite or automatic merge. Push/open PR only when authorized; target main, state checks/limitations and rules/config/data impacts, request a human teammate review and wait for approval. A maintainer merges. If no PR opened, report branch, files, verification, blockers and that pushing/PR remain. Branch protection must be configured separately.