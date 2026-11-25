# GameFest TETR.IO Showdown

A tournament management and audience prediction website for GameFest. Visitors follow rooms and results, sign in with Google, predict group qualifiers and head-to-head winners, and earn leaderboard points. Administrators manage the bracket, publish results, and run a weighted Lucky Draw.

## Technology

- Plain HTML, CSS, and browser JavaScript modules; no frontend framework or build step.
- Firebase Authentication for Google sign-in and administrator email/password sign-in.
- Cloud Firestore for tournament data, predictions, rankings, and draw history.
- Firebase Hosting for serving the `public/` directory.
- Firebase JavaScript SDK 11.10.0, imported directly from Google's CDN.

There is no `package.json`, build step, or GitHub Actions deployment workflow. The pure tournament regression scenarios use Node's built-in test runner; no dependencies are needed to run them.

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
        ├── leaderboard.js      Public leaderboard display
        ├── admin.js            Room management, bracket generation, and scoring
        └── luckydraw.js        Ticket selection and winner history
```

Page scripts share Firebase access through `shared.js`. The main Firestore collections are `rooms`, `settings`, `predictions`, `leaderboard`, `admins`, and `ticketAwards`. Rules accept new room-based predictions only; legacy records remain readable and are rescored where applicable.

## Tournament behavior

- Groups `A`, `B`, `C`, and `D` each have eight slots and play five rounds of cumulative free-for-all (FFA). Organisers manually publish two qualifiers in first/second order; roster order never determines seeds.
- Eight qualifiers enter four head-to-head quarter-finals (`QF1`–`QF4`, first to 7). Semi-finals (`SF1`, `SF2`) and the third-place match (`THIRD`) are first to 9; `FINAL` is first to 11.
- Semi-final winners enter `FINAL`; semi-final losers enter `THIRD`. The four quarter-final losers enter `PLACEMENT`: five FFA rounds, awarding 4/3/2/1 points per round. Total points determine fifth through eighth; tied totals leave placings pending until an organiser records an explicit decision.
- Predictions select two group qualifiers (unordered for scoring) or one winner per head-to-head series. There are no predictions for FFA placement positions. Each correct selected player earns exactly **one point and one Lucky Draw ticket**. Unresolved results remain pending, not incorrect.
- Administrators control prediction availability by stage. Leaderboard recalculation replaces absolute totals from current published results; resaving an unchanged result never adds points again. Legacy semi-final/final picks receive no old bonuses or podium scoring.
- Lucky Draw excludes winners from subsequent draws until their award is undone.

Reopening results clears the room's results, retains its players and own predictions, and transitively resets dependent rooms and deletes their predictions. Corrected confirmed results feed the bracket again. See [README_FIRST.txt](README_FIRST.txt) for exact feeds, operating steps, and outstanding organiser confirmations.

Player references remain stable legacy string keys in `rooms/<id>.players`. Separate `playerDetails[key]` fields hold a text participant ID (preserving leading zeroes) and a trimmed username. Organisers enter the roster in the admin dashboard; never commit a real roster. Initialising/migrating the tournament requires explicit destructive confirmation in the admin dashboard; it never runs automatically on page load.

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

## Deployment

Deployment is a maintainer action after review. Confirm `.firebaserc` and `public/js/firebase-config.js` refer to the intended project, then run:

```sh
firebase deploy --only hosting,firestore:rules
```

Pushing to GitHub does not deploy the site with the current repository configuration. Any future GitHub/Firebase deployment integration must be configured separately, with credentials stored in the platform's secret store rather than committed files.

## AI contributors

Read [AGENTS.md](AGENTS.md) before running commands or editing this repository. Keep documentation current when setup, behavior, or the collaboration workflow changes.
