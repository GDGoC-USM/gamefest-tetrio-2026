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
1. Install Node.js LTS and the Firebase CLI.
2. Open a terminal in the project folder.
3. Run: firebase login
4. Run: firebase init hosting and select the correct Firebase project.
5. Set the public directory to public and choose No for single-page-app rewrites.
6. Run a local hosting preview using the Firebase Hosting emulator if configured.

D. DEPLOY
From the project root, run:
  firebase deploy --only hosting,firestore:rules

E. TOURNAMENT FORMAT
- Preliminary: Rooms A, B, C and D; 8 players in each room.
- Semi-final: SF1 and SF2; 4 players in each room.
- Grand Final: FINAL; 4 players.
- The top 2 players from each preliminary room qualify for the semi-finals.
- The top 2 players from each semi-final qualify for the Grand Final.
- The Grand Final records Champion, 1st Runner-up and 2nd Runner-up.

F. AUDIENCE FEATURES
- Visitors can view tournament information, rooms, statuses and published results.
- Users sign in with Google to submit predictions.
- Preliminary and semi-final predictions select two players from the room.
- Grand Final predictions select Champion, 1st Runner-up and 2nd Runner-up.
- Users can view the public leaderboard.
- Correct picks award 10 points and increase the correct-pick count by 1.

G. ADMINISTRATOR FEATURES
- Manage room player lists and room statuses.
- Publish the two qualifiers for preliminary and semi-final rooms.
- Publish the Grand Final podium.
- Generate SF1/SF2 from preliminary qualifiers and FINAL from semi-final qualifiers.
- Open or close predictions separately for Preliminary, Semi-final and Grand Final.
- Reopen a room after its results have been published.

REOPEN / UNPUBLISH RESULTS
- The Reopen Room control appears for a room with published results.
- Reopening clears that room's official result fields and changes its status to Upcoming.
- The room's player list and predictions for that same room are preserved.
- Any dependent later rooms are reset because their player lists depend on the reopened room's qualifiers.
- Predictions for those dependent rooms are deleted because the old bracket selections may no longer be valid.
- After correcting the room, publish its results again and regenerate the affected later stage(s).
- Reopening SF1 or SF2 also resets the Grand Final. Reopening any preliminary room resets its corresponding semi-final and the Grand Final.

H. LEADERBOARD SCORING
- Scores are calculated from saved predictions and rooms whose resultsPublished field is true.
- Each correct pick adds 10 points and 1 to the correct count.
- The admin dashboard recalculates leaderboard documents when it loads and after results are published or unpublished.

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
- Test result publishing, reopening, stage generation, prediction scoring and Lucky Draw undo in a test Firebase project before using the site for a live event.
- Firebase quotas and pricing may change; consult Firebase documentation for current limits.
