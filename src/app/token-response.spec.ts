import {
  expiresAtOf,
  isExpiredAt,
  toSessionTokens,
  TokenResponse,
  validateTokenResponse,
} from './token-response';

const VALID = {
  token_type: 'Bearer',
  expires_in: 3600,
  access_token: 'access-token-value',
  refresh_token: 'refresh-token-value',
};

const RECEIVED_AT = 1_700_000_000_000;

describe('validateTokenResponse', () => {
  describe('valid responses', () => {
    it('accepts a complete bearer response', () => {
      expect(validateTokenResponse(VALID)).toEqual({
        ok: true,
        tokens: {
          accessToken: 'access-token-value',
          tokenType: 'Bearer',
          expiresIn: 3600,
          refreshToken: 'refresh-token-value',
          scope: null,
        },
      });
    });

    it('accepts the minimal response: access token and bearer type only', () => {
      expect(validateTokenResponse({ access_token: 'abc', token_type: 'Bearer' })).toEqual({
        ok: true,
        tokens: {
          accessToken: 'abc',
          tokenType: 'Bearer',
          expiresIn: null,
          refreshToken: null,
          scope: null,
        },
      });
    });

    it.each(['bearer', 'BEARER', 'Bearer'])('accepts the token type %s', (tokenType) => {
      const result = validateTokenResponse({ ...VALID, token_type: tokenType });

      expect(result.ok).toBe(true);
      expect((result as { tokens: TokenResponse }).tokens.tokenType).toBe(tokenType);
    });

    it('treats null optional fields as absent', () => {
      const result = validateTokenResponse({
        ...VALID,
        expires_in: null,
        refresh_token: null,
        scope: null,
      });

      expect(result).toMatchObject({
        ok: true,
        tokens: { expiresIn: null, refreshToken: null, scope: null },
      });
    });

    it('keeps the granted scope and an expires_in of zero', () => {
      const result = validateTokenResponse({ ...VALID, expires_in: 0, scope: 'read write' });

      expect(result).toMatchObject({ ok: true, tokens: { expiresIn: 0, scope: 'read write' } });
    });

    it('ignores unknown fields', () => {
      expect(validateTokenResponse({ ...VALID, id_token: 'x', extra: 1 }).ok).toBe(true);
    });
  });

  describe('invalid responses', () => {
    it.each([
      ['null', null, 'not_an_object'],
      ['a string', 'token', 'not_an_object'],
      ['an array', [VALID], 'not_an_object'],
      ['a missing access token', { token_type: 'Bearer' }, 'missing_access_token'],
      ['an empty access token', { ...VALID, access_token: '' }, 'missing_access_token'],
      ['a numeric access token', { ...VALID, access_token: 123 }, 'missing_access_token'],
      ['a missing token type', { access_token: 'abc' }, 'unsupported_token_type'],
      ['a MAC token type', { ...VALID, token_type: 'MAC' }, 'unsupported_token_type'],
      ['an empty token type', { ...VALID, token_type: '' }, 'unsupported_token_type'],
      ['a string expires_in', { ...VALID, expires_in: '3600' }, 'invalid_expires_in'],
      ['a negative expires_in', { ...VALID, expires_in: -1 }, 'invalid_expires_in'],
      ['an infinite expires_in', { ...VALID, expires_in: Infinity }, 'invalid_expires_in'],
      ['a NaN expires_in', { ...VALID, expires_in: NaN }, 'invalid_expires_in'],
      ['a boolean expires_in', { ...VALID, expires_in: true }, 'invalid_expires_in'],
      ['a numeric refresh token', { ...VALID, refresh_token: 42 }, 'invalid_refresh_token'],
      ['an empty refresh token', { ...VALID, refresh_token: '' }, 'invalid_refresh_token'],
      ['an array scope', { ...VALID, scope: ['read'] }, 'invalid_scope'],
    ])('refuses %s', (_label, body, problem) => {
      expect(validateTokenResponse(body)).toEqual({ ok: false, problem });
    });

    it('reports the first problem when several fields are wrong', () => {
      expect(validateTokenResponse({ access_token: '', token_type: 'MAC' })).toEqual({
        ok: false,
        problem: 'missing_access_token',
      });
    });
  });
});

describe('expiry calculation', () => {
  const tokens = (expiresIn: number | null): TokenResponse => ({
    accessToken: 'abc',
    tokenType: 'Bearer',
    expiresIn,
    refreshToken: null,
    scope: null,
  });

  it('adds expires_in seconds, as milliseconds, to the reception instant', () => {
    expect(expiresAtOf(tokens(3600), RECEIVED_AT)).toBe(RECEIVED_AT + 3_600_000);
    expect(expiresAtOf(tokens(1), RECEIVED_AT)).toBe(RECEIVED_AT + 1_000);
  });

  it('makes a zero lifetime expire at the reception instant', () => {
    expect(expiresAtOf(tokens(0), RECEIVED_AT)).toBe(RECEIVED_AT);
  });

  it('has no expiry when the server announced none', () => {
    expect(expiresAtOf(tokens(null), RECEIVED_AT)).toBeNull();
  });

  it('rounds fractional seconds to the millisecond', () => {
    expect(expiresAtOf(tokens(1.5), RECEIVED_AT)).toBe(RECEIVED_AT + 1_500);
    expect(expiresAtOf(tokens(0.0004), RECEIVED_AT)).toBe(RECEIVED_AT);
  });

  it('produces session tokens dated from the reception instant', () => {
    const result = validateTokenResponse(VALID);
    expect(result.ok).toBe(true);

    expect(toSessionTokens((result as { tokens: TokenResponse }).tokens, RECEIVED_AT)).toEqual({
      accessToken: 'access-token-value',
      tokenType: 'Bearer',
      refreshToken: 'refresh-token-value',
      expiresAt: RECEIVED_AT + 3_600_000,
    });
  });
});

describe('isExpiredAt', () => {
  const expiresAt = RECEIVED_AT + 3_600_000;

  it('is false strictly before the expiry instant', () => {
    expect(isExpiredAt(expiresAt, RECEIVED_AT)).toBe(false);
    expect(isExpiredAt(expiresAt, expiresAt - 1)).toBe(false);
  });

  it('is true from the expiry instant on', () => {
    expect(isExpiredAt(expiresAt, expiresAt)).toBe(true);
    expect(isExpiredAt(expiresAt, expiresAt + 1)).toBe(true);
    expect(isExpiredAt(expiresAt, Number.MAX_SAFE_INTEGER)).toBe(true);
  });

  it('never expires a token without announced expiry', () => {
    expect(isExpiredAt(null, Number.MAX_SAFE_INTEGER)).toBe(false);
  });

  it('ignores clock moves into the past', () => {
    expect(isExpiredAt(expiresAt, expiresAt - 86_400_000)).toBe(false);
  });
});
