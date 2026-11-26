export const DEFAULT_USERNAME = 'Participant';
export const USERNAME_HINT = "Use 3–80 characters: letters in any language, numbers, spaces, or name punctuation (' ’ - . , · ( ) _). Include a letter or number. No email addresses or leading/trailing spaces.";

export function normalizeUsername(value) {
  if (typeof value !== 'string') return '';
  let start = 0;
  let end = value.length;
  while (start < end && value[start] === ' ') start++;
  while (end > start && value[end - 1] === ' ') end--;
  return value.slice(start, end);
}

export function isValidUsername(value) {
  return typeof value === 'string'
    && !/[^\p{L}\p{M}\p{N} .,'’·()_-]/u.test(value)
    && /^.{3,80}$/u.test(value)
    && value[0] !== ' ' && value[value.length - 1] !== ' '
    && /[\p{L}\p{N}]/u.test(value);
}

export function publicUsername(value) {
  return isValidUsername(value) ? value : DEFAULT_USERNAME;
}

export function usernameProfileState(profile, user) {
  const stored = profile?.username;
  // Current moderator resets include updatedAt; never silently undo them.
  const legacyPlaceholder = stored === DEFAULT_USERNAME && !Object.hasOwn(profile, 'updatedAt');
  if (isValidUsername(stored) && !legacyPlaceholder) {
    return { username: stored, initialize: false, needsFullName: stored === DEFAULT_USERNAME };
  }
  const googleName = normalizeUsername(user?.displayName);
  if ((profile == null || legacyPlaceholder)
    && googleName !== DEFAULT_USERNAME && isValidUsername(googleName)) {
    return { username: googleName, initialize: true, needsFullName: false };
  }
  return { username: DEFAULT_USERNAME, initialize: false, needsFullName: true };
}
