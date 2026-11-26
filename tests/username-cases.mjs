export const VALID_USERNAMES = [
  'Abc', 'abc', 'ABC', '123', 'A_1', 'A-1', '_A_', '-1-', 'a b',
  'A  B', 'Player One_2-Test', 'a'.repeat(24), '_'.repeat(23) + '1',
  '1' + '-'.repeat(23), 'Participant'
];

export const INVALID_USERNAMES = [
  '', 'a', 'ab', 'a'.repeat(25), '   ', '___', '---', '_ -',
  ' Abc', 'Abc ', ' Abc ', 'a@b', 'a.b', 'a/b', 'a\\b', 'a<b', 'a&b',
  'a:b', 'a"b', "a'b", 'a+b', 'a=b', 'a(b', 'a[b', 'a{b',
  '\tAbc', 'Abc\t', 'A\tB', '\nAbc', 'Abc\n', 'A\nB', 'Abc\r\n',
  'A\rB', 'A\0B', 'A\x1fB', 'A\x7fB', 'A\x85B',
  '\u00a0Abc', 'Abc\u00a0', 'A\u00a0B', 'A\u200bB', 'A\u2028B', 'A\u2029B',
  'Jos\u00e9', 'Jose\u0301', '\u0e01\u0e02\u0e03', '\uff21bc', 'A\ud83d\ude00B',
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
