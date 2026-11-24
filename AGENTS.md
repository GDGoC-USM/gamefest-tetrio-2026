# AI contributor instructions

These instructions apply to the entire repository. Read this file before running commands or making changes. Read any more-specific `AGENTS.md` in the directories you will change as well. Follow the instructions supported by your AI tool; this file is guidance, not an access-control mechanism.

## Before acting

1. Read `README.md` for project structure, setup, verification, and the team's collaboration workflow. Consult `README_FIRST.txt` when changing tournament operations.
2. Understand the user's requested outcome and inspect the affected files before proposing or making edits. Do not assume this is a framework application.
3. Check the current branch and working-tree state. Preserve existing user and teammate changes. Do not reset, discard, stash, overwrite, or stage unrelated work.
4. Use a task branch before editing. Never commit or push directly to `main`.
   - For a new task with a clean working tree on `main`, update it with `git pull --ff-only origin main`, then create a descriptive branch such as `docs/setup-guide`, `fix/prediction-save`, or `feature/room-summary`.
   - If already on the task's branch, keep using it. Do not switch away from an active teammate's work or move dirty changes between branches without agreement.
   - If the correct branch or ownership is unclear, resolve that before editing.

## Repository conventions

- This is a static, multi-page application: HTML in `public/`, CSS in `public/css/`, and browser ES modules in `public/js/`.
- Firebase setup and shared helpers live in `public/js/shared.js`; browser project configuration lives in `public/js/firebase-config.js`. Pure tournament format, feeder, validation, and scoring helpers live in `public/js/tournament.js`; reuse them across public and admin pages.
- Firebase SDK imports currently use Google's CDN at version 11.10.0. Keep imports consistent.
- `firebase.json` serves `public/`, points Firestore rules at `public/firestore.rules`, and configures Auth `9099`, Firestore `8080`, and Hosting `5000` emulator ports.
- There is no package manifest, build step, or checked-in CI workflow. Run pure tournament regression scenarios with `node --test tests/tournament.test.mjs`. Do not invent commands such as `npm test` or `npm run build`.
- Reuse the existing page scripts, helpers, naming, and styling patterns. Keep changes focused; do not introduce a framework, dependency, or broad refactor without a task requirement.
- Escape untrusted values when rendering HTML; reuse `escapeHTML` from `shared.js` where appropriate.

## Firebase and data safety

- Localhost automatically connects Authentication to `localhost:9099` and Firestore to `localhost:8080`, with no production fallback. Explicit production hosts keep the configured production backend.
- Use Java 21 and `firebase emulators:start --only auth,firestore,hosting --project demo-gamefest` for isolated checks. Hosting alone is insufficient. Use synthetic accounts and data; never contact the live backend to test.
- Do not change the production Firebase project, authentication providers, authorized domains, rules deployment, or deployment automation unless the user requests it.
- Do not deploy, alter remote data, publish/reopen live results, generate live brackets, or run/undo live draws without explicit authorization.
- Never commit passwords, service-account files, private keys, tokens, or real participant data. Public Firebase web configuration is not a privileged credential.
- Administrator authorization depends on Firebase Authentication plus `admins/<UID>` with `role: "admin"`. Preserve server-enforced Firestore permissions; do not replace them with a client-only check or a hardcoded password.
- A `.gitignore` rule does not remove a secret already committed to Git. If you discover one, report it without repeating its value; do not rewrite history or rotate credentials on your own.

## Behavior to preserve

Unless the task explicitly changes these rules:

- Groups `A`–`D` have eight slots and five cumulative FFA rounds. Organisers manually publish two ordered qualifiers; roster order is not seed order.
- `QF1`: A1/B2; `QF2`: C1/D2; `QF3`: B1/A2; `QF4`: D1/C2. Quarter-finals are FT7; `SF1` (QF1/QF2 winners), `SF2` (QF3/QF4 winners), and `THIRD` (SF losers) are FT9. `FINAL` (SF winners) is FT11.
- `PLACEMENT` contains four QF losers, with five FFA rounds awarding 4/3/2/1. Tied totals leave placings pending until an explicit organiser decision.
- Predictions select two distinct group qualifiers or one head-to-head winner; there are no FFA placement predictions. Availability depends on stage and room/result state. Keep client behavior and Firestore validation aligned.
- Published results award exactly one point and one Lucky Draw ticket per correct selected player; unresolved picks stay pending. Recalculate absolute totals; resaving unchanged results is idempotent. Remove legacy bonuses and podium scoring.
- Reopening a room retains its own players and predictions, clears results, transitively resets dependent rooms, and deletes dependent predictions. Preserve each feeder's confirmed source independently.
- Keep legacy string player keys stable. Store participant IDs as separate text metadata (preserve leading zeroes) and usernames trimmed; organisers enter the roster in admin, never in tracked files.
- Initialisation/migration requires an explicit destructive admin confirmation; never initialise automatically on load.
- Lucky Draw excludes past winners from further draws; undo restores eligibility.

## Verify changes

- Run the narrowest available check that exercises the changed behavior. Do not claim a check passed unless you ran it.
- For interface changes, serve the site over HTTP and inspect the actual affected page, including relevant mobile layout and browser console errors.
- For authentication, predictions, scoring, or draw changes, verify the affected flow with isolated test accounts/data and check failure or unauthorized paths where relevant.
- For rule changes, verify allowed and denied requests in a safe test environment. Do not weaken rules just to make a manual test pass.
- For documentation-only changes, verify referenced local paths, links, commands, and configuration claims. Do not contact or mutate the live backend just to check documentation.
- If tooling, permissions, or a safe test backend is unavailable, state the limitation and distinguish verified behavior from assumptions.
- Update relevant documentation when behavior, setup, or the workflow changes.

## Commits and pull requests

- Commit only the task's intended changes, with a descriptive message. Never include unrelated staged or unstaged work.
- Do not force-push, rewrite shared history, or bypass branch protection.
- Do not push a branch or open a PR unless the user requests or authorizes that remote action.
- When authorized to open a PR, target `main`, explain the change, list checks and limitations, add screenshots for visual changes, and flag configuration/rules/data impacts.
- Request review from at least one human teammate. Wait for approval; do not merge automatically or merge an unreviewed PR. A maintainer handles the merge.
- If no PR was opened, finish by reporting the branch, changed files, checks performed, and that the branch still needs pushing and a PR.

The full beginner-friendly Git workflow is in `README.md`. GitHub branch protection or rulesets must be configured separately by a repository administrator; writing these instructions does not protect `main` by itself.
