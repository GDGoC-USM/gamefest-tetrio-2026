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
- Firebase setup and shared helpers live in `public/js/shared.js`; browser project configuration lives in `public/js/firebase-config.js`.
- Firebase SDK imports currently use Google's CDN at version 11.10.0. Keep imports consistent.
- `firebase.json` serves `public/` and points Firestore rules at `public/firestore.rules`.
- There is no package manifest, build step, automated test suite, or checked-in CI workflow. Do not invent commands such as `npm test` or `npm run build`.
- Reuse the existing page scripts, helpers, naming, and styling patterns. Keep changes focused; do not introduce a framework, dependency, or broad refactor without a task requirement.
- Escape untrusted values when rendering HTML; reuse `escapeHTML` from `shared.js` where appropriate.

## Firebase and data safety

- Treat the configured Firebase backend as live unless you have verified otherwise. Hosting on localhost does not make database actions local.
- The current client has no Authentication or Firestore emulator connections. `firebase emulators:start --only hosting` still leaves those services connected to the configured project.
- Do not change the Firebase project, authentication providers, authorized domains, rules deployment, or deployment automation unless the user requests it.
- Do not deploy, alter remote data, publish/reopen tournament results, generate live brackets, or run/undo live draws without explicit authorization. Use a dedicated test project for checks that write data.
- Never commit passwords, service-account files, private keys, tokens, or real participant data. Public Firebase web configuration is not a privileged credential.
- Administrator authorization depends on Firebase Authentication plus `admins/<UID>` with `role: "admin"`. Preserve server-enforced Firestore permissions; do not replace them with a client-only check or a hardcoded password.
- A `.gitignore` rule does not remove a secret already committed to Git. If you discover one, report it without repeating its value; do not rewrite history or rotate credentials on your own.

## Behavior to preserve

Unless the task explicitly changes these rules:

- Rooms `A`–`D` contain eight players each; `SF1`, `SF2`, and `FINAL` contain four each.
- Preliminary and semi-final predictions select two distinct players. Final predictions select three distinct, ordered podium places.
- Prediction availability is controlled by stage and room/result state. Keep client behavior and Firestore validation aligned.
- Scoring uses published results and awards 10 points per correct pick. Lucky Draw tickets correspond to correct picks.
- Reopening a room preserves its own predictions but resets dependent rooms and deletes their predictions. Do not simplify away this dependency behavior.
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
