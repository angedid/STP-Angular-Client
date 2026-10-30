import { ChangeDetectionStrategy, Component, inject, OnInit, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { ActivatedRoute, Router } from '@angular/router';
import { AuthService } from '../auth.service';

/** What the user is told while the callback is being processed. */
export type CallbackStatus = 'pending' | 'success' | 'error';

/**
 * Landing page of the OAuth redirect URI.
 *
 * Reads the query parameters once, hands them to {@link AuthService} and only
 * reports success after the token endpoint has actually answered. On failure
 * the user gets an explanation and a way to restart the sign-in.
 *
 * Reloading this page after a successful sign-in does not start a second
 * exchange: the session restored from storage is kept and the user is simply
 * taken to their page.
 */
@Component({
  selector: 'app-authorization-callback',
  imports: [MatButtonModule, MatProgressBarModule],
  templateUrl: './authorization-callback.component.html',
  styleUrl: './authorization-callback.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AuthorizationCallbackComponent implements OnInit {
  private readonly route = inject(ActivatedRoute);
  private readonly authService = inject(AuthService);
  private readonly router = inject(Router);

  protected readonly status = signal<CallbackStatus>('pending');
  protected readonly errorMessage = signal('');
  protected readonly restarting = signal(false);

  ngOnInit(): void {
    if (this.authService.isAuthenticated()) {
      this.status.set('success');
      void this.router.navigateByUrl('/home');
      return;
    }
    // The snapshot is read once on purpose: a callback URL is processed a
    // single time per page, whatever later query-parameter emissions happen.
    const params = this.route.snapshot.queryParamMap;
    void this.process({
      code: params.get('code'),
      state: params.get('state'),
      error: params.get('error'),
    });
  }

  /** Starts a brand-new sign-in after a failure. */
  protected async restart(): Promise<void> {
    this.restarting.set(true);
    try {
      await this.authService.startLogin();
    } catch {
      this.restarting.set(false);
      this.errorMessage.set('Sign-in could not be restarted. Please reload the page and try again.');
    }
  }

  private async process(params: {
    code: string | null;
    state: string | null;
    error: string | null;
  }): Promise<void> {
    const result = await this.authService.handleCallback(params);
    if (result.status === 'success') {
      this.status.set('success');
      await this.router.navigateByUrl(result.returnUrl ?? '/home');
      return;
    }
    this.errorMessage.set(result.message);
    this.status.set('error');
  }
}
