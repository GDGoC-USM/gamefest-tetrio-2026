# GameFest TETR.IO Showdown

A tournament management and audience prediction website for GameFest. Visitors follow rooms and results, sign in with Google, predict group qualifiers and head-to-head winners, and earn leaderboard points. Administrators manage the bracket, publish results, and run a weighted Lucky Draw.

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
├── README_FIRST.txt          Original setup and detailed tournament operations
├── .gitignore                Local cache, logs, dependencies, and environment files
├── .firebaserc               Default Firebase deployment project
├── firebase.json             Hosting directory and Firestore rules path
└── public/
    ├── index.html            Homepage and room overview
    ├── matches.html          Tournament rooms and published results
    ├── predict.html          Audience prediction interface
    ├── leaderboard.html      Public rankings
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
        ├── home.js             Homepage data and sign-in controls
        ├── matches.js          Public room and result display
        ├── predict.js          Prediction selection, saving, and room updates
        ├── usernames.js        Full-name validation and privacy-safe profile defaults
        ├── leaderboard.js      Public leaderboard display
        ├── leaderboard-sync.js Pure ranking and changed-row planning
        ├── admin.js            Room management, bracket generation, and scoring
        └── luckydraw.js        Ticket selection and winner history
```

Page scripts share Firebase access through `shared.js`. The main Firestore collections are `rooms`, `settings`, `profiles`, `predictions`, `leaderboard`, `admins`, and `ticketAwards`. Rules accept new room-based predictions only; legacy records remain readable and are rescored where applicable.

## Tournament behavior

- Groups `A`, `B`, `C`, and `D` each have eight slots and play five rounds of cumulative free-for-all (FFA). Organisers manually publish two qualifiers in first/second order; roster order never determines seeds.
- Eight qualifiers enter four head-to-head quarter-finals (`QF1`–`QF4`, first to 7). Semi-finals (`SF1`, `SF2`) and the third-place match (`THIRD`) are first to 9; `FINAL` is first to 11.
- Semi-final winners enter `FINAL`; semi-final losers enter `THIRD`. The four quarter-final losers enter `PLACEMENT`: five FFA rounds, awarding 4/3/2/1 points per round. Total points determine fifth through eighth; tied totals leave placings pending until an organiser records an explicit decision.
- Predictions select two group qualifiers (unordered for scoring) or one winner per head-to-head series. There are no predictions for FFA placement positions. Each correct selected player earns exactly **one point and one Lucky Draw entry**. Unresolved results remain pending, not incorrect.
- Administrators control prediction availability by stage and can lock individual rooms under **Admin → Rooms**. A room accepts predictions only when its stage is open, its room lock is off, its players are ready, and its results are unpublished and status is not Ended. Locking or ending preserves saved picks and blocks new picks, edits and user resets; unlocking never overrides the other restrictions. Leaderboard recalculation replaces absolute totals from current published results; resaving an unchanged result never adds points again. Legacy semi-final/final picks receive no old bonuses or podium scoring.
- Lucky Draw excludes winners from subsequent draws until their award is undone.

Reopening results clears the room's results, retains its players and own predictions, and transitively resets dependent rooms and deletes their predictions. A room with published downstream results cannot be published, corrected, reopened or re-rostered; the dashboard names the downstream rooms to reopen first, deepest round first. Resets are targeted: only feeder rooms whose confirmed players change are cleared, so a correction that keeps the same winner preserves downstream results and audience predictions. Room updates, the dependency check and the stale-state check commit in one Firestore transaction; dependent predictions are then deleted in batches. Corrected confirmed results feed the bracket again. See [README_FIRST.txt](README_FIRST.txt) for exact feeds, operating steps, and outstanding organiser confirmations.

Room locks use `rooms/<id>.predictionsLocked`. Only `true` locks a room; a missing field means unlocked for backward compatibility. New rooms start unlocked. Stage toggles, roster changes, publishing/reopening results and format migration retain explicit locks, including locks on dependent rooms. Changing a lock alone never changes match status, results, bracket dependencies or saved predictions. `PLACEMENT` has no predictions or lock control.

Administrators can save **Upcoming**, **Live** or **Ended** under the room editor. Ended reuses the existing stored `status: "completed"`; it does not publish results, assign rankings, advance feeders or score picks. Ended rooms with unpublished results remain editable for official result entry and display results pending. Only **Publish Results** confirms results and feeds the bracket. Published rooms must still use **Reopen / Unpublish Results** before corrections; reopening returns them to Upcoming and preserves explicit prediction locks.

Player references remain stable legacy string keys in `rooms/<id>.players`. Separate `playerDetails[key]` fields hold a text participant ID (preserving leading zeroes) and a trimmed username. Organisers enter the roster in the admin dashboard; never commit a real roster. Initialising/migrating the tournament requires explicit destructive confirmation in the admin dashboard; it never runs automatically on page load.

## Full names and privacy

On the prediction page, signed-in viewers can save their public **Full Name** independently of predictions, including while predictions are locked or ended. Names contain 3–80 Unicode code points: letters, combining marks, numbers, ordinary spaces and the punctuation `. , ' ’ · ( ) _ -`, with at least one letter or number. Ordinary edge spaces are trimmed. Emails, HTML, control characters, line breaks and invisible formatting characters are rejected. Duplicate names are allowed; Firebase UID remains the permanent identity. Competitor TETR.IO usernames and participant IDs are unchanged.

