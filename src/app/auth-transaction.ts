import { inject, Injectable } from '@angular/core';
import { AUTH_CONFIG } from './auth.config';
import { CLOCK } from './clock';
import { isValidCodeVerifier } from './pkce';

/**
 * Data kept between the redirect to the authorization server and the callback.
 *
 * It is stored in `sessionStorage`, so it is scoped to the browser tab and
 * discarded when the tab closes. It never contains tokens.
 */
export interface AuthTransaction {
  /** CSRF token sent as `state` and expected back unchanged. */
  readonly state: string;
  /** PKCE secret sent to the token endpoint together with the code. */
  readonly codeVerifier: string;
  /** Redirect URI used in the authorization request; must be repeated verbatim. */
  readonly redirectUri: string;
  /** Unix epoch milliseconds at which the transaction was created. */
  readonly createdAt: number;
  /** Unix epoch milliseconds after which the transaction must be rejected. */
  readonly expiresAt: number;
  /**
   * In-app path to open once signed in, when the sign-in was triggered by a
   * protected route. Always a same-origin path (see {@link isSafeReturnUrl}).
   */
  readonly returnUrl?: string;
}

/** Outcome of consuming the pending transaction. */
export type ConsumedTransaction =
  | { readonly kind: 'ok'; readonly transaction: AuthTransaction }
  | { readonly kind: 'missing' }
  | { readonly kind: 'malformed' }
  | { readonly kind: 'expired' };

const STATE_PATTERN = /^[A-Za-z0-9\-_]{16,256}$/;

/**
 * Accepts only in-app paths: a leading `/`, not `//` (protocol-relative) nor
 * `/\\`, so that a crafted `returnUrl` can never send the user to another site.
 */
export function isSafeReturnUrl(value: unknown): value is string {
  return typeof value === 'string' && /^\/(?![/\\])/.test(value) && value.length <= 2048;
}

function isAuthTransaction(value: unknown): value is AuthTransaction {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate['state'] === 'string' &&
    STATE_PATTERN.test(candidate['state']) &&
    isValidCodeVerifier(candidate['codeVerifier']) &&
    typeof candidate['redirectUri'] === 'string' &&
    candidate['redirectUri'].length > 0 &&
    typeof candidate['createdAt'] === 'number' &&
    Number.isFinite(candidate['createdAt']) &&
    typeof candidate['expiresAt'] === 'number' &&
    Number.isFinite(candidate['expiresAt']) &&
    (candidate['returnUrl'] === undefined || isSafeReturnUrl(candidate['returnUrl']))
  );
}

/**
 * Persists the single pending OAuth transaction of the current browser tab.
 *
 * Only one sign-in can be in progress per tab: saving a new transaction
 * replaces the previous one, and reading always removes it (`consume`), which
 * is what guarantees that a transaction is never exchanged twice.
 */
@Injectable({ providedIn: 'root' })
export class AuthTransactionStore {
  private readonly config = inject(AUTH_CONFIG);
  private readonly clock = inject(CLOCK);

  /** Stores the transaction, replacing any pending one. Throws if storage is unavailable. */
  save(transaction: AuthTransaction): void {
    this.storage().setItem(this.config.transactionStorageKey, JSON.stringify(transaction));
  }

  /** Removes the pending transaction, if any. Never throws. */
  clear(): void {
    try {
      this.storage().removeItem(this.config.transactionStorageKey);
    } catch {
      // Storage unavailable: there is nothing to remove.
    }
  }

  /**
   * Returns the pending transaction and removes it from storage, whatever its
   * validity, so that it can only be consumed once. Never throws.
   */
  consume(): ConsumedTransaction {
    let raw: string | null;
    try {
      raw = this.storage().getItem(this.config.transactionStorageKey);
    } catch {
      return { kind: 'missing' };
    }
    this.clear();

    if (raw === null) {
      return { kind: 'missing' };
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return { kind: 'malformed' };
    }
    if (!isAuthTransaction(parsed)) {
      return { kind: 'malformed' };
    }
    if (parsed.expiresAt <= this.clock.now()) {
      return { kind: 'expired' };
    }
    return { kind: 'ok', transaction: parsed };
  }

  private storage(): Storage {
    return globalThis.sessionStorage;
  }
}
