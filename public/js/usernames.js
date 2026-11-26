export const DEFAULT_USERNAME = 'Participant';
export const USERNAME_HINT = 'Use 3–24 English letters (A–Z, a–z), numbers, spaces, underscores or hyphens, with at least one letter or number. No leading or trailing spaces.';

export function normalizeUsername(value) {
  if (typeof value !== 'string') return '';
  let start = 0;
  let end = value.length;
  while (start < end && value[start] === ' ') start++;
  while (end > start && value[end - 1] === ' ') end--;
  return value.slice(start, end);
}

export function isValidUsername(value) {
  return typeof value === 'string' && value.length >= 3 && value.length <= 24
    && !/[^A-Za-z0-9 _-]/.test(value)
    && value[0] !== ' ' && value[value.length - 1] !== ' '
    && /[A-Za-z0-9]/.test(value);
}

export function publicUsername(value) {
  return isValidUsername(value) ? value : DEFAULT_USERNAME;
}