For a missing profile, the prediction page saves a valid Google account display name once; it never derives a public name from an email or its local part. If Google provides no valid name, viewers see a temporary `Participant` label and a prompt to enter their full name. Existing valid custom profiles are never overwritten on sign-in. An old `Participant` profile without `updatedAt` can be repaired on its owner's next login; timestamped `Participant` profiles require explicit owner editing because they may be moderator resets or deliberate choices.

`profiles/<uid>` still stores exactly `username` and `updatedAt` (a server timestamp); `username` is retained as an internal compatibility field, not an audience-facing label. Owners can retrieve and save their own profile, but cannot list profiles or read another person's profile. Authorised administrators can retrieve individual profiles and list profiles. They can reset another account's name only to `Participant`, not assign an arbitrary replacement. Clients cannot delete profiles or grant administrative roles.

The prediction page reads the profile once per sign-in/session load, not through a real-time listener. Initialization uses a Firestore transaction, so a concurrent custom-name save or moderator reset is preserved rather than overwritten by a stale Google default. A normal load reads one profile and adds at most one initialization write; contention can require transaction retries. Existing valid profiles add no writes. Profile state clears on sign-out or account switching. Names become public at the next successful administrator leaderboard recalculation, not immediately. Changing a name never changes authentication identity, predictions, scores, Lucky Draw ownership or previous-winner exclusions.

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

Use **Admin → Prediction Settings → Recalculate leaderboard** to intentionally refresh names or repair stale data. Signing into the dashboard no longer recalculates. Publishing, correcting or reopening results, roster changes and format initialisation retain their automatic recalculation. Stage toggles, room locks and status-only saves do not recalculate. Resubmitting an unchanged published result still performs an intentional repair/recalculation without resetting predictions.

Each recalculation reads predictions, rooms and the existing leaderboard once. Reopening, correcting or re-rostering a room reads the fresh rooms inside one transaction, then reads only the reset rooms' predictions and deletes them in batches of at most 450. If a delete batch fails after the room state committed, the dashboard still recalculates the leaderboard, reports how many predictions remain, and leaves them pending: they score nothing while their rooms are unpublished and are removed the next time those rooms are reset. It scores/deduplicates predictions, queries profiles only for distinct participating UIDs in document-ID groups of at most 30, and reuses one in-memory username map. It does not read a profile per prediction or attach any profile listener.

