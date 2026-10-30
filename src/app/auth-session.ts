import { inject, Injectable } from '@angular/core';
import { AUTH_CONFIG } from './auth.config';
import { CLOCK } from './clock';
import { isExpiredAt, SessionTokens } from './token-response';

/** Identity of the signed-in user, as returned by the user-info endpoint. */
export interface UserProfile {
  /**
   * Full identifier, `{username}@{tenant_id}`, used verbatim in API paths such
   * as the logout URL. Never shown as is: see {@link displayName}.
   */
  readonly username: string;
  /**
   * Name shown in the interface: the server's `name`, or the username part of
   * the identifier (before the tenant UUID) when no name is provided.
   */
  readonly displayName: string;
  /** Absolute http(s) URL of the profile photo, or `null` when none is set. */
  readonly photoUrl: string | null;
}

/** Tokens and identity of the signed-in user. */
export interface AuthSession extends SessionTokens {
  readonly user: UserProfile;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

function isUserProfile(value: unknown): value is UserProfile {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  return (
    isNonEmptyString(candidate['username']) &&
    isNonEmptyString(candidate['displayName']) &&
    (candidate['photoUrl'] === null || isNonEmptyString(candidate['photoUrl']))
  );
}

/**
 * Checks that a value read from storage has exactly the shape of a session.
 * Anything else (tampered, truncated or produced by an older version of the
 * application) is rejected rather than trusted.
 */
export function isAuthSession(value: unknown): value is AuthSession {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  const expiresAt = candidate['expiresAt'];
  return (
    isNonEmptyString(candidate['accessToken']) &&
    isNonEmptyString(candidate['tokenType']) &&
    (candidate['refreshToken'] === null || isNonEmptyString(candidate['refreshToken'])) &&
    (expiresAt === null || (typeof expiresAt === 'number' && Number.isFinite(expiresAt))) &&
    isUserProfile(candidate['user'])
  );
}

/**
 * Persists the signed-in session of the current browser tab.
 *
 * `sessionStorage` is used on purpose: the session survives a reload and
 * in-tab navigation, stays confined to the tab that signed in, and is
 * discarded when the tab closes. Only the data needed to resume the session is
 * written; nothing is ever logged.
 */
@Injectable({ providedIn: 'root' })
export class AuthSessionStore {
  private readonly config = inject(AUTH_CONFIG);
  private readonly clock = inject(CLOCK);

  /** Stores the session, replacing any previous one. Throws if storage is unavailable. */
  save(session: AuthSession): void {
    this.storage().setItem(this.config.sessionStorageKey, JSON.stringify(session));
  }

  /** Removes the stored session, if any. Never throws. */
  clear(): void {
    try {
      this.storage().removeItem(this.config.sessionStorageKey);
    } catch {
      // Storage unavailable: there is nothing to remove.
    }
  }

  /**
   * Returns the stored session when it is well-formed and still usable: not
   * yet expired, or expired but renewable with a refresh token (the route
   * guard then renews or clears it). Otherwise removes whatever was stored and
   * returns `null`. Never throws.
   */
  load(): AuthSession | null {
    let raw: string | null;
    try {
      raw = this.storage().getItem(this.config.sessionStorageKey);
    } catch {
      return null;
    }
    if (raw === null) {
      return null;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      this.clear();
      return null;
    }
    if (
      !isAuthSession(parsed) ||
      (isExpiredAt(parsed.expiresAt, this.clock.now()) && parsed.refreshToken === null)
    ) {
      this.clear();
      return null;
    }
    return parsed;
  }

  private storage(): Storage {
    return globalThis.sessionStorage;
  }
}
