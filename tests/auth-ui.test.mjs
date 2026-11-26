import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import { publicUsername } from '../public/js/usernames.js';

const source = await readFile(new URL('../public/js/auth-ui.js', import.meta.url), 'utf8');
const owner = { uid: 'synthetic-owner', displayName: 'Synthetic Viewer' };
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};

function harness() {
  const elements = new Map();
  const element = id => {
    if (!elements.has(id)) elements.set(id, {
      textContent: '', disabled: false, attributes: {}, listeners: {},
      setAttribute(name, value) { this.attributes[name] = value; },
      addEventListener(name, handler) { this.listeners[name] = handler; }
    });
    return elements.get(id);
  };
  const state = { changed: [], signIns: 0, signOuts: 0, profiles: [], reloads: 0 };
  const auth = { currentUser: null };
  const context = {
    auth, publicUsername, document: { getElementById: element },
    location: { reload() { state.reloads++; } },
    onAuthStateChanged(_auth, next, failed) { state.next = next; state.failed = failed; },
    signIn() { state.signIns++; return state.action?.promise || Promise.resolve(); },
    signOut() { state.signOuts++; return state.action?.promise || Promise.resolve(); },
    initializeUsernameProfile(user, isCurrent) {
      state.profiles.push({ user, isCurrent });
      return state.profile?.promise || Promise.resolve({ needsFullName: false });
    }
  };
  runInNewContext(source.replace(/^import.*;\r?\n/gm, '').replace('export function', 'function')
    + '\nglobalThis.init = initPublicAuth;', context);
  context.init({ onUserChanged: user => state.changed.push(user) });
  return {
    state, auth, button: element('authBtn'), status: element('authStatus'),
    restore(user) { auth.currentUser = user; state.next(user); },
    click() { return element('authBtn').listeners.click(); }
  };
}

test('restoration never announces signed out or enables conflicting auth actions', async () => {
  const h = harness();
  assert.equal(h.button.disabled, true);
  assert.match(h.status.textContent, /Restoring your session/);
  assert.equal(h.button.attributes['aria-busy'], 'true');
  await h.click();
  assert.equal(h.state.signIns, 0);
  h.restore(owner);
  assert.equal(h.button.disabled, false);
  assert.equal(h.button.textContent, 'SIGN OUT');
  assert.match(h.status.textContent, /Signed in as Synthetic Viewer/);
  assert.deepEqual(h.state.changed, [owner]);
});

test('popup failure is visible, re-enables retry and prevents duplicate actions', async () => {
  const h = harness();
  h.restore(null);
  h.state.action = deferred();
  const action = h.click();
  await h.click();
  assert.equal(h.state.signIns, 1);
  assert.equal(h.button.disabled, true);
  h.state.action.reject({ code: 'auth/popup-blocked' });
  await action;
  assert.match(h.status.textContent, /Allow popups/);
  assert.equal(h.button.disabled, false);
  assert.equal(h.button.textContent, 'SIGN IN WITH GOOGLE');
});

test('sign-out failure keeps the account available and reports an actionable error', async () => {
  const h = harness();
  h.restore(owner);
  h.state.action = deferred();
  const action = h.click();
  assert.equal(h.state.signOuts, 1);
  h.state.action.reject({ code: 'auth/network-request-failed' });
  await action;
  assert.equal(h.button.textContent, 'SIGN OUT');
  assert.equal(h.button.disabled, false);
  assert.match(h.status.textContent, /connection and browser storage/);
});

test('account changes clear consumers immediately and discard stale profile completion', async () => {
  const h = harness();
  h.state.profile = deferred();
  h.restore(owner);
  const first = h.state.profiles[0];
  h.restore({ uid: 'synthetic-other', displayName: 'Other Viewer' });
  assert.equal(first.isCurrent(), false);
  h.restore(null);
  assert.equal(h.state.changed.at(-1), null);
  h.state.profile.resolve({ needsFullName: true });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(h.button.textContent, 'SIGN IN WITH GOOGLE');
  assert.equal(h.status.textContent, 'Sign in with Google to save your predictions.');
});

test('failed restoration clears private state and offers reload without claiming to be signed out', async () => {
  const h = harness();
  h.restore(owner);
  h.state.failed(new Error('storage blocked'));
  assert.equal(h.state.changed.at(-1), null);
  assert.equal(h.button.textContent, 'RELOAD TO RETRY');
  assert.equal(h.button.disabled, false);
  assert.equal(h.button.attributes['aria-busy'], 'false');
  assert.match(h.status.textContent, /Sign-in status could not be verified/);
  assert.match(h.status.textContent, /Allow browser storage, then reload to retry/);
  assert.doesNotMatch(h.status.textContent, /Restoring your session|Signed in as|Sign in with Google to save/);
  await h.click();
  assert.equal(h.state.reloads, 1);
  assert.equal(h.state.signIns, 0);
  assert.equal(h.state.signOuts, 0);
});

test('invalid identity names never render email or account UID', () => {
  const h = harness();
  h.restore({ uid: 'private-uid-123', email: 'private@example.test', displayName: 'private@example.test' });
  assert.match(h.status.textContent, /Signed in as Participant/);
  assert.doesNotMatch(h.status.textContent, /private|@/);
});

test('a rejected profile load preserves authentication and directs owners to retry', async () => {
  const h = harness();
  h.state.profile = deferred();
  h.restore(owner);
  h.state.profile.reject(new Error('permission-denied'));
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(h.button.textContent, 'SIGN OUT');
  assert.match(h.status.textContent, /Unable to load your public full name. Retry on Predict/);
});

test('a stale popup cancellation cannot hide an account restored by another tab', async () => {
  const h = harness();
  h.restore(null);
  h.state.action = deferred();
  const action = h.click();
  h.restore(owner);
  h.state.action.reject({ code: 'auth/popup-closed-by-user' });
  await action;
  assert.equal(h.button.textContent, 'SIGN OUT');
  assert.equal(h.button.disabled, false);
  assert.match(h.status.textContent, /Signed in as Synthetic Viewer/);
  assert.doesNotMatch(h.status.textContent, /cancelled/);
});

test('successful restoration after a failure replaces the recovery action and stale error', () => {
  const h = harness();
  h.state.failed(new Error('storage blocked'));
  h.restore(owner);
  assert.equal(h.button.textContent, 'SIGN OUT');
  assert.equal(h.button.disabled, false);
  assert.equal(h.button.attributes['aria-busy'], 'false');
  assert.match(h.status.textContent, /Signed in as Synthetic Viewer/);
  assert.doesNotMatch(h.status.textContent, /could not be verified/);
});

test('a stale popup rejection cannot replace the failed-restoration recovery state', async () => {
  const h = harness();
  h.restore(null);
  h.state.action = deferred();
  const action = h.click();
  h.state.failed(new Error('restore failed'));
  h.state.action.reject({ code: 'auth/popup-closed-by-user' });
  await action;
  assert.equal(h.button.textContent, 'RELOAD TO RETRY');
  assert.equal(h.button.disabled, false);
  assert.equal(h.button.attributes['aria-busy'], 'false');
  assert.match(h.status.textContent, /Sign-in status could not be verified/);
});