The existing leaderboard snapshot is compared against the exact public schema and all persisted ranking values. New, changed, malformed or extra-field rows are fully replaced; obsolete participants are deleted. An unchanged row retains its `updatedAt`. An unchanged recalculation commits no batches. Write/delete batches remain capped at 450 operations; failures surface through the existing dashboard error path. If some batches committed before a later failure, explicitly recalculate again: totals remain absolute and repeatable.

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

## Getting started

Install [Git](https://git-scm.com/downloads), [Node.js LTS](https://nodejs.org/), **Java 21** (required by the current Firestore emulator), and the [Firebase CLI](https://firebase.google.com/docs/cli):

```sh
npm install -g firebase-tools
```

Clone the repository and open its folder:

```sh
git clone https://github.com/JavanMyna/gamefest-tetrio-2026.git
cd gamefest-tetrio-2026
```

### Choose the Firebase project first

The checked-in client configuration and default deployment target currently point to **`gamefest-tetrio-2026`**. Connecting GitHub to a different Firebase project does **not** change the browser's Firebase configuration.

Before using a replacement project:

1. Create a Firebase project and register a Web App in the Firebase console.
2. Copy its web configuration into `public/js/firebase-config.js`.
3. Update the `projects.default` value in `.firebaserc` to the new project ID.
4. Create a Firestore database and deploy `public/firestore.rules` before accepting user data.
5. Enable Google sign-in in Authentication. Enable Email/Password too if administrators will use the password form.
6. Add the deployed domain and, for local sign-in, `localhost` to Authentication's authorized domains.
7. Create administrator access as described below.

Firebase web configuration is public browser configuration, not an administrator secret. Never commit account passwords, service-account JSON files, private keys, or deployment tokens. `.env` files are ignored, but this application does not currently load environment variables.

### Grant administrator access

There is no hardcoded administrator password.

1. Sign in with the intended Google account, or create an Email/Password user in Firebase Authentication.
2. Copy the account's UID from Authentication's user list.
3. Using the Firebase console, create `admins/<UID>` in Firestore with the string field `role` set to `admin`.
4. Open `/admin/index.html` and sign in with that account.

The supplied Firestore rules restrict administrative writes and prevent browser clients from granting themselves admin roles. Hiding the dashboard alone is not a security boundary; deploy the rules to the selected project.

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

Use the isolated demo project; no live backend access is needed:

```sh
firebase emulators:start --only auth,firestore,hosting --project demo-gamefest
```

Open the Hosting URL printed by the CLI, normally `http://localhost:5000`. Serve the site over HTTP rather than opening HTML files with `file://`. `firebase.json` configures Authentication on port `9099`, Firestore on `8080`, and Hosting on `5000`.

On localhost, the client automatically connects Authentication to `127.0.0.1:9099` and Firestore to `127.0.0.1:8080`. It never falls back to production if an emulator is unavailable. Create synthetic local accounts and `admins/<UID>` documents with `role: "admin"` through the emulator UI at the URL printed by the CLI. Emulator accounts and documents are separate from production.

Explicit production hosts retain the configured production Firebase connection. Do not use a deployed host for destructive testing. Starting Hosting alone is insufficient: run all three emulators above.

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

On [GitHub](https://github.com/JavanMyna/gamefest-tetrio-2026), open **Pull requests → New pull request** (or use **Compare & pull request** after pushing):

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

Run `node --test tests/tournament.test.mjs tests/roster-import.test.mjs` for isolated tournament, scoring, validation, dependency and CSV import regression scenarios. These checks do not contact Firebase. Then test the affected flow in a browser and report exactly what you checked:

- Public page changes: navigation, desktop/mobile layout, loading states, and console errors.
- Authentication/predictions: signed-out and signed-in behavior, saving/resetting picks, and closed stages.
- Tournament administration: publishing/reopening results, dependent room generation, and leaderboard scoring.
- Lucky Draw: ticket eligibility, winner exclusion, persistence, and undo.
- Security rules: use the isolated Auth/Firestore emulators to check authorized and unauthorized access; a UI check does not prove rule enforcement.

Run only the checks relevant to your change. Do not modify live event data to verify a PR.

Room-lock authorization regressions run against a loopback Firestore emulator with synthetic identities and a unique disposable `demo-room-lock-*` project:

```sh
firebase emulators:exec --only firestore --project demo-gamefest "node --test tests/prediction-lock.rules.test.mjs"
```

Java 21 is required. The test skips without `FIRESTORE_EMULATOR_HOST`, rejects non-loopback emulator hosts, loads the checked-in rules and cleans up its own fixture documents. It covers room-lock create/update/delete denial, legacy resets, administrator-only lock changes, independent rooms, stage/result/readiness restrictions and head-to-head predictions. Inspect live updates and controls in the browser separately.

Full-name validation and privacy regressions (test filenames retain the internal username naming):

```sh
node --test tests/usernames.test.mjs tests/profile-initialization.test.mjs tests/tournament.test.mjs tests/leaderboard-sync.test.mjs
firebase emulators:exec --only firestore --project demo-gamefest "node --test tests/profiles.rules.test.mjs tests/prediction-lock.rules.test.mjs tests/leaderboard-sync.rules.test.mjs"
```

The full-name unit and rule tests share the same validation cases. Rule tests use unique disposable demo projects, reject non-loopback hosts, and cover owner/admin access, forbidden listing, moderation, field allowlists, public leaderboard reads and private predictions. Without `FIRESTORE_EMULATOR_HOST`, rule tests explicitly skip; a skip or static inspection does not prove runtime enforcement. If Java 21 or later is unavailable, run the unit command and report the emulator tests as unexecuted.

Browser checklist on the local Auth/Firestore/Hosting emulators:

- Desktop and mobile: sign in with a synthetic Google account, save a valid name, refresh and verify persistence; confirm Google identity is unchanged.
- Try too-short/long names, email, HTML, punctuation-only, controls and line breaks; verify rejection. Check Unicode names, apostrophes and other supported punctuation save correctly.
- Save a name with predictions locked; confirm the saved predictions and scores remain unchanged.
- Sign out and switch accounts during loading/saving; confirm no previous profile state remains.
- As administrator, load names, cancel a reset, then confirm a reset; verify it appears only after recalculation.
- With synthetic stale leaderboard names/fields, recalculate and inspect the local documents for the exact public schema.
- Verify unauthorized profile/leaderboard requests in rule tests, not just hidden UI controls.


## Deployment

Deployment is a maintainer action after review and explicit authorisation. Do not change the configured Firebase project or deployment targets.

For this release, pause administrator result changes, recalculations and draw refreshes during the cutover. Deploy the **rules first**, then Hosting:

```sh
firebase deploy --only firestore:rules --project gamefest-tetrio-2026
firebase deploy --only hosting --project gamefest-tetrio-2026
```

Rules-first allows Unicode full-name profiles and their public leaderboard rows before the new editor runs. Prediction writes retain their schema, and the existing rules already block `completed` rooms. Old clients may not render new Unicode names correctly; close/reload public and admin tabs before resuming operations. If Hosting deployment fails, finish the forward deployment rather than weakening privacy validation.

After Hosting deploys, require administrators to reload the dashboard. Verify access with approved accounts before resuming operations. A maintainer must separately authorise any production recalculation that replaces stale public names/fields; deployment alone does not clean existing Firestore documents. Do not inspect or repair production data merely to verify this release.

Rollback: revert application commits in reverse order, but review the privacy impact before restoring older code or rules. Old recalculation code can republish prediction identities. Keep private profiles private; do not delete profiles, predictions or draw history as a rollback shortcut. Prefer a privacy-preserving forward fix over restoring the original leak.

Pushes to `main` trigger a live Hosting deployment; pull requests trigger a preview. No branch push, PR, deployment or production-data operation is part of local verification.

## AI contributors

Read [AGENTS.md](AGENTS.md) before running commands or editing this repository. Keep documentation current when setup, behavior, or the collaboration workflow changes.
