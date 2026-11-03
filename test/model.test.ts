import { parseId } from '../lambdas/shared/model';

describe('parseId', () => {
  it('parses positive safe integers', () => {
    expect(parseId('1')).toBe(1);
    expect(parseId('1234')).toBe(1234);
    expect(parseId('9007199254740991')).toBe(Number.MAX_SAFE_INTEGER);
  });

  it.each([
    undefined,
    '',
    '0',
    '-1',
    '+1',
    '01',
    '1.5',
    '1e3',
    ' 1234',
    '1234 ',
    '9007199254740992',
  ])('rejects invalid ID value %s', (value) => {
    expect(parseId(value)).toBeUndefined();
  });
});
