GAMEFEST // TETR.IO ARENA — START HERE

PROJECT OVERVIEW
This project is a TETR.IO tournament management and audience prediction website.
It includes public tournament pages, Google sign-in, an administrator dashboard,
predictions, a points leaderboard and an administrator-operated Lucky Draw.

PROJECT STRUCTURE
public/
  index.html             Audience home page
  matches.html           Tournament rooms and published results
  predict.html           Submit and manage predictions
  leaderboard.html       Public participant rankings
  admin/index.html       Administrator dashboard
  css/style.css          Public website styles
  css/admin.css          Administrator dashboard styles
  css/luckydraw.css      Lucky Draw styles
  js/firebase-config.js  Firebase web configuration
  js/shared.js           Shared Firebase and helper functions
  js/tournament.js       Shared pure format, feeders, validation and scoring
  js/home.js             Homepage behaviour
  js/matches.js          Public match display
  js/predict.js          Prediction behaviour
  js/leaderboard.js      Public leaderboard display
  js/admin.js            Administrator and tournament management
  js/luckydraw.js        Lucky Draw behaviour
  firestore.rules        Firestore security rules

A. CREATE YOUR FIREBASE PROJECT
1. Open https://console.firebase.google.com/ and create a Firebase project.
2. Add a Web App and copy its Firebase configuration.
3. Paste the configuration into public/js/firebase-config.js.
4. In Authentication, enable Google sign-in.
5. Create a Firestore database.
6. Publish the rules from public/firestore.rules.
7. Add your deployed domain to Authentication > Settings > Authorized domains.

B. AUTHORISE AN ADMINISTRATOR
1. Sign in once through the public website using the intended administrator Google account.
2. In Firebase Authentication > Users, copy that account's UID.
3. In Firestore, create a document in the admins collection.
4. Use the UID as the document ID and add: role (string) = admin.
5. Only accounts whose UID has an admins document with role = admin can use the dashboard.
6. Do not allow ordinary users to create or edit documents in the admins collection.

C. RUN LOCALLY
1. Install Node.js LTS, the Firebase CLI and Java 21 (required by the current Firestore emulator).
2. Open a terminal in the project folder; keep the checked-in Firebase configuration.
3. Run: firebase emulators:start --only auth,firestore,hosting --project demo-gamefest
4. Open the Hosting URL printed by the CLI, normally http://localhost:5000.
5. firebase.json configures Auth on 9099, Firestore on 8080 and Hosting on 5000.
6. Localhost automatically uses Auth 127.0.0.1:9099 and Firestore 127.0.0.1:8080.
   It never falls back to production if an emulator is unavailable.
7. Create synthetic users and admins/<UID> documents with role = admin through
   the emulator UI at the URL printed by the CLI.
   Local users/documents are separate from production. Hosting alone is insufficient.
8. Explicit production hosts keep their configured production backend unchanged.
   Never test destructive operations against live data or open pages via file://.

D. DEPLOY
From the project root, run:
  firebase deploy --only hosting,firestore:rules

E. TOURNAMENT FORMAT
- Groups A, B, C and D each have eight slots and play five cumulative FFA rounds.
- Organisers manually select and publish each group's first and second qualifier.
  The order of the roster does not set seeds; A1 means A's published first qualifier.
- QF1: A1 vs B2. QF2: C1 vs D2. QF3: B1 vs A2. QF4: D1 vs C2.
- Each quarter-final is head-to-head, first to 7 (FT7).
- SF1: QF1 winner vs QF2 winner. SF2: QF3 winner vs QF4 winner; both FT9.
- FINAL: SF1 winner vs SF2 winner, FT11.
- THIRD: SF1 loser vs SF2 loser, FT9, determining third and fourth.
- PLACEMENT: QF1, QF2, QF3 and QF4 losers play five FFA rounds.
  Enter all four finishers in order each round; award 4/3/2/1 points.
  Sum all five rounds to rank fifth through eighth. Tied totals leave placings
  pending until the organiser records an explicit complete ranking consistent
  with unequal totals. Do not silently break ties by roster order.
