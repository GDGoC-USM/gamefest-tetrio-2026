import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import * as usernames from '../public/js/usernames.js';

const source = await readFile(new URL('../public/js/predict.js', import.meta.url), 'utf8');
const profileSource = await readFile(new URL('../public/js/profiles.js', import.meta.url), 'utf8');
const owner = Object.freeze({ uid: 'owner', displayName: 'José O’Neill', email: 'private@example.test' });
const snapshot = profile => ({ exists: () => profile !== undefined, data: () => profile });

function profileHarness(profiles) {
  const elements = new Map();
  const element = id => {
    if (!elements.has(id)) elements.set(id, {
      value: '', hidden: false, disabled: false, innerHTML: '', textContent: '',
      listeners: {}, addEventListener(type, handler) { this.listeners[type] = handler; },
      setAttribute() {}, focus() {}
    });
    return elements.get(id);
  };
  const state = {
    profiles, stored: profiles.at(-1), reads: [], attempts: [], commits: [], callbackUI: [],
    transactions: 0, directReads: 0, directWrites: 0,
    afterRead: undefined, beforeResolve: undefined
  };
  const record = (reference, data) => ({ path: reference.path, username: data.username, updatedAt: data.updatedAt });
  const context = {
    ...usernames, ROOM_CONFIG: [], STAGES: [], db: {}, auth: {},
    document: { getElementById: element },
    initPublicAuth() {}, collection: (_db, name) => name, onSnapshot: () => () => {},
    doc: (_db, collection, uid) => ({ path: `${collection}/${uid}` }),
    serverTimestamp: () => 'server-time',
    // Keep the old nontransactional path observable so this catches a regression
    // to a stale getDoc snapshot followed by an unconditional default overwrite.
    async getDoc(reference) {
      state.directReads++;
      state.reads.push(reference.path);
      return snapshot(state.profiles[0]);
    },
    async setDoc(reference, data) {
      state.directWrites++;
      state.commits.push(record(reference, data));
      state.stored = { username: data.username, updatedAt: data.updatedAt };
    },
    async runTransaction(_db, update) {
      state.transactions++;
      for (let index = 0; index < state.profiles.length; index++) {
        const writes = [];
        const result = await update({
          async get(reference) {
            state.reads.push(reference.path);
            await state.afterRead?.(index);
            return snapshot(state.profiles[index]);
          },
          set(reference, data) { writes.push(record(reference, data)); }
        });
        state.attempts.push(writes);
        // Firestore may retry the callback: provisional identities must never
        // escape into the page before a transaction successfully completes.
        state.callbackUI.push({
          name: element('currentUsername').textContent,
          formHidden: element('usernameForm').hidden,
          notice: element('usernameNotice').textContent
        });
        if (index === state.profiles.length - 1) {
          state.commits.push(...writes);
          if (writes.length) state.stored = { username: writes[0].username, updatedAt: writes[0].updatedAt };
          await state.beforeResolve?.();
          return result;
        }
      }
      throw new Error('A transaction test requires at least one snapshot.');
    }
  };
  // Execute the actual page loader and profile UI helpers, not a replica of
  // the initialization decision or Firebase imports/network implementation.
  runInNewContext(profileSource.replace(/^import.*;\r?\n/gm, '').replace('export async function', 'async function')
    + '\nglobalThis.initializeUsernameProfile = initializeUsernameProfile;', context);
  runInNewContext(source.replace(/^import[\s\S]*?from "[^"]+";\r?\n/gm, '') + `
    globalThis.loadTestProfile = user => {
      currentUser = user;
      const epoch = ++authEpoch;
      resetUsernameEditor(user);
      return loadUsernameProfile(user, epoch);
    };
    globalThis.switchTestAccount = user => {
      currentUser = user;
      ++authEpoch;
      resetUsernameEditor(user);
    };
  `, context);
  return { state, element, load: context.loadTestProfile, switchAccount: context.switchTestAccount };
}

test('retried profile initialization preserves a newer custom name or moderator reset', async t => {
  for (const [initialLabel, initial] of [['missing', undefined], ['legacy', { username: 'Participant' }]]) {
    for (const latest of [
      { username: '李 小龍', updatedAt: 'concurrent-owner-save' },
      { username: 'Participant', updatedAt: 'moderator-reset' }
    ]) {
      await t.test(`${initialLabel} to ${latest.username}`, async () => {
        const { state, element, load } = profileHarness([initial, latest]);
        await load(owner);
        assert.equal(state.transactions, 1);
        assert.deepEqual(state.reads, ['profiles/owner', 'profiles/owner']);
        assert.equal(state.attempts[0].length, 1, 'first attempt staged a default but did not commit it');
        assert.equal(state.attempts[1].length, 0, 'retry must preserve the newer saved profile');
        assert.deepEqual(state.commits, []);
        assert.equal(state.stored, latest);
        assert.equal(state.directReads, 0);
        assert.equal(state.directWrites, 0);
        assert.deepEqual(state.callbackUI, Array.from({ length: 2 }, () => ({
          name: '', formHidden: true, notice: 'Loading your full name…'
        })));
        assert.equal(element('currentUsername').textContent, latest.username);
        assert.equal(element('usernameForm').hidden, false);
        assert.equal(element('usernameInput').value, latest.username === 'Participant' ? owner.displayName : latest.username);
        if (latest.username === 'Participant') {
          assert.match(element('usernameNotice').textContent, /Please enter and save your full name/);
        }
      });
    }
  }
});

test('an uncontended missing profile initializes once and subsequent loads only read', async () => {
  const { state, element, load } = profileHarness([undefined]);
  await load(owner);
  assert.equal(state.transactions, 1);
  assert.deepEqual(state.reads, ['profiles/owner']);
  assert.deepEqual(state.commits, [{ path: 'profiles/owner', username: owner.displayName, updatedAt: 'server-time' }]);
  assert.equal(element('currentUsername').textContent, owner.displayName);
  const persisted = state.stored;
  state.profiles = [persisted];
  await load({ ...owner, displayName: 'Changed Google Name' });
  assert.equal(state.transactions, 2);
  assert.deepEqual(state.reads, ['profiles/owner', 'profiles/owner']);
  assert.equal(state.commits.length, 1);
  assert.equal(state.stored, persisted);
  assert.equal(element('currentUsername').textContent, owner.displayName);
  assert.equal(state.directReads, 0);
  assert.equal(state.directWrites, 0);
  assert.deepEqual(state.callbackUI, Array.from({ length: 2 }, () => ({
    name: '', formHidden: true, notice: 'Loading your full name…'
  })));
});

test('a missing profile without a safe Google name remains temporary and never uses email', async () => {
  const { state, element, load } = profileHarness([undefined]);
  await load({ ...owner, displayName: 'private@example.test' });
  assert.deepEqual(state.reads, ['profiles/owner']);
  assert.deepEqual(state.commits, []);
  assert.equal(element('currentUsername').textContent, 'Participant');
  assert.equal(element('usernameInput').value, '');
  assert.match(element('usernameNotice').textContent, /Please enter and save your full name/);
});

test('an account switch during the transaction read prevents initialization and stale UI', async () => {
  const { state, element, load, switchAccount } = profileHarness([undefined]);
  state.afterRead = () => { switchAccount({ uid: 'other', displayName: 'Other Account' }); };
  await load(owner);
  assert.deepEqual(state.commits, []);
  assert.equal(state.attempts[0].length, 0);
  assert.equal(element('currentUsername').textContent, '');
  assert.equal(element('usernameInput').value, '');
  assert.equal(element('usernameForm').hidden, true);
  assert.equal(element('usernameInput').disabled, true);
  assert.equal(element('usernameNotice').textContent, '');
});

test('a completed transaction cannot replace another account UI while its promise resolves', async () => {
  const { state, element, load, switchAccount } = profileHarness([undefined]);
  state.beforeResolve = () => { switchAccount({ uid: 'other', displayName: 'Other Account' }); };
  await load(owner);
  assert.deepEqual(state.commits, [{ path: 'profiles/owner', username: owner.displayName, updatedAt: 'server-time' }]);
  assert.equal(element('currentUsername').textContent, '');
  assert.equal(element('usernameInput').value, '');
  assert.equal(element('usernameForm').hidden, true);
  assert.equal(element('usernameInput').disabled, true);
  assert.equal(element('usernameNotice').textContent, '');
});
