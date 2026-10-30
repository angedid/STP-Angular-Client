import { InjectionToken } from '@angular/core';

/**
 * Source of the current time, in Unix epoch milliseconds.
 *
 * Everything that reasons about expiry (token expiry, transaction validity,
 * stored-session validity) reads the time through this interface, so that
 * tests can place themselves at an exact instant instead of racing the wall
 * clock.
 */
export interface Clock {
  now(): number;
}

/** The wall clock. */
export const SYSTEM_CLOCK: Clock = {
  now: () => Date.now(),
};

/** Injection token resolving to the active {@link Clock}; defaults to the wall clock. */
export const CLOCK = new InjectionToken<Clock>('CLOCK', {
  providedIn: 'root',
  factory: () => SYSTEM_CLOCK,
});
