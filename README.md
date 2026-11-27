# GameFest TETR.IO Showdown

A tournament management and audience prediction website for GameFest. Visitors follow rooms and results, sign in with Google, predict group qualifiers and head-to-head winners, and earn leaderboard points. Administrators manage the bracket, publish results, and run a weighted Lucky Draw.

Public site: https://gamefest-tetrio-2026.web.app/ · Repository: https://github.com/GDGoC-USM/gamefest-tetrio-2026

Current features include live room views, stage/room prediction controls, competitor CSV roster import, result publication/correction/reopening, UID-based scoring, editable public names, and an administrator-operated weighted wheel with history/undo. “Lucky Wheel” in issues refers to the existing **Lucky Draw** dashboard module, not a separate public page.

## Technology

- Plain HTML, CSS, and browser JavaScript modules; no frontend framework or build step.
- Firebase Authentication for Google sign-in and administrator email/password sign-in.
- Cloud Firestore for tournament data, predictions, rankings, and draw history.
- Firebase Hosting for serving the `public/` directory.
- Firebase JavaScript SDK 11.10.0, imported directly from Google's CDN.

There is no `package.json` or build step. Pure regression scenarios use Node's built-in test runner; no dependencies are needed to run them. The checked-in GitHub workflows deploy Firebase Hosting previews for pull requests and the live site on pushes to `main`; do not push or open a PR without authorisation.

## Project structure

```text
.
├── README.md                 Project setup and team workflow
├── AGENTS.md                 Instructions for AI contributors
├── README_FIRST.txt          Supplementary operations; see caveats below
├── .gitignore                Local cache, logs, dependencies, and environment files
├── .firebaserc               Default Firebase deployment project
├── firebase.json             Hosting directory and Firestore rules path
├── tests/                    Node regressions and isolated Firestore rule tests
└── public/
    ├── index.html            Homepage and room overview
    ├── matches.html          Tournament rooms and published results
    ├── predict.html          Audience prediction interface
    ├── leaderboard.html      Public rankings
    ├── faq.html              Participant FAQ and user guide
    ├── firestore.rules       Database permissions and prediction validation
    ├── admin/
    │   └── index.html        Admin dashboard and Lucky Draw interface
    ├── css/
    │   ├── style.css         Public pages
    │   ├── admin.css         Admin dashboard
    │   └── luckydraw.css     Lucky Draw
    ├── images/               Gamefest and GDG branding
    └── js/
        ├── firebase-config.js  Browser Firebase configuration
        ├── shared.js           Firebase initialization, auth, and shared helpers
        ├── tournament.js       Pure tournament format, validation, feeders, and scoring
        ├── roster-import.js    Pure CSV parsing, identity checks and preview planning
        ├── home.js             Homepage data and sign-in controls
        ├── matches.js          Public room and result display
        ├── predict.js          Prediction selection, saving, and room updates
        ├── usernames.js        Full-name validation and privacy-safe profile defaults
        ├── leaderboard.js      Public leaderboard display
        ├── leaderboard-sync.js Pure ranking and changed-row planning
        ├── admin.js            Room management, bracket generation, and scoring
        ├── lucky-draw-sync.js  Transactional draw refresh, spin and undo
        ├── lucky-draw-import.js Pure bulk-name parsing, duplicate checks and manual ID planning
        ├── lucky-confetti.js   Reduced-motion-aware winner celebration
        ├── lucky-wheel-geometry.js Pure segment, rotation and label geometry
        └── luckydraw.js        Ticket selection, wheel rendering and winner history
```

Page scripts share Firebase access through `shared.js`. The main Firestore collections are `rooms`, `settings`, `profiles`, `predictions`, `leaderboard`, `admins`, and `ticketAwards`. Rules accept new room-based predictions only; legacy records remain readable and are rescored where applicable.

## Tournament behavior

- Groups `A`, `B`, `C`, and `D` each have eight slots; blanks are permitted. The documented event format is five cumulative free-for-all (FFA) rounds, but the application records only two manually published qualifiers in first/second order, not group-round scores. Roster order never determines seeds.
- Eight qualifiers enter four head-to-head quarter-finals (`QF1`–`QF4`, first to 7). Semi-finals (`SF1`, `SF2`) and the third-place match (`THIRD`) are first to 9; `FINAL` is first to 11.
- Semi-final winners enter `FINAL`; semi-final losers enter `THIRD`. The four quarter-final losers enter `PLACEMENT`: five FFA rounds, awarding 4/3/2/1 points per round. Total points determine fifth through eighth; tied totals leave placings pending until an organiser records an explicit decision.
- Predictions select two group qualifiers (unordered for scoring) or one winner per head-to-head series. There are no predictions for FFA placement positions. Each correct selected player earns exactly **one point and one Lucky Draw entry**. Unresolved results remain pending, not incorrect.
- Administrators control prediction availability by stage and can lock individual rooms under **Admin → Rooms**. A room accepts predictions only when its stage is open, its room lock is off, its players are ready, and its results are unpublished and status is not Ended. Locking or ending preserves saved picks and blocks new picks, edits and user resets; unlocking never overrides the other restrictions. Leaderboard recalculation replaces absolute totals from current published results; resaving an unchanged result never adds points again. Legacy semi-final/final picks receive no old bonuses or podium scoring.
- Lucky Draw weights leaderboard entries by authoritative `leaderboard.correct` and manual participants by their configured whole-ticket counts (0–10,000). Zero-ticket participants and past winner UIDs are excluded. **Refresh Latest Entries** certifies both sources against one complete leaderboard revision. Manual entries retain separate `manual:<id>` identities; duplicate names do not merge people. Missing/duplicate IDs, collisions with leaderboard UIDs, missing names, invalid counts and separate manual ticket overrides block certification. Adding, removing or editing manual participants invalidates certification until refreshed. Leaderboard ticket overrides must still equal prediction awards. Every spin transaction rejects dirty/outdated revisions and stale draw state, then atomically saves the winner, history and exclusion before animation. Undo restores eligibility and historical tickets atomically; refresh validates current weights before another spin. Manual tickets do not create leaderboard points or base participation credit.

