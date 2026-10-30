import {
  base64UrlEncode,
  createCodeChallenge,
  generateCodeVerifier,
  generateState,
  isValidCodeVerifier,
  randomBase64Url,
} from './pkce';

describe('pkce helpers', () => {
  it('encodes bytes as unpadded base64url', () => {
    // 0xfb 0xff 0xbf encodes to "+/+/" in standard base64.
    expect(base64UrlEncode(new Uint8Array([0xfb, 0xff, 0xbf]))).toBe('-_-_');
    expect(base64UrlEncode(new Uint8Array([0x00]))).toBe('AA');
    expect(base64UrlEncode(new Uint8Array([]).buffer)).toBe('');
  });

  it('produces random values of the expected length and alphabet', () => {
    const value = randomBase64Url(32);
    expect(value).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(randomBase64Url(32)).not.toBe(value);
  });

  it('generates RFC 7636 compliant code verifiers', () => {
    const verifier = generateCodeVerifier();
    expect(isValidCodeVerifier(verifier)).toBe(true);
    expect(verifier).toHaveLength(43);
  });

  it('generates states that differ from code verifiers', () => {
    expect(generateState()).not.toBe(generateCodeVerifier());
    expect(generateState()).not.toBe(generateState());
  });

  it('validates code verifiers', () => {
    expect(isValidCodeVerifier('a'.repeat(43))).toBe(true);
    expect(isValidCodeVerifier('a'.repeat(128))).toBe(true);
    expect(isValidCodeVerifier('a'.repeat(42))).toBe(false);
    expect(isValidCodeVerifier('a'.repeat(129))).toBe(false);
    expect(isValidCodeVerifier('a'.repeat(42) + '!')).toBe(false);
    expect(isValidCodeVerifier(42)).toBe(false);
    expect(isValidCodeVerifier(null)).toBe(false);
  });

  it('derives the S256 challenge from the RFC 7636 example', async () => {
    // Appendix B of RFC 7636.
    await expect(createCodeChallenge('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk')).resolves.toBe(
      'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM',
    );
  });
});
