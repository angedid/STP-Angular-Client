import { FcfaPipe, formatFcfa } from './fcfa.pipe';

const plain = (value: string): string => value.replace(/\u202f|\u00a0/g, ' ');

describe('fcfa', () => {
  it('groups thousands the French way', () => {
    expect(plain(formatFcfa(94_000))).toBe('94 000 FCFA');
    expect(plain(formatFcfa(5_000))).toBe('5 000 FCFA');
    expect(plain(formatFcfa(1_250_000))).toBe('1 250 000 FCFA');
    expect(plain(formatFcfa(0))).toBe('0 FCFA');
  });

  it('rounds to whole francs', () => {
    expect(plain(formatFcfa(12_000.4))).toBe('12 000 FCFA');
  });

  it('shows a dash for missing values', () => {
    const pipe = new FcfaPipe();
    expect(pipe.transform(null)).toBe('—');
    expect(pipe.transform(undefined)).toBe('—');
    expect(pipe.transform(Number.NaN)).toBe('—');
    expect(plain(pipe.transform(18_000))).toBe('18 000 FCFA');
  });
});