- **Bulk Import Participants** accepts up to 200 newline-separated names per import, trims surrounding whitespace, ignores empty lines, and previews every entry before confirmation. Each name starts with one ticket and receives its own generated manual ID. Names longer than 60 characters or lists above the row limit block import with row-level messages. Names are compared after trimming, collapsing repeated internal spaces and case-folding; duplicates within the paste or against current wheel participants are highlighted red and counted, but never block import, merge entries or remove participants. Original spelling and capitalisation are preserved and names render as text. Imports are saved in one draw transaction, so a concurrent administrator change rejects the whole import. The bulk path uses the same manual-participant field and ticket-pool invalidation as single addition; it creates no profile, leaderboard row or participation point.

Reopening clears the room's results, returns Upcoming and retains its roster and own predictions. Normal result/roster changes reset feeder rooms only when their ordered confirmed player keys change; reset-room predictions are deleted afterwards in batches of 450. Room updates, dependency checks and stale-source checks share one Firestore transaction; prediction deletion and leaderboard recalculation are separate.

The dependency guard blocks publishing, correction, reopening and roster changes whenever a transitive dependent has published results **or Ended status**, including an unpublished Ended room. This also blocks identical/same-winner submissions. Reopen published dependents deepest-first; change unpublished Ended dependents to Upcoming with **Save Room** because they have no Reopen control. Once the guard permits a same-player correction, downstream results/picks are retained.

Exact feeds: `QF1=A1/B2`, `QF2=C1/D2`, `QF3=B1/A2`, `QF4=D1/C2`; `SF1` takes QF1/QF2 winners and `SF2` QF3/QF4 winners. A1/A2 mean A's published first/second qualifier. Only valid published results advance players; unresolved feeder slots remain unpickable.

Room locks use `rooms/<id>.predictionsLocked`. Only `true` locks a room; a missing field means unlocked for backward compatibility. New rooms start unlocked. Stage toggles, roster changes, publishing/reopening results and format migration retain explicit locks, including locks on dependent rooms. Changing a lock alone never changes match status, results, bracket dependencies or saved predictions. `PLACEMENT` has no predictions or lock control.

Administrators can save **Upcoming**, **Live** or **Ended** under the room editor. Ended uses stored `status: "completed"`; it blocks prediction saves/resets but does not publish, advance feeders or score picks. **Live does not automatically lock predictions**: lock the room separately. Unpublished Ended rooms allow result entry. **Publish Results** confirms results; **Correct published results** can correct them directly subject to the downstream guard. Reopen is required before changing a published roster/status, not every result correction. Reopening preserves explicit locks.

Player references remain stable legacy string keys in `rooms/<id>.players`. Separate `playerDetails[key]` fields hold a text participant ID (preserving leading zeroes) and a trimmed username. Organisers enter the roster in the admin dashboard; never commit a real roster. Initialising/migrating the tournament requires explicit destructive confirmation in the admin dashboard; it never runs automatically on page load.

### Known discrepancies and proposed work

