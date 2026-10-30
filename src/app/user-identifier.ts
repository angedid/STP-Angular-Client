/**
 * Parsing of the authenticated user's identifier, `{username}@{tenant_id}`,
 * where `tenant_id` is the tenant's UUID.
 */

/** Generic RFC 4122 textual UUID (any version), case-insensitive. */
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface UserIdentifier {
  /** Username within the tenant. */
  readonly username: string;
  /** Tenant UUID, exactly as written in the identifier. */
  readonly tenantId: string;
}

export type ParsedUserIdentifier =
  | { readonly kind: 'ok'; readonly identifier: UserIdentifier }
  /** No `@` separator, or nothing before / after it. */
  | { readonly kind: 'malformed' }
  /** The part after the last `@` is not a UUID. */
  | { readonly kind: 'invalid_tenant_id'; readonly tenantId: string };

/** Checks that a string is a textual UUID. */
export function isUuid(value: string): boolean {
  return UUID_PATTERN.test(value);
}

/**
 * Splits the identifier on its last `@`, so that usernames containing `@`
 * (for example e-mail addresses) are still handled.
 */
export function parseUserIdentifier(identifier: string): ParsedUserIdentifier {
  const separator = identifier.lastIndexOf('@');
  if (separator <= 0 || separator === identifier.length - 1) {
    return { kind: 'malformed' };
  }
  const username = identifier.slice(0, separator);
  const tenantId = identifier.slice(separator + 1);
  if (!isUuid(tenantId)) {
    return { kind: 'invalid_tenant_id', tenantId };
  }
  return { kind: 'ok', identifier: { username, tenantId } };
}

/**
 * Username to *display* for an identifier: the part before the tenant UUID
 * when the identifier follows `{username}@{tenant_id}`, otherwise the part
 * before the first `@`, or the whole value when there is none. Presentation
 * only: API calls must keep using the full identifier.
 */
export function usernameOf(identifier: string): string {
  const parsed = parseUserIdentifier(identifier);
  if (parsed.kind === 'ok') {
    return parsed.identifier.username;
  }
  const separator = identifier.indexOf('@');
  return separator > 0 ? identifier.slice(0, separator) : identifier;
}
