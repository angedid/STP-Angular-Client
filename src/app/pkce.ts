/**
 * Pure helpers for the PKCE extension (RFC 7636) and for CSRF `state` values.
 *
 * These functions only depend on the Web Crypto API, so they can be unit tested
 * without Angular and reused by any service.
 */

/** Characters allowed in a `code_verifier` (RFC 7636, section 4.1). */
const CODE_VERIFIER_PATTERN = /^[A-Za-z0-9\-._~]{43,128}$/;

/** Encodes bytes with the URL-safe base64 alphabet and no padding. */
export function base64UrlEncode(bytes: ArrayBuffer | Uint8Array): string {
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let binary = '';
  for (const byte of view) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** Returns `byteLength` cryptographically random bytes, base64url-encoded. */
export function randomBase64Url(byteLength: number): string {
  const bytes = new Uint8Array(byteLength);
  crypto.getRandomValues(bytes);
  return base64UrlEncode(bytes);
}

/**
 * Generates a `code_verifier`: 32 random bytes, i.e. 43 base64url characters,
 * the length recommended by RFC 7636.
 */
export function generateCodeVerifier(): string {
  return randomBase64Url(32);
}

/**
 * Generates a `state` value. It is produced independently from the code
 * verifier so that leaking one never reveals the other.
 */
export function generateState(): string {
  return randomBase64Url(32);
}

/** Checks that a string is a syntactically valid `code_verifier`. */
export function isValidCodeVerifier(value: unknown): value is string {
  return typeof value === 'string' && CODE_VERIFIER_PATTERN.test(value);
}

/** SHA-256 digest of a UTF-8 string. */
export async function sha256(input: string): Promise<ArrayBuffer> {
  return crypto.subtle.digest('SHA-256', new TextEncoder().encode(input));
}

/** Derives the S256 `code_challenge` for a `code_verifier`. */
export async function createCodeChallenge(codeVerifier: string): Promise<string> {
  return base64UrlEncode(await sha256(codeVerifier));
}
