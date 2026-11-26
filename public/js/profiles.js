import { db, doc, runTransaction, serverTimestamp } from "./shared.js";
import { usernameProfileState } from "./usernames.js";

// Read once per page/sign-in; retries re-evaluate concurrent owner/moderator edits.
export async function initializeUsernameProfile(user, isCurrent) {
  const reference = doc(db, "profiles", user.uid);
  return runTransaction(db, async transaction => {
    if (!isCurrent()) return null;
    const snapshot = await transaction.get(reference);
    if (!isCurrent()) return null;
    const state = usernameProfileState(snapshot.exists() ? snapshot.data() : undefined, user);
    if (state.initialize) {
      transaction.set(reference, { username: state.username, updatedAt: serverTimestamp() });
    }
    return state;
  });
}