- A series result requires integer scores: exactly one player reaches the FT target,
  and the other stays below it. Unresolved feeder slots remain unpickable.

F. AUDIENCE FEATURES
- Visitors can view rooms, bracket connections, pending feeders and published results.
- Users sign in with Google to submit predictions while their stage is open.
- Group predictions select two distinct qualifiers; scoring ignores their order.
- Every head-to-head series, including THIRD, accepts one winner prediction.
- There are no predictions for PLACEMENT or other FFA finishing positions.
- Each correct selected player earns exactly one point and one Lucky Draw ticket.
- Unpublished or unresolved results remain pending, not incorrect.
- Legacy semi-final/final predictions are reevaluated against confirmed winners
  without old bonuses or podium scoring.
- Users can view the public leaderboard.
- Signed-in viewers can edit their public username on the prediction page, even
  while predictions are locked. Use 3-24 characters: English letters, numbers,
  spaces, underscores or hyphens, including at least one letter or number.
- Usernames are separate profiles linked by UID; Google identity is unchanged.
  Names appear after the next successful leaderboard recalculation.
  Missing/invalid names use Participant, never account emails or prediction names.

G. ADMINISTRATOR FEATURES
- On first setup or migration, explicitly confirm destructive initialisation in admin.
  Initialisation never runs automatically on page load. Review the warning first.
- Enter the participant roster in the admin dashboard, never in committed files.
  Keep existing string player keys stable. Store the participant ID separately as
  text (preserving leading zeroes) and the username separately, trimmed.
  Bulk entry: Admin > Rooms > Import roster CSV accepts the exact header
  room,participantId,username and up to eight rows per group A-D. Preview first,
  then explicitly save and confirm. Listed group rosters are replaced in file
  order; spare slots stay blank and omitted groups stay unchanged. Duplicate IDs
  or usernames are rejected. Existing IDs retain their player keys. Saving resets
  dependent rooms and deletes their predictions, while retaining group picks.
  Reopen published groups before roster changes. Keep real CSVs out of Git.
- Groups allow unfilled slots; a real player needs a nonempty key, not TBD.
- Publish each group's two qualifiers in first/second order, not roster order.
- Publish valid FT scores for each series. Confirmed results populate the exact
  downstream feeders above; one unresolved feeder does not erase another confirmed one.
- Enter five ordered rounds for PLACEMENT and resolve any total-points tie explicitly.
- Open or close group, quarter-final, semi-final and final prediction stages.
- Under Admin > Rooms, use Lock predictions / Unlock predictions on an individual
  room card. Lock a room when its match starts without closing its entire stage.
  Saved picks remain visible and count toward scoring. Locked rooms reject new
  picks, edits and user resets, including direct Firestore requests.
  Unlocking still requires an open stage, ready players and unpublished/non-completed
  results. It does not change match status or reopen results. PLACEMENT has no control.
  Missing rooms/<id>.predictionsLocked means unlocked; only true locks the room.
  New rooms start unlocked. Stage toggles, roster edits, result changes and format
  migration retain explicit locks, including dependent-room locks.
- Recalculate leaderboard totals after publishing or correcting results.
- Reopen a published room when its result needs correction.

REOPEN / UNPUBLISH RESULTS
- The Reopen Room control appears for a room with published results.
- Reopening clears that room's official result fields and changes its status to Upcoming.
- The room's player list and predictions for that same room are preserved.
- All transitive dependent rooms reset because their participants depend on this result.
- Predictions for dependent rooms are deleted; the reopened room's own picks remain.
- Reopening results retains prediction locks on this room and dependent rooms.
  Unlock predictions separately if organisers intend to accept picks again.