This audit uses `main` at `c9d4eb9` and the source, not production-data inspection. Merged features include knockout/+1 scoring ([#12](https://github.com/GDGoC-USM/gamefest-tetrio-2026/pull/12)), roster import ([#18](https://github.com/GDGoC-USM/gamefest-tetrio-2026/pull/18)), room locks ([#20](https://github.com/GDGoC-USM/gamefest-tetrio-2026/pull/20)), private profiles/changed-row synchronization ([#22](https://github.com/GDGoC-USM/gamefest-tetrio-2026/pull/22)), Google-name defaults/Ended status ([#28](https://github.com/GDGoC-USM/gamefest-tetrio-2026/pull/28)) and transactional room operations ([#26](https://github.com/GDGoC-USM/gamefest-tetrio-2026/pull/26)).

These open issues are **not implemented guarantees**:

| Issue | Remaining proposal or reported limitation |
| --- | --- |
| [#29](https://github.com/GDGoC-USM/gamefest-tetrio-2026/issues/29) | Pointer/winner synchronization, wheel readability/presentation mode, audience/Form imports and identity linking, one-time base participation points/entries |
| [#30](https://github.com/GDGoC-USM/gamefest-tetrio-2026/issues/30) | Shared transactional Google-name defaults now run on all four public pages; timestamped/ambiguous placeholders still require owner editing, not migration |
| [#31](https://github.com/GDGoC-USM/gamefest-tetrio-2026/issues/31) | Shared public auth controls and restoration states; denied Admin access preserves audience sessions; browser/storage-dependent persistence still needs environment-specific verification |
| [#32](https://github.com/GDGoC-USM/gamefest-tetrio-2026/issues/32) | Personal prediction statistics and highlighting the signed-in leaderboard row |
| [#15](https://github.com/GDGoC-USM/gamefest-tetrio-2026/issues/15) | Enforced administrator anti-abuse controls/monitoring; production provider settings are not established by source |

There are currently **no base participation points**, no audience/Form importer and no registration-to-Auth link. The CSV importer below handles competitors, not wheel participants. Points equal correct picks; certified wheel weights use correct picks. Wheel presentation/readability remains separate work under #29; this change protects persisted selection, not every aspect of presentation.

`README_FIRST.txt` retains event context but contains conflicting instructions: its create-project/combined-deploy sections do not apply to this configured repository; results can be corrected without reopening; resets are conditional; and cleanup recovery is not guaranteed for every failure. Follow this README/current source in those cases. Its organiser questions remain unresolved: THIRD is implemented as FT9 despite an FT5 rulebook reference, FFA ties need manual decisions, and roster completeness/knockout prediction intent need confirmation. Do not silently change the application to resolve intended requirements.

Other current limitations: CSV preview lists dependents more broadly than targeted save may reset; manual roster editing lacks CSV's global ID/username uniqueness checks. Initialization/migration uses a separate unchunked batch, not the normal transaction path. These are reported findings, not application changes in this documentation PR.

## Full names and privacy

On the prediction page, signed-in viewers can save their public **Full Name** independently of predictions, including while predictions are locked or ended. Names contain 3–80 Unicode code points: letters, combining marks, numbers, ordinary spaces and the punctuation `. , ' ’ · ( ) _ -`, with at least one letter or number. Ordinary edge spaces are trimmed. Emails, HTML, control characters, line breaks and invisible formatting characters are rejected. Duplicate names are allowed; Firebase UID remains the permanent identity. Competitor TETR.IO usernames and participant IDs are unchanged.

For a missing profile, Home, Matches, Predict and Leaderboard save a valid Google account display name once through the shared initializer. Every sign-in entry point discloses this public-name default and links to the editable name on Predict; no email or email local part is used. If Google provides no valid name, viewers see a temporary `Participant` label and a prompt to enter their full name on Predict. Existing valid custom profiles are never overwritten on sign-in. An old `Participant` profile without `updatedAt` can be repaired on its owner's next login; timestamped `Participant` profiles require explicit owner editing because they may be moderator resets or deliberate choices. Ambiguous/invalid existing profiles are not silently replaced. No provenance migration or stronger consent policy is introduced.

`profiles/<uid>` still stores exactly `username` and `updatedAt` (a server timestamp); `username` is retained as an internal compatibility field, not an audience-facing label. Owners can retrieve and save their own profile, but cannot list profiles or read another person's profile. Authorised administrators can retrieve individual profiles and list profiles. They can reset another account's name only to `Participant`, not assign an arbitrary replacement. Clients cannot delete profiles or grant administrative roles.

Each public page reads the owner's profile once per sign-in/session load, not through a real-time listener. `profiles.js` shares the initialization transaction with Predict's editor/retry path, so a concurrent custom-name save or moderator reset is preserved rather than overwritten by a stale Google default. Predict does not perform a second initialization read through the auth controller. A normal load reads one profile and adds at most one initialization write; contention can require transaction retries. Existing valid profiles add no writes. Navigation adds one owner-profile read per page. Profile state clears on sign-out or account switching. Names become public at the next successful administrator leaderboard recalculation, not immediately. Changing a name never changes authentication identity, predictions, scores, Lucky Draw ownership or previous-winner exclusions.

Under **Admin → Prediction Settings → Full name moderation**, select **Load full names**, select the name/account UID, and confirm **Reset full name to Participant**. Recalculate the leaderboard when ready. Users may choose another name afterwards; permanent restrictions and automatic filtering are not implemented.

Leaderboard and Lucky Draw names use valid stored public names or `Participant`, never emails or legacy prediction identities. The required prediction `displayName` compatibility field remains `Participant`; private predictions and historical award records are not migrated. Public names are validated and escaped at rendering boundaries. Full names are intentionally public: the profile editor explains this before a viewer saves a custom name.

The public `leaderboard/<uid>` schema is exactly:

| Field | Value |
| --- | --- |
| `uid` | Permanent Firebase UID, equal to the document ID |
| `displayName` | Valid profile full name, otherwise `Participant` |
| `correct` | Non-negative integer correct-pick/Lucky Draw entry count |
| `points` | Equal to `correct` |
| `pending` | Non-negative integer unresolved-pick count |
| `rank` | Existing sequential persisted rank |
| `updatedAt` | Server timestamp of the last persisted change |

Public equal-score rows retain shared ranks and alphabetical name ordering, then UID ordering. Renaming may change ordering within ties, but never scores or entry ownership. Recalculation replaces documents without merging, removing stale names and unexpected fields. Hiding an invalid name in the UI does **not** remove the underlying publicly readable document fields; production inspection or repair needs separate authorisation. No automatic production cleanup is provided.


## Leaderboard recalculation and Spark usage

Use **Admin → Prediction Settings → Recalculate leaderboard** to intentionally refresh names or repair stale data. Admin sign-in does not recalculate. Publishing, correcting or reopening results, roster changes and initialization trigger recalculation after successful room processing. Stage toggles, room locks and status-only saves do not. Unchanged published-result submissions recalculate only if the dependency guard allows them.

Each recalculation reads predictions, rooms and the existing leaderboard once from the server, deduplicates predictions, and queries distinct participating profiles in document-ID groups of at most 30. It adds no profile listeners or per-prediction profile reads. Scoring remains absolute and unchanged.

`settings/leaderboardRevision` is an admin-only four-field document: unique string `version`, boolean `ready`, boolean `cleanupPending`, and server `updatedAt`. Scoring-affecting room/roster changes and initialization atomically invalidate it before cleanup. Status-only saves, locks and stage toggles do not. Cleanup blocks competing scoring changes/recalculations until it settles. Query/delete failures skip automatic recalculation and keep draws blocked; resolve leftovers before explicitly recalculating. If a page closes during cleanup, an authorized maintainer must confirm that no cleanup is running, resolve leftovers, and clear `cleanupPending` while keeping `ready:false` before recalculating. Never clear it just to permit a draw.

Recalculation claims a unique dirty revision before reading sources. Changed/malformed rows are replaced, obsolete rows deleted, and unchanged rows retain their timestamps. Chunks of at most 450 row operations transactionally check revision ownership; only a complete owning recalculation marks it ready. Failed or superseded workers cannot certify partial rows. Even unchanged recalculations use two revision writes (claim/finish), but no row writes; refresh is then required. Spins use two application document reads and two atomic writes, with no leaderboard scan or per-ticket reads; contention/security-rule lookups add operations.

The estimates below count leaderboard-row writes only; revision control adds two writes and transaction reads per recalculation.

Refresh brackets one server leaderboard query with revision checks and preserves current exclusions transactionally. An unchanged certified refresh adds no writes. Undo deletes history and restores eligibility/historical tickets in one transaction; refresh reconciles those tickets with current scores, without pinning a historical override. Concurrent stale spins/edits fail rather than overwrite winners.

Integration requires compatible rules first, then Hosting, with all old admin tabs closed/reloaded. Recalculate once to initialize the revision, then refresh entries; no automatic migration or production recalculation runs. Every future leaderboard/source cleanup writer must atomically bump this revision and leave it dirty until recalculated. Old clients or direct backend writes that ignore the protocol are unsupported; pause admin operations during cutover.

### Safe test-participant removal (#39)

Under **Admin → Prediction Settings → Leaderboard Management**, load participants, search by full name or UID, select one or several accounts, and preview removal. Confirm the displayed UIDs and prediction/leaderboard record counts. Duplicate names are not identities. Any Lucky Draw award record or winner exclusion blocks the entire selection; cleanup never deletes awards or exclusions.

Removal deletes selected `leaderboard/<uid>` documents and all `predictions` documents whose `uid` matches, including legacy/duplicate submissions. It preserves Auth accounts, `profiles`, rooms, stage settings, other participants and scoring. Recalculation can adjust remaining sequential ranks without changing their scores. This is not a ban: preserved accounts may submit new predictions after cleanup completes.

`settings/participantCleanup` is an admin-only durable job containing the selected UIDs, operation/revision IDs, phase (`review`, `deleting`, `recalculating`, `complete`), deletion counts and server timestamp. Previewing is read-only. Execution claims a new dirty leaderboard revision with `cleanupPending:true`, then revalidates the preview against server data before deleting anything. Changed previews require another preview/confirmation. Rules freeze selected owners' prediction creates, edits and resets while the job is active; reads and profile edits retain their existing permissions. Other owners remain unaffected.

Every deletion chunk (at most 450 deletes plus its job update) checks job/revision ownership and current winner exclusions transactionally. Award lookups query selected UIDs in groups of at most 30; no per-ticket reads or listeners are added. The existing scorer, profile queries, ranking and changed-row writer perform recalculation under the same pending fence. Only the final transaction marks both the job complete and the revision ready. Refresh Lucky Draw entries afterwards; stale tickets cannot spin.

**Recovery:** after a query, deletion, recalculation or acknowledgement failure, reload the dashboard, select **Load participants → Preview interrupted cleanup**, review remaining counts, and confirm again. The server retains UIDs even after their rows disappear. Retries use a new revision to fence old workers, query only remaining records, and preserve cumulative committed deletion counts. A failed/interrupted job keeps draws and competing scoring operations blocked, including during recalculation. Never manually clear this job or `cleanupPending`; resume through the dashboard. A complete job proves its final recalculation committed even if the browser missed the acknowledgement. No automatic recovery or destructive action runs on sign-in.

**Required #29 integration for Eve — release coordination, not an assumed schema:** this branch has no audience import/base participation source records. Before shipping #29 with cleanup, add every persisted base-award, registration/import and UID-link source that can recreate a leaderboard row to this removal's UID-scoped preview, revalidation, deletion and resumable counts. Delete the selected participant's recreating records, not merely their computed row; preserve unrelated import participants, Auth accounts, public profiles, awards and exclusions. If an import document contains multiple participants, remove only the selected identities transactionally. Extend the active-job owner/source-write fence to registration, linking, import and base-award writers so they cannot recreate sources during recovery. Do not choose collection names here or delete competitor rosters.

Eve must also integrate **every** #29 scoring/source writer with #27: atomically invalidate `settings/leaderboardRevision` (`version` changes, `ready:false`) before changing scoring sources; reject overlap with pending cleanup, and fence chunked writes/recalculation by revision ownership. Only complete owning recalculation may certify `ready:true`; preserve `cleanupPending:true` for this job until its final atomic completion. Extend the existing absolute scorer/recalculator to include approved #29 sources, and extend cleanup emulator tests for mixed selected/unselected imports, retries, concurrent import/link writes and stale draw rejection. Do not deploy #29 and this cleanup together without that integration.

Stored ranks preserve descending correct counts, alphabetical names and stable ordering for identical names. Public ties still share a rank, with UID ordering after name comparison. A rename can legitimately move several stored ranks within a tie. Full-name changes never change prediction selections or UID-based entry ownership. Reopening still clears results and dependent predictions through the existing workflow; recalculation simply reflects the remaining published results.

Illustrative estimates below assume 150 leaderboard rows, 150 connected leaderboard viewers and 150 participating profiles. They are **not production usage or emulator billing measurements**:

| Per recalculation | Before optimisation | After optimisation |
| --- | ---: | ---: |
| Additional profile document reads | 0 | 150 |
| Writes when all rows are unchanged | 150 | 0 |
| Update-driven viewer reads when unchanged | 22,500 | 0 |
| Writes when exactly five persisted rows change | 150 | 5 |
| Update-driven viewer reads for those five changes | 22,500 | 750 |

For `P` prediction documents, `R` rooms, `L` existing leaderboard rows and `F` returned profiles, administrator document reads are approximately `P + R + L + F`, before query minimums and security-rule lookups. An empty profile query still costs at least one read. Up to 150 UIDs require at most five profile query requests, not one request per prediction. Owner profile loading costs one read per signed-in page/session load; each successful save/reset costs one write. Moderation list loads are explicit additional reads.

Initial public leaderboard subscriptions still read all rows: 150 viewers × 150 rows is approximately 22,500 initial reads. Reconnects can repeat that cost, and genuine score/rank changes can still affect many or all rows. Room/prediction listeners and Lucky Draw refreshes also consume reads. These changes reduce redundant broadcasts; they do not guarantee the event stays within the 50,000-read daily allowance.

See [Firestore listener billing](https://firebase.google.com/docs/firestore/pricing#listening_to_query_results) and [free quotas](https://firebase.google.com/docs/firestore/quotas#free-quota). Run the synthetic tests below for measured application-operation counts; those counts are not Firebase production billing.

The live billing plan and remaining quotas cannot be established from repository configuration. For Spark planning, current published limits are:

| Resource | No-cost allowance |
| --- | --- |
| Firestore reads | 50,000/day |
| Firestore writes / deletes | 20,000/day each |
| Firestore stored data | 1 GiB; one free database/project |
| Firestore outbound transfer | 10 GiB/month |
| Hosting storage / transfer | 10 GB stored / 10 GB per month transferred |

Firestore daily quotas reset around midnight Pacific time. Hosting quotas are shared across sites/channels; exhausted Spark quotas can interrupt service or prevent deployment, not automatically provide paid overage. The application has no Cloud Functions or scheduled backend scorer. Do not assume paid monitoring, backups or Functions are available on Spark; billing changes need separate approval. See [Spark/Blaze plans](https://firebase.google.com/docs/projects/billing/firebase-pricing-plans) and [Hosting quotas](https://firebase.google.com/docs/hosting/usage-quotas-pricing).

## Getting started

Install [Git](https://git-scm.com/downloads), a supported [Node.js LTS](https://nodejs.org/) with npm and **Java 21 or later** for the current Firestore emulator. The audit found Node 26.13.0, npm 11.20.0 and Firebase CLI 15.37.0 locally; these are observed versions, not a project-enforced toolchain. Install the CLI separately (there are no application dependencies):

```sh
npm install -g firebase-tools@15.37.0
```

Check `git --version`, `node --version`, `npm --version`, `firebase --version` and `java -version`. The CLI package requires Node 20+, but its Hosting dependency declares Node 20/22/24; prefer supported Node 24 LTS. The audit's Node 26 installation succeeded with an `EBADENGINE` warning, not a clean compatibility result. Java 21+ must be selected through `JAVA_HOME` and `PATH`, not merely installed alongside Java 17. On Windows reopen the terminal after choosing the JDK and verify its selection. First startup may download emulator binaries/UI; browser SDK imports also need internet access.

Clone the repository and open its folder:

```sh
git clone https://github.com/GDGoC-USM/gamefest-tetrio-2026.git
cd gamefest-tetrio-2026
```

### Keep the configured Firebase project

The checked-in browser configuration/default deployment project are **`gamefest-tetrio-2026`**. Keep `.firebaserc`, `firebase.json`, workflows and `public/js/firebase-config.js` unchanged for normal contribution/local preview. Do not run `firebase init`, create a replacement project, add aliases or copy different web configuration into this repository. Changing GitHub ownership does not change the Firebase backend.

There is no `.env` loader, required environment-variable file, root `npm install`, build or application server. The checked-in configuration serves the static site. Demo emulators need no real Firebase project or Firebase login; production login/provider/project setup are separately authorized maintainer tasks.

Firebase web configuration is public browser configuration, not an administrator secret. Never commit account passwords, service-account JSON files, private keys, or deployment tokens. `.env` files are ignored, but this application does not currently load environment variables.

### Grant administrator access

There is no hardcoded administrator password. The following describes **authorized backend provisioning**, not a local-preview prerequisite. Use only synthetic identities in an aligned local emulator namespace; never create a production administrator merely to test setup.

1. Sign in with the intended Google account, or create an Email/Password user in Firebase Authentication.
2. Copy the account's UID from Authentication's user list.
3. Using the Firebase console, create `admins/<UID>` in Firestore with the string field `role` set to `admin`.
4. Open `/admin/index.html` and sign in with that account.

The supplied Firestore rules restrict administrative writes and prevent browser clients from granting themselves admin roles. Hiding the dashboard alone is not a security boundary; deploy the rules to the selected project.

Home, Matches, Predict and Leaderboard share `auth-ui.js`: Home-reference header buttons, signed-in indicators, explicit accessible session restoration and busy/error states. Google popup sign-in and the SDK's existing default persistence are unchanged; same-origin restoration does not imply session sharing across preview/deployed origins or browsers with blocked storage. Sign out before choosing another Google account. Predict clears profile, saved picks, drafts and pending-operation UI on auth changes and guards stale completions by account/epoch. A denied Admin visit keeps the audience session signed in while the dashboard remains hidden and server-enforced permissions remain unchanged; explicitly sign out to switch administrator accounts. Profile failures do not sign users out; Predict offers a retry.

If session restoration fails, the shared control stops announcing a busy restoration and offers **Reload to retry**. The status explicitly says that sign-in could not be verified; it does not claim the account is signed out. Allow browser storage before reloading. Firebase's persistence setting is unchanged, and blocked storage may prevent sign-in or leave only a page-local session; navigation/refresh persistence is not promised in that environment.

For an approved production release, a maintainer must confirm the existing project's providers and authorized deployed domains; this audit did not inspect/change them. Firestore permissions, not hidden navigation or a known email, enforce admin access. See [AGENTS.md](AGENTS.md#firestore-data-and-permissions) for collection schemas/access boundaries.

### Import a participant roster

After initializing the tournament, open **Admin → Rooms → Import roster CSV**. Export an Excel or Google Sheets list as UTF-8 CSV with this exact header and column order:

```csv
room,participantId,username
A,TEST001,ExampleOne
B,TEST002,ExampleTwo
```

Choose the file and select **Preview CSV**. Review all assignments, empty-slot counts, changed groups and dependent-room resets, then select **Save imported roster** and confirm. Previewing does not write to Firestore. No CLI import, service-account credential or project configuration change is needed.

- Only groups A–D are accepted, with at most eight participants per group. All three fields are required. Duplicate participant IDs and usernames are rejected case-insensitively, including collisions with groups omitted from the CSV.
- Each listed group's entire roster is replaced in file order; unused slots become empty. Omitted groups are unchanged. Participant IDs remain text, preserving leading zeros. Quoted CSV fields, UTF-8 BOMs and Windows line endings are supported.
- Matching existing participant IDs retain immutable player keys, even when a username changes. Legacy players without IDs can be matched by username. To move an existing participant between groups or reuse a username with a different ID, clear the old slot in the dashboard first.
- Published groups must be explicitly reopened before their rosters can change. Saving changed rosters resets dependent rooms and deletes their predictions, but retains predictions for the imported groups, just like manual roster edits. Recalculation follows the save.
- If rooms change after preview, preview the CSV again. An identical import has nothing to save.

Keep real participant CSVs outside the repository, or in the ignored `.local/` directory. Test imports using synthetic data and the local emulators, never the live event database.

### Run locally

From the **repository root** (containing `firebase.json`), start the isolated demo CLI environment:

```sh
firebase emulators:start --only auth,firestore,hosting --project demo-gamefest
```

Open the Hosting URL printed by the CLI, normally `http://localhost:5000`. Serve the site over HTTP rather than opening HTML files with `file://`. `firebase.json` configures Authentication on port `9099`, Firestore on `8080`, and Hosting on `5000`.

On exactly `localhost`, `127.0.0.1` or `[::1]`, the client routes Auth/Firestore to `127.0.0.1:9099`/`127.0.0.1:8080`; unavailable emulators do not fall back to production. The emulator UI normally opens at `http://127.0.0.1:4000`. Run all three services, not Hosting alone; the client expects those fixed Auth/Firestore ports.

**Authenticated browser verification:** the generic `demo-gamefest` command does not rewrite the browser's production project ID. For isolated Lucky Draw browser checks, prepare an ignored Hosting copy with a demo-only configuration, then start all three emulators in that same namespace:

```sh
node tests/lucky-draw.browser.mjs --prepare
firebase emulators:exec --config .local/pr51/firebase.json --only auth,firestore,hosting --project demo-pr51 "node tests/lucky-draw.browser.mjs"
```

The browser check requires Playwright installed outside the application; set `PLAYWRIGHT_MODULE` to its absolute package directory if it is not available through Node's normal module resolution. Select Java 21+ first. The preparation copies `public/` into `.local/pr51/public/` and replaces only that ignored copy's `firebase-config.js` with synthetic `demo-pr51` configuration. Re-run preparation after source changes. Tracked Firebase identifiers, permissions and production configuration remain unchanged; checked-in rules are loaded into the demo emulator. Do not serve this copy on a deployed host or use live accounts.

The test signs in through the actual admin page with a synthetic Email/Password account, exercises refresh/spin/history/reload/undo/import and stale-revision rejection, checks presentation bounds at desktop/mobile/short-landscape sizes, and saves screenshots/results under `.local/pr51/`. External application-backend requests are blocked. The default `demo-gamefest` startup is still only an HTTP preview unless its browser configuration is separately aligned. See Firebase's [project-ID alignment requirement](https://firebase.google.com/docs/emulator-suite/connect_firestore#choose_a_firebase_project).

Use only loopback URLs. LAN IPs, custom hostnames and deployed/PR-preview hosts do not enable emulator routing and retain production configuration. Never use them for destructive testing. `Ctrl+C` stops the suite; without explicit import/export, emulator state is disposable. Keep synthetic artifacts in ignored `.local/`, never real participant exports.

### Post-testing cleanup

On isolated test data, use existing controls rather than mass-deleting collections:

1. Stop submitting predictions; close stages/lock affected rooms before cleanup.
2. Reopen published descendants deepest-first: FINAL/THIRD/PLACEMENT, then semi-finals, quarter-finals and groups as applicable. For unpublished Ended rooms use **Save Room → Upcoming**.
3. Use **Reopen / Unpublish Results** for the tested published room. Its roster/own predictions remain; changed downstream feeders reset and their predictions are deleted. Review the actual affected-room confirmation.
4. Check partial-cleanup errors, then **Recalculate leaderboard**. Recalculation repairs totals but does not delete leftover picks. Do not republish before cleanup is resolved: survivors can otherwise score.
5. Undo synthetic Lucky Draw winners separately, then **Refresh Latest Entries**. Reopening preserves history/exclusions but invalidates old pools. Undo restores historical tickets atomically; refresh validates current scores before another spin.

Reopen is not an account/profile/prediction wipe or migration shortcut. Restart disposable emulators without import for a fresh session. Production cleanup, reopening and draw undo require separate explicit authorization.

## Team collaboration: branch → pull request → main

`main` is the shared, reviewed version. **Everyone, including AI contributors, works on a separate branch. Do not commit or push changes directly to `main`.** A pull request (PR) asks the team to review and merge your branch; pushing a branch does not merge it.

### 1. Start a task from the latest main

First run `git status`. If it shows unfinished changes, finish them on their current branch or ask a teammate for help before switching branches.

```sh
git switch main
git pull --ff-only origin main
git switch -c feature/homepage-layout
```

Use a new, descriptive branch for each task, such as `feature/prediction-summary`, `fix/mobile-navigation`, or `docs/setup-guide`. Replace the example branch name with your own.

### 2. Make, check, and commit your changes

Keep each branch focused on one task. Preview the affected pages, check the browser console, and test the behavior you changed using test data.

```sh
git status
git diff
git add public/index.html public/css/style.css
git diff --staged
git commit -m "Improve homepage layout"
```

The filenames and commit message above are examples: stage only the files you intentionally changed. Check that credentials, logs, and unrelated work are not included.

### 3. Push your branch and open a PR

```sh
git push -u origin feature/homepage-layout
```

On [GitHub](https://github.com/GDGoC-USM/gamefest-tetrio-2026), open **Pull requests → New pull request** (or use **Compare & pull request** after pushing):

- Set **base** to `main` and **compare** to your task branch.
- Explain what changed and why.
- List what you tested; include screenshots for visual changes.
- Mention Firebase configuration, rules, or data-impacting changes explicitly.
- Request review from at least one teammate and wait for approval.

For requested changes, edit, commit, and push to the same branch. The PR updates automatically. If Git reports conflicts, ask a teammate for help rather than force-pushing or discarding work.

### 4. Merge after review

A maintainer merges the approved PR on GitHub. Do not merge your own unreviewed PR or bypass review. After it is merged, start the next task from an updated `main`:

```sh
git switch main
git pull --ff-only origin main
git switch -c fix/mobile-navigation
```

### Enforce review on GitHub

These documents describe the workflow; they do not enforce it. A repository administrator should configure a branch ruleset or branch protection for `main` in **Settings**:

- Require a pull request before merging.
- Require at least one approving review.
- Block force pushes and branch deletion.
- Avoid bypass permissions where possible.

Availability depends on the repository's visibility and GitHub plan. Until protection is enabled, the team must follow this workflow manually.

## Verification before a PR

Run commands from the repository root and choose files relevant to your change. There is no `npm test`, build/lint script or checked-in automated test workflow. Existing dependency-free regressions:

```sh
node --test tests/tournament.test.mjs tests/roster-import.test.mjs
node --test tests/auth-ui.test.mjs tests/usernames.test.mjs tests/profile-initialization.test.mjs tests/leaderboard-sync.test.mjs
node --test tests/lucky-wheel-geometry.test.mjs tests/lucky-draw-import.test.mjs
```

These cover tournament/scoring/feeders/statuses, CSV import, names/profile initialization, leaderboard ranking/delta planning, wheel pointer/winner geometry and bulk participant parsing without Firebase access. They do not prove transaction races, browser auth restoration, rendered wheel layout or production usage.

With Java 21+ selected, run isolated rules checks:

```sh
firebase emulators:exec --only firestore --project demo-gamefest "node --test tests/profiles.rules.test.mjs tests/prediction-lock.rules.test.mjs tests/leaderboard-sync.rules.test.mjs"
```

Focused draw/revision checks:

```sh
firebase emulators:exec --only firestore --project demo-gamefest "node --test tests/lucky-draw.rules.test.mjs tests/leaderboard-revision.rules.test.mjs tests/leaderboard-sync.rules.test.mjs tests/profiles.rules.test.mjs"
```

Focused participant-cleanup checks (including authorization, recovery and unchanged scoring):

```sh
firebase emulators:exec --only firestore --project demo-gamefest "node --test tests/participant-cleanup.rules.test.mjs tests/prediction-lock.rules.test.mjs tests/leaderboard-sync.rules.test.mjs"
```

Stop an existing suite first if it occupies port 8080. `emulators:exec` starts Firestore, sets `FIRESTORE_EMULATOR_HOST` for its child and stops it afterwards. Tests reject non-loopback hosts, use unique disposable `demo-*` namespaces, install checked-in rules and clean their fixtures. They check allowed/denied profiles/moderation, exact public leaderboard schemas, private predictions, room locks/stages/readiness/results and absolute leaderboard sync. No Auth emulator login/service-account key is needed. Without `FIRESTORE_EMULATOR_HOST`, rule tests **skip**; a skip is not verification.

For browser changes, serve HTTP, inspect desktop/mobile layout and check console errors. Authenticated flows require aligned isolated Auth/Firestore namespaces/rules; the current demo/browser mismatch above is a blocker, not a passing flow:

- Public pages: navigation, loading/error states, room/results views and responsive layout.
- Profiles/auth: synthetic sign-in, valid Google defaults/custom-name preservation, save/refresh, invalid-name rejection, sign-out/account switching and restoration; no prior-user state may leak.
- Predictions: two distinct group qualifiers or one series winner; stage/room/status locking, save/edit/reset denial and pending/resolved results.
- Administration: unauthorized access, publish/direct correction/reopen, targeted feeder resets, partial-cleanup errors, recalculation and full-name moderation.
- Lucky Draw: refresh after recalculation, inspect weights, zero-entry exclusion, winner reveal, persistence/undo. Do not claim freshness/concurrency/pointer accuracy before open issues are fixed and tested.
- Security: check allowed/denied requests through rule tests, not merely hidden UI.

Documentation-only changes need path/link/configuration and command checks, not live backend access. Report exact results, versions and blockers in the PR; installation/startup does not prove all flows. Perform post-test cleanup only on isolated data.

### Setup verification record

Audit verification on 2026-11-26, without production-data access:

| Check | Observed result |
| --- | --- |
| Clone from the GDGoC-USM repository into an isolated folder | Succeeded |
| `npm install -g --prefix .local/firebase-cli firebase-tools@15.37.0` | Succeeded; Node 26 `EBADENGINE`, deprecation and install-script-policy warnings |
| Two Node commands above | 21 and 29 tests passed; no failures/skips |
| Firestore `emulators:exec` command above | Initially blocked by selected Java 17; passed all 29 tests after selecting installed Java 25.0.4.1 |
| Auth/Firestore/Hosting startup from the clean clone's root | All three ready at configured ports; UI at 4000 |
| Browser Home, Matches, Predict, Leaderboard and Admin | All HTTP 200; no captured JavaScript/console errors during signed-out navigation |
| Markdown local links/anchors and referenced paths | Checked against this checkout |

The isolated CLI was invoked through its installed Node entry point rather than changing the machine's global installation. Browser network inspection confirmed loopback Firestore requests still name `gamefest-tetrio-2026`; no real sign-in, privileged browser flow, production provider/rule state, wheel outcome or deployment was verified. The namespace mismatch remains a documented implementation blocker. Installation warnings and successful tests do not certify Node 26 support; use the supported LTS recommendation above.


## Deployment

Deployment is a maintainer action after review and explicit authorization; these commands are a runbook, **not local verification**. Keep the configured project/targets unchanged. This audit did not execute production deployment or verify remote rules/provider/billing state.

For releases depending on changed rules, pause admin result changes, recalculations and draws. Deploy/confirm compatible **rules first**, then release Hosting:

```sh
firebase deploy --only firestore:rules --project gamefest-tetrio-2026
firebase deploy --only hosting --project gamefest-tetrio-2026
```

Hosting workflows do **not** deploy rules or run tests: a push/merge to `main` deploys live Hosting; a same-repository PR creates a Hosting preview. Coordinate required rules **before** the Hosting-only cutover; listing both products in one deploy command is not an ordered release procedure. Do not manually duplicate a successful automatic Hosting release unless a maintainer chooses that path.

For full-name/privacy releases, rules-first permits Unicode profiles and strict public leaderboard rows before the editor runs. Previews still use production backend configuration/current deployed rules, not a test database; new preview code may be incompatible with unreleased rules. Close/reload public/admin tabs before resuming. If Hosting fails, prefer a privacy-preserving forward fix rather than weakening validation.

After Hosting deploys, require administrators to reload the dashboard. Verify access with approved accounts before resuming operations. A maintainer must separately authorise any production recalculation that replaces stale public names/fields; deployment alone does not clean existing Firestore documents. Do not inspect or repair production data merely to verify this release.

Rollback: revert application commits in reverse order, but review the privacy impact before restoring older code or rules. Old recalculation code can republish prediction identities. Keep private profiles private; do not delete profiles, predictions or draw history as a rollback shortcut. Prefer a privacy-preserving forward fix over restoring the original leak.

No deployment/production-data operation belongs to local verification. Branch pushes and PR creation are separately authorized collaboration actions; opening a PR can trigger the existing preview workflow even for documentation changes. Do not merge, push to main or execute production deployment commands without required review/authorization.

## AI contributors

Read [AGENTS.md](AGENTS.md) before running commands or editing this repository. Keep documentation current when setup, behavior, or the collaboration workflow changes.
