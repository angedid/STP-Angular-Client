import { isUuid, parseUserIdentifier, usernameOf } from './user-identifier';

const TENANT = '550e8400-e29b-41d4-a716-446655440000';

describe('user identifier', () => {
  it('extracts the username and the tenant UUID', () => {
    expect(parseUserIdentifier(`jane@${TENANT}`)).toEqual({
      kind: 'ok',
      identifier: { username: 'jane', tenantId: TENANT },
    });
  });

  it('splits on the last @ so e-mail-like usernames keep their domain', () => {
    expect(parseUserIdentifier(`jane@example.test@${TENANT}`)).toEqual({
      kind: 'ok',
      identifier: { username: 'jane@example.test', tenantId: TENANT },
    });
  });

  it('accepts upper-case UUIDs as written', () => {
    const upper = TENANT.toUpperCase();
    expect(parseUserIdentifier(`jane@${upper}`)).toEqual({
      kind: 'ok',
      identifier: { username: 'jane', tenantId: upper },
    });
  });

  it.each([['no separator', 'jane'], ['empty username', `@${TENANT}`], ['empty tenant', 'jane@'], ['empty', '']])(
    'reports a malformed identifier (%s)',
    (_label, identifier) => {
      expect(parseUserIdentifier(identifier)).toEqual({ kind: 'malformed' });
    },
  );

  it.each([
    ['a plain word', 'acme'],
    ['a number', '42'],
    ['a truncated UUID', '550e8400-e29b-41d4-a716'],
    ['a UUID with extra characters', `${TENANT}x`],
    ['a UUID without dashes', TENANT.replace(/-/g, '')],
    ['a UUID with non-hex characters', '550e8400-e29b-41d4-a716-44665544000g'],
  ])('reports an invalid tenant id (%s)', (_label, tenantId) => {
    expect(parseUserIdentifier(`jane@${tenantId}`)).toEqual({ kind: 'invalid_tenant_id', tenantId });
  });

  describe('usernameOf (display only)', () => {
    it('drops the tenant UUID from a well-formed identifier', () => {
      expect(usernameOf(`jane@${TENANT}`)).toBe('jane');
    });

    it('keeps an e-mail-like username intact when followed by the tenant UUID', () => {
      expect(usernameOf(`jane@example.test@${TENANT}`)).toBe('jane@example.test');
    });

    it('falls back to the part before the first @ when the tenant part is not a UUID', () => {
      expect(usernameOf('jane@acme')).toBe('jane');
      expect(usernameOf('jane@example.test@acme')).toBe('jane');
    });

    it('returns the whole value when there is nothing to strip', () => {
      expect(usernameOf('jane')).toBe('jane');
      expect(usernameOf('@tenant')).toBe('@tenant');
    });
  });

  it('validates UUIDs', () => {
    expect(isUuid(TENANT)).toBe(true);
    expect(isUuid('not-a-uuid')).toBe(false);
  });
});
