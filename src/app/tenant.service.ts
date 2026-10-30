import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { AUTH_CONFIG } from './auth.config';
import { AuthService } from './auth.service';
import { parseUserIdentifier } from './user-identifier';

/** One displayable property of the tenant. */
export interface TenantField {
  readonly label: string;
  readonly value: string;
}

/** Tenant information as returned by the API, prepared for display. */
export interface TenantDetails {
  readonly id: string | null;
  readonly name: string | null;
  /** Every top-level property of the payload, in the order returned. */
  readonly fields: readonly TenantField[];
}

export type TenantErrorReason =
  | 'not_signed_in'
  | 'malformed_identifier'
  | 'invalid_tenant_id'
  | 'session_expired'
  | 'not_found'
  | 'request_rejected'
  | 'network_error'
  | 'invalid_response';

export interface TenantError {
  readonly status: 'error';
  readonly reason: TenantErrorReason;
  readonly message: string;
}

export type TenantResult = { readonly status: 'success'; readonly tenant: TenantDetails } | TenantError;

/**
 * Loads the tenant of the signed-in user.
 *
 * The tenant UUID is taken from the user identifier (`{username}@{tenant_id}`)
 * and validated before any request is sent. The access token, its expiry and
 * `401` answers are handled by `authInterceptor`, which ends the session and
 * redirects to sign-in; this service only reports `session_expired` so that
 * the page can say so.
 */
@Injectable({ providedIn: 'root' })
export class TenantService {
  private readonly http = inject(HttpClient);
  private readonly config = inject(AUTH_CONFIG);
  private readonly authService = inject(AuthService);

  /** Resolves with the outcome; never rejects. */
  async loadCurrentTenant(): Promise<TenantResult> {
    const session = this.authService.getSession();
    if (session === null) {
      return error('not_signed_in', 'Sign in to see your tenant.');
    }

    const parsed = parseUserIdentifier(session.user.username);
    if (parsed.kind === 'malformed') {
      return error(
        'malformed_identifier',
        'Your account identifier is not in the expected "username@tenant" format, so the tenant cannot be determined.',
      );
    }
    if (parsed.kind === 'invalid_tenant_id') {
      return error(
        'invalid_tenant_id',
        'Your account identifier does not contain a valid tenant identifier (UUID expected).',
      );
    }

    const url = `${this.config.tenantsEndpoint}/${encodeURIComponent(parsed.identifier.tenantId)}`;
    let response: unknown;
    try {
      response = await firstValueFrom(
        this.http.get<unknown>(url, { headers: { Accept: 'application/json' } }),
      );
    } catch (failure) {
      return describeFailure(failure);
    }

    const tenant = parseTenant(response);
    if (tenant === null) {
      return error('invalid_response', 'The server returned tenant data that could not be read.');
    }
    return { status: 'success', tenant };
  }
}

function error(reason: TenantErrorReason, message: string): TenantError {
  return { status: 'error', reason, message };
}

function sessionExpired(): TenantError {
  return error('session_expired', 'Your session has expired. Please sign in again.');
}

function describeFailure(failure: unknown): TenantError {
  if (!(failure instanceof HttpErrorResponse)) {
    return error('request_rejected', 'The tenant could not be loaded because of an unexpected error.');
  }
  switch (failure.status) {
    case 0:
      return error(
        'network_error',
        'The server could not be reached. Check your connection and try again.',
      );
    case 401:
      return sessionExpired();
    case 403:
      return error('request_rejected', 'You are not allowed to view this tenant.');
    case 404:
      return error('not_found', 'No tenant matches your account identifier.');
    default:
      return error(
        'request_rejected',
        `The server could not provide the tenant details (HTTP ${failure.status}). Please try again.`,
      );
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Accepts either the tenant object itself or a `{ "data": { ... } }` envelope.
 * Every top-level property is kept for display; `id` and `name` are also
 * extracted when they are strings or numbers.
 */
function parseTenant(response: unknown): TenantDetails | null {
  if (!isPlainObject(response)) {
    return null;
  }
  const body = isPlainObject(response['data']) ? response['data'] : response;

  const fields = Object.entries(body).map(([key, value]) => ({
    label: humanize(key),
    value: formatValue(value),
  }));
  return {
    id: scalarText(body['id']),
    name: scalarText(body['name']),
    fields,
  };
}

function scalarText(value: unknown): string | null {
  if (typeof value === 'string') {
    return value.trim().length > 0 ? value : null;
  }
  return typeof value === 'number' && Number.isFinite(value) ? String(value) : null;
}

function formatValue(value: unknown): string {
  if (value === null || value === undefined || value === '') {
    return '—';
  }
  if (typeof value === 'string') {
    return value;
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return '—';
  }
}

/** `created_at` → `Created at`, `tenantName` → `Tenant name`. */
function humanize(key: string): string {
  const spaced = key
    .replace(/[_-]+/g, ' ')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .trim()
    .toLowerCase();
  return spaced.length === 0 ? key : spaced.charAt(0).toUpperCase() + spaced.slice(1);
}
