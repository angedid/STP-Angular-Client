import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';

import { AuthService } from '../auth.service';
import { DashboardOverview, DashboardService } from '../dashboard.service';
import { TenantResult, TenantService } from '../tenant.service';
import { HomeComponent } from './home.component';

const OVERVIEW: DashboardOverview = {
  establishment: 'Établissements Test',
  totalOutstanding: 94_000,
  activeVendors: 6,
  lateAlerts: 2,
  recentVendors: [
    { id: 'a', name: 'Junior Fotso', market: 'Marché Mokolo', outstanding: 18_000, status: 'a_jour' },
    { id: 'b', name: 'Aïcha Moussa', market: 'Marché Mokolo', outstanding: 32_000, status: 'en_retard' },
  ],
};

describe('HomeComponent', () => {
  let fixture: ComponentFixture<HomeComponent>;
  const isAuthenticated = signal(false);
  let loadCurrentTenant: ReturnType<typeof vi.fn>;

  const element = (): HTMLElement => fixture.nativeElement as HTMLElement;
  const text = (): string => element().textContent ?? '';
  const texts = (selector: string): string[] =>
    Array.from(element().querySelectorAll(selector)).map((node) =>
      (node.textContent ?? '').replace(/\s+/g, ' ').trim(),
    );
  const settle = async (): Promise<void> => {
    await new Promise((resolve) => setTimeout(resolve, 0));
    await fixture.whenStable();
  };

  const createComponent = async (tenant: TenantResult): Promise<void> => {
    loadCurrentTenant = vi.fn().mockResolvedValue(tenant);
    await TestBed.configureTestingModule({
      imports: [HomeComponent],
      providers: [
        provideRouter([]),
        { provide: AuthService, useValue: { isAuthenticated } },
        { provide: TenantService, useValue: { loadCurrentTenant } },
        { provide: DashboardService, useValue: { getOverview: () => OVERVIEW } },
      ],
    }).compileComponents();
    fixture = TestBed.createComponent(HomeComponent);
    await settle();
  };

  beforeEach(() => {
    isAuthenticated.set(false);
  });

  it('invites visitors to sign in without loading anything', async () => {
    await createComponent({ status: 'success', tenant: { id: '1', name: 'Acme', fields: [] } });

    expect(text()).toContain('Not signed in');
    expect(element().querySelector('a[href="/login"]')).not.toBeNull();
    expect(loadCurrentTenant).not.toHaveBeenCalled();
  });

  it('shows the dashboard title with the tenant name as subtitle', async () => {
    isAuthenticated.set(true);
    await createComponent({ status: 'success', tenant: { id: '1', name: 'Acme Wholesale', fields: [] } });

    expect(element().querySelector('h1')?.textContent).toContain('Tableau de bord');
    expect(element().querySelector('.page-subtitle')?.textContent).toContain('Acme Wholesale');
  });

  it('falls back to the placeholder establishment when the tenant is unavailable', async () => {
    isAuthenticated.set(true);
    await createComponent({ status: 'error', reason: 'network_error', message: 'offline' });

    expect(element().querySelector('.page-subtitle')?.textContent).toContain('Établissements Test');
  });

  it('shows the key figures in French number format', async () => {
    isAuthenticated.set(true);
    await createComponent({ status: 'error', reason: 'not_found', message: 'none' });

    expect(texts('.kpi-label')).toEqual(['Encours total', 'Vendeurs actifs', 'Alertes de retard']);
    const values = texts('.kpi-value');
    expect(values[0].replace(/\u202f|\u00a0/g, ' ')).toBe('94 000 FCFA');
    expect(values[1]).toBe('6');
    expect(values[2]).toBe('2');
    expect(element().querySelector('.kpi-value-alert')).not.toBeNull();
  });

  it('lists recent vendors with market, amount and status', async () => {
    isAuthenticated.set(true);
    await createComponent({ status: 'error', reason: 'not_found', message: 'none' });

    expect(element().querySelector('.section-title')?.textContent).toContain('Vendeurs récents');
    expect(element().querySelector('a.new-credit')?.getAttribute('href')).toBe('/credits/new');
    expect(texts('.vendor-name')).toEqual(['Junior Fotso', 'Aïcha Moussa']);
    expect(texts('.vendor-market')).toEqual(['Marché Mokolo', 'Marché Mokolo']);
    expect(texts('.vendor-amount').map((v) => v.replace(/\u202f|\u00a0/g, ' '))).toEqual([
      '18 000 FCFA',
      '32 000 FCFA',
    ]);
    expect(texts('.status-chip')).toEqual(['À jour', 'En retard']);
    expect(element().querySelector('.status-en_retard')).not.toBeNull();
  });
});
