import { ChangeDetectionStrategy, Component, computed, inject, OnInit, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { RouterLink } from '@angular/router';
import { AuthService } from '../auth.service';
import { DashboardService, VendorStatus } from '../dashboard.service';
import { FcfaPipe } from '../fcfa.pipe';
import { PageHeaderComponent } from '../page-header/page-header.component';
import { TenantService } from '../tenant.service';

const STATUS_LABELS: Record<VendorStatus, string> = {
  a_jour: 'À jour',
  en_retard: 'En retard',
};

/**
 * Wholesaler dashboard ("Tableau de bord"): key figures and recent vendors.
 *
 * The figures come from `DashboardService`, which still serves placeholder
 * data; the establishment name is the tenant's name when the tenant API
 * answers, and the placeholder otherwise.
 */
@Component({
  selector: 'app-home',
  imports: [MatButtonModule, MatIconModule, RouterLink, FcfaPipe, PageHeaderComponent],
  templateUrl: './home.component.html',
  styleUrl: './home.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class HomeComponent implements OnInit {
  private readonly authService = inject(AuthService);
  private readonly tenantService = inject(TenantService);
  private readonly dashboardService = inject(DashboardService);

  protected readonly isAuthenticated = this.authService.isAuthenticated;
  protected readonly overview = this.dashboardService.getOverview();
  private readonly tenantName = signal<string | null>(null);
  protected readonly establishment = computed(
    () => this.tenantName() ?? this.overview.establishment,
  );

  ngOnInit(): void {
    if (this.isAuthenticated()) {
      void this.loadTenantName();
    }
  }

  protected statusLabel(status: VendorStatus): string {
    return STATUS_LABELS[status];
  }

  private async loadTenantName(): Promise<void> {
    const result = await this.tenantService.loadCurrentTenant();
    if (result.status === 'success' && result.tenant.name !== null) {
      this.tenantName.set(result.tenant.name);
    }
  }
}
