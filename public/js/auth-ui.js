import { auth, signIn, signOut, onAuthStateChanged } from "./shared.js";
import { publicUsername } from "./usernames.js";
import { initializeUsernameProfile } from "./profiles.js";

export function initPublicAuth({ onUserChanged = () => {}, initializeProfile = true } = {}) {
  const button = document.getElementById("authBtn");
  const status = document.getElementById("authStatus");
  let restored = false;
  let user = null;
  let busy = "";
  let error = "";
  let profileMessage = "";
  let epoch = 0;

  function renderAuth() {
    button.disabled = !restored || Boolean(busy);
    button.setAttribute("aria-busy", String(!restored || Boolean(busy)));
    button.textContent = !restored ? "RESTORING SESSION…" : busy || (user ? "SIGN OUT" : "SIGN IN WITH GOOGLE");
    status.textContent = error || (!restored ? "Restoring your session…" : busy
      ? busy === "SIGNING OUT…" ? "Signing out…" : "Opening Google sign-in…"
      : user ? `Signed in as ${publicUsername(user.displayName)}.${profileMessage}`
        : "Sign in with Google to save your predictions.");
  }

  button.addEventListener("click", async () => {
    if (!restored || busy) return;
    const actionEpoch = epoch;
    busy = user ? "SIGNING OUT…" : "SIGNING IN…";
    error = "";
    renderAuth();
    try {
      if (user) await signOut(auth);
      else await signIn();
    } catch (failure) {
      if (epoch !== actionEpoch) return;
      error = failure.code === "auth/popup-closed-by-user" ? "Sign-in cancelled. You can try again."
        : failure.code === "auth/popup-blocked" ? "Allow popups for this site, then try signing in again."
          : "Unable to change sign-in. Check your connection and browser storage, then try again.";
    } finally {
      busy = "";
      renderAuth();
    }
  });

  renderAuth();
  return onAuthStateChanged(auth, nextUser => {
    const currentEpoch = ++epoch;
    restored = true;
    user = nextUser;
    error = "";
    profileMessage = "";
    // Clear page-owned data synchronously before any asynchronous profile work.
    onUserChanged(user);
    renderAuth();
    if (!user || !initializeProfile) return;
    const signedInUser = user;
    const isCurrent = () => epoch === currentEpoch && auth.currentUser?.uid === signedInUser.uid;
    void initializeUsernameProfile(signedInUser, isCurrent).then(profile => {
      if (!profile || !isCurrent()) return;
      profileMessage = profile.needsFullName ? " Choose your public full name on Predict." : "";
      renderAuth();
    }).catch(() => {
      if (!isCurrent()) return;
      profileMessage = " Unable to load your public full name. Retry on Predict.";
      renderAuth();
    });
  }, () => {
    ++epoch;
    restored = false;
    user = null;
    busy = "";
    error = "Unable to restore your session. Allow browser storage and refresh to try again.";
    onUserChanged(null);
    renderAuth();
  });
}