- Publish corrected results and regenerate the affected bracket from confirmed feeders.
- A group affects its QFs, dependent SFs, FINAL, THIRD and PLACEMENT. A QF affects
  its SF, FINAL, THIRD and PLACEMENT. An SF affects FINAL and THIRD.

H. LEADERBOARD SCORING
- Score only saved predictions against published, resolved results.
- Each correct selected player earns one point and one correct-count/Lucky Draw ticket.
- Recalculation replaces absolute totals from current results, never increments them.
  Saving the same result again is idempotent; corrections can reduce scores.
- Unresolved picks remain pending. Ignore FFA placements for prediction scoring.
- Deduplicate legacy/new predictions for the same user and room to avoid double credit.
- Public names come from valid private profiles, never saved prediction identity.
  Profile changes do not change scores or ticket ownership.
- Admin > Prediction Settings > Public username moderation: Load usernames,
  select an account UID, and confirm Reset username to Participant. The user may
  choose another name. Recalculate when ready to publish the reset.
- Leaderboard replacement removes unexpected public fields. Rendering an invalid
  name as Participant does not remove the stored public data; any production
  inspection or recalculation for cleanup requires separate authorisation.
- Signing into admin does not recalculate. Use Admin > Prediction Settings >
  Recalculate leaderboard to intentionally refresh names or repair stale rows.
- Publishing/correcting/reopening results and roster changes still recalculate.
  Stage toggles, room locks and status-only saves do not.
- Only new, meaningfully changed or malformed public rows are written; obsolete
  rows are deleted. Unchanged rows retain updatedAt, and a repeated unchanged
  recalculation makes no leaderboard writes/deletes. Stored and public tie rules
  remain unchanged; alphabetical ordering may change when a username changes.
- Profiles are read once per distinct participant, in queries of at most 30 UIDs.
  There are no public profile listeners. Initial leaderboard loads/reconnects and
  genuine ranking changes can still consume substantial free-plan read quota.

I. LUCKY DRAW
The administrator dashboard includes a Lucky Draw module. It is separate from the points leaderboard.
- The draw loads the latest leaderboard entries.
- Each participant receives one ticket per correct pick (the leaderboard correct count).
- Participants with zero tickets are not eligible.
- The wheel selects a ticket at random, so participants with more tickets have more entries.
- After a participant wins, all of that participant's tickets are removed from the current draw and they are excluded from further draws.
- Winner history is saved in the ticketAwards collection.
- The administrator can undo any selected winner from the history. Undo restores that winner's ticket count, removes their winner record and makes them eligible again.
- Use Refresh Latest Tickets to reload ticket counts from the latest leaderboard.

IMPORTANT NOTES
- This is a browser-based Firebase application; Firestore Security Rules are essential.
- Never place service-account private keys or privileged secrets in browser JavaScript.
- Reopening a room resets dependent bracket data. Review the confirmation message before proceeding.
- Predictions for the reopened room are retained; predictions for dependent rooms are removed when those rooms are reset.
- Test publishing, reopening, feeders, scoring and Lucky Draw undo with synthetic data
  on the isolated local emulators before using the site for a live event.
- For username/privacy releases, pause admin result/draw operations, deploy
  firestore:rules before hosting, and reload all admin tabs before resuming.
  New profiles require the new rules; old admin tabs may fail stricter leaderboard
  validation. See README.md for exact deployment commands and rollback cautions.
- Firebase quotas and pricing may change; consult Firebase documentation for current limits.

ORGANISER CONFIRMATIONS BEFORE THE EVENT
1. Is the third/fourth-place match FT9, or FT5 as mentioned elsewhere in the rulebook?
   The current implementation uses FT9.
2. What is the official FFA tiebreak rule? Tied totals currently leave placings
   pending until an organiser enters an explicit decision.
3. What are the three missing finalist IDs in B, C and D, and does any room have
   fewer than eight players? Enter confirmed roster details in admin, not this file.
4. Are match-winner picks the intended predictions for the knockout stage?
