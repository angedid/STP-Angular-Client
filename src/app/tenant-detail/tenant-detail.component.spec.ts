import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';

import { TenantResult, TenantService } from '../tenant.service';
import { TenantDetailComponent } from './tenant-detail.component';

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}

describe('TenantDetailComponent', () => {
  let fixture: ComponentFixture<TenantDetailComponent>;
  let router: Router;
  let load: Deferred<TenantResult>;
  let tenantService: { loadCurrentTenant: ReturnType<typeof vi.fn> };

  const element = (): HTMLElement => fixture.nativeElement as HTMLElement;
  const text = (): string => element().textContent ?? '';
  const settle = async (): Promise<void> => {
    await new Promise((resolve) => setTimeout(resolve, 0));
    await fixture.whenStable();
  };

  beforeEach(async () => {
    load = deferred<TenantResult>();
    tenantService = { loadCurrentTenant: vi.fn().mockReturnValue(load.promise) };
    await TestBed.configureTestingModule({
      imports: [TenantDetailComponent],
      providers: [provideRouter([]), { provide: TenantService, useValue: tenantService }],
    }).compileComponents();
    router = TestBed.inject(Router);
    vi.spyOn(router, 'navigateByUrl').mockResolvedValue(true);
    fixture = TestBed.createComponent(TenantDetailComponent);
    await fixture.whenStable();
  });

  it('shows a loading state until the tenant arrives', async () => {
    await settle();

    expect(tenantService.loadCurrentTenant).toHaveBeenCalledTimes(1);
    expect(text()).toContain('Loading tenant details');
    expect(element().querySelector('mat-progress-bar')).not.toBeNull();
    expect(element().querySelector('[role="status"]')).not.toBeNull();
  });

  it('displays the tenant name and every returned field', async () => {
    load.resolve({
      status: 'success',
      tenant: {
        id: '1',
        name: 'Acme Wholesale',
        fields: [
          { label: 'Id', value: '1' },
          { label: 'Name', value: 'Acme Wholesale' },
          { label: 'Country code', value: 'CM' },
        ],
      },
    });
    await settle();

    expect(element().querySelector('h1')?.textContent).toContain('Acme Wholesale');
    const terms = Array.from(element().querySelectorAll('dt')).map((dt) => dt.textContent?.trim());
    const values = Array.from(element().querySelectorAll('dd')).map((dd) => dd.textContent?.trim());
    expect(terms).toEqual(['Id', 'Name', 'Country code']);
    expect(values).toEqual(['1', 'Acme Wholesale', 'CM']);
    expect(text()).not.toContain('Loading tenant details');
  });

  it('says so when the server returned no fields', async () => {
    load.resolve({ status: 'success', tenant: { id: null, name: null, fields: [] } });
    await settle();

    expect(element().querySelector('h1')?.textContent).toContain('Tenant');
    expect(text()).toContain('returned no details');
  });

  it('announces an expired session and leaves the redirect to the interceptor', async () => {
    load.resolve({ status: 'error', reason: 'session_expired', message: 'Your session has expired.' });
    await settle();

    expect(text()).toContain('Session expired');
    expect(text()).toContain('Taking you to the sign-in page');
    expect(element().querySelector('[role="alert"]')).toBeNull();
    expect(element().querySelector('button.tenant-retry')).toBeNull();
    expect(router.navigateByUrl).not.toHaveBeenCalled();
  });

  it('shows a non-retryable error for an invalid identifier', async () => {
    load.resolve({
      status: 'error',
      reason: 'invalid_tenant_id',
      message: 'Your account identifier does not contain a valid tenant identifier (UUID expected).',
    });
    await settle();

    expect(element().querySelector('[role="alert"]')?.textContent).toContain('UUID expected');
    expect(element().querySelector('button.tenant-retry')).toBeNull();
    expect(element().querySelector('a.tenant-home')).not.toBeNull();
    expect(router.navigateByUrl).not.toHaveBeenCalled();
  });

  it('offers to retry after a network failure', async () => {
    load.resolve({ status: 'error', reason: 'network_error', message: 'The server could not be reached.' });
    await settle();
    expect(element().querySelector('[role="alert"]')?.textContent).toContain('could not be reached');

    const second = deferred<TenantResult>();
    tenantService.loadCurrentTenant.mockReturnValue(second.promise);
    element().querySelector<HTMLButtonElement>('button.tenant-retry')!.click();
    await settle();
    expect(text()).toContain('Loading tenant details');

    second.resolve({ status: 'success', tenant: { id: '1', name: 'Acme', fields: [] } });
    await settle();
    expect(tenantService.loadCurrentTenant).toHaveBeenCalledTimes(2);
    expect(element().querySelector('h1')?.textContent).toContain('Acme');
  });
});
