import { TestBed } from '@angular/core/testing';

import { CLOCK, SYSTEM_CLOCK } from './clock';
import { FakeClock } from './testing/fake-clock';

describe('CLOCK', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('defaults to the wall clock', () => {
    vi.spyOn(Date, 'now').mockReturnValue(123_456);

    TestBed.configureTestingModule({});
    const clock = TestBed.inject(CLOCK);

    expect(clock).toBe(SYSTEM_CLOCK);
    expect(clock.now()).toBe(123_456);
  });

  it('can be replaced by a fake clock for tests', () => {
    const fake = new FakeClock(1_000);
    TestBed.configureTestingModule({ providers: [{ provide: CLOCK, useValue: fake }] });

    expect(TestBed.inject(CLOCK).now()).toBe(1_000);
  });
});

describe('FakeClock', () => {
  it('only moves when told to', () => {
    const clock = new FakeClock(1_000);

    expect(clock.now()).toBe(1_000);
    expect(clock.now()).toBe(1_000);

    clock.advance(250);
    expect(clock.now()).toBe(1_250);

    clock.set(5);
    expect(clock.now()).toBe(5);

    clock.advance(-5);
    expect(clock.now()).toBe(0);
  });
});
