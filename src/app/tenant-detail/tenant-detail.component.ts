import { ChangeDetectionStrategy, Component, computed, inject, OnInit, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { RouterLink } from '@angular/router';
import { PageHeaderComponent } from '../page-header/page-header.component';
import { TenantDetails, TenantErrorReason, TenantService } from '../tenant.service';

export type TenantDetailStatus = 'loading' | 'success' | 'expired' | 'error';

const RETRYABLE_REASONS: readonly TenantErrorReason[] = [
  'network_error',
  'request_rejected',
  'invalid_response',
];

/**
 * Tenant Detail page (`/tenants`): shows the tenant of the signed-in user.
 *
 * An expired session is announced here while `authInterceptor` clears it and
 * sends the user back to the sign-in page; other failures are explained in
 * place.
 */
@Component({
  selector: 'app-tenant-detail',
  imports: [MatButtonModule, MatProgressBarModule, RouterLink, PageHeaderComponent],
  templateUrl: './tenant-detail.component.html',
  styleUrl: './tenant-detail.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TenantDetailComponent implements OnInit {
  private readonly tenantService = inject(TenantService);

  protected readonly status = signal<TenantDetailStatus>('loading');
  protected readonly tenant = signal<TenantDetails | null>(null);
  protected readonly errorMessage = signal('');
  protected readonly retryable = signal(false);
  protected readonly title = computed(() => {
    switch (this.status()) {
      case 'success':
        return this.tenant()?.name ?? 'Tenant';
      case 'expired':
        return 'Session expired';
      case 'error':
        return 'Tenant details unavailable';
      default:
        return 'Tenant';
    }
  });

  ngOnInit(): void {
    void this.load();
  }

  protected async load(): Promise<void> {
    this.status.set('loading');
    this.errorMessage.set('');

    const result = await this.tenantService.loadCurrentTenant();
    if (result.status === 'success') {
      this.tenant.set(result.tenant);
      this.status.set('success');
      return;
    }
    if (result.reason === 'session_expired') {
      this.status.set('expired');
      return;
    }
    this.errorMessage.set(result.message);
    this.retryable.set(RETRYABLE_REASONS.includes(result.reason));
    this.status.set('error');
  }
}
