import { Injectable } from '@angular/core';

export type VendorStatus = 'a_jour' | 'en_retard';

export interface VendorSummary {
  readonly id: string;
  readonly name: string;
  readonly market: string;
  /** Outstanding credit in CFA francs. */
  readonly outstanding: number;
  readonly status: VendorStatus;
}

export interface DashboardOverview {
  /** Name of the wholesaler's establishment shown under the page title. */
  readonly establishment: string;
  /** Total outstanding credit across vendors, in CFA francs. */
  readonly totalOutstanding: number;
  readonly activeVendors: number;
  readonly lateAlerts: number;
  readonly recentVendors: readonly VendorSummary[];
}

/**
 * Placeholder figures used until the credit, repayment and return features
 * exist on the server. The names and markets are fictitious.
 */
export const PLACEHOLDER_OVERVIEW: DashboardOverview = {
  establishment: 'Établissements Rose Eyenga',
  totalOutstanding: 94_000,
  activeVendors: 6,
  lateAlerts: 2,
  recentVendors: [
    { id: 'v-001', name: 'Junior Fotso', market: 'Marché Mokolo', outstanding: 18_000, status: 'a_jour' },
    { id: 'v-002', name: 'Aïcha Moussa', market: 'Marché Mokolo', outstanding: 32_000, status: 'en_retard' },
    { id: 'v-003', name: 'Bertrand Nkeng', market: 'Marché Central', outstanding: 5_000, status: 'a_jour' },
    { id: 'v-004', name: 'Solange Talla', market: 'Marché Mokolo', outstanding: 12_000, status: 'a_jour' },
    { id: 'v-005', name: 'Michel Djoumessi', market: 'Marché Central', outstanding: 27_000, status: 'en_retard' },
  ],
};

/**
 * Provides the dashboard figures.
 *
 * There is no server endpoint for them yet, so this returns
 * {@link PLACEHOLDER_OVERVIEW}; replace the body of `getOverview` with the real
 * call when the API exists, the dashboard component will not need to change.
 */
@Injectable({ providedIn: 'root' })
export class DashboardService {
  getOverview(): DashboardOverview {
    return PLACEHOLDER_OVERVIEW;
  }
}
