export const VALID_USERNAMES = [
  'Abc', 'abc', 'ABC', '123', 'A_1', 'A-1', '_A_', '-1-', 'a b',
  'A  B', 'Player One_2-Test', 'a'.repeat(80), '_'.repeat(79) + '1',
  '1' + '-'.repeat(79), 'Participant', 'José Álvarez', 'Jose\u0301 Alvarez',
  'กขค', 'Ａbc', '李 小龍', '山田 太郎', 'محمد أحمد', '१२३',
  "Anne-Marie O'Neill", 'D’Arcy Smith', 'J. R. R. Tolkien', 'Tan, Mei Ling',
  'Jean·Luc (Jr.)', 'a.b', "a'b", 'a(b', '𐐀'.repeat(3), '𐐀'.repeat(80)
];

export const INVALID_USERNAMES = [
  '', 'a', 'ab', 'a'.repeat(81), '𐐀'.repeat(2), '𐐀'.repeat(81),
  '   ', '___', '---', '_ -', "...", "''.", '()\u0301',
  ' Abc', 'Abc ', ' Abc ', 'a@b', 'viewer@example.test', 'Viewer <a@b.test>',
  'a/b', 'a\\b', 'a<b', 'a>b', '<b>Ana</b>', '&lt;Ana&gt;', 'a&b',
  'a:b', 'a"b', 'a+b', 'a=b', 'a[b', 'a{b',
  '\tAbc', 'Abc\t', 'A\tB', '\nAbc', 'Abc\n', 'A\nB', 'Abc\r\n',
  'A\rB', 'A\0B', 'A\x1fB', 'A\x7fB', 'A\x85B',
  '\u00a0Abc', 'Abc\u00a0', 'A\u00a0B', 'A\u200bB', 'A\u2028B', 'A\u2029B',
  'A\u200cB', 'A\u200dB', 'A\u202eB', 'A\u2066B', 'A\ufeffB',
  'A\ud83d\ude00B', '\u0301'.repeat(3),
  null, false, 123, [], {}, ['Abc']
];

export const NORMALIZATION_CASES = [
  ['  Abc  ', 'Abc'], [' A  B ', 'A  B'], ['   ', ''], ['', ''],
  ['\tAbc\t', '\tAbc\t'], [' \tAbc\t ', '\tAbc\t'],
  ['\nAbc\n', '\nAbc\n'], [' \nAbc\n ', '\nAbc\n'],
  ['\u00a0Abc\u00a0', '\u00a0Abc\u00a0'], [' A\u200bB ', 'A\u200bB'],
  ['Abc \n', 'Abc \n'], [' Abc \n ', 'Abc \n'],
  [' Abc\n ', 'Abc\n'], [null, ''], [undefined, ''], [123, ''],
  [false, ''], [{ username: 'Abc' }, ''], [['Abc'], '']
];
