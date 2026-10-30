import { Clock } from '../clock';

/** A clock that only moves when a test tells it to. */
export class FakeClock implements Clock {
  constructor(private current: number) {}

  now(): number {
    return this.current;
  }

  /** Moves the clock to an absolute instant (epoch milliseconds). */
  set(instant: number): void {
    this.current = instant;
  }

  /** Moves the clock forward (or backward with a negative value). */
  advance(milliseconds: number): void {
    this.current += milliseconds;
  }
}
