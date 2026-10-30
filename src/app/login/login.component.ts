import { ChangeDetectionStrategy, Component, inject, OnInit, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { ActivatedRoute } from '@angular/router';
import { AuthService } from '../auth.service';

/**
 * Sign-in entry point: prepares the PKCE transaction and redirects the browser
 * to the authorization server. If that preparation fails (for example because
 * browser storage is unavailable), the user is told and can try again.
 *
 * An optional `returnUrl` query parameter (set by the route guard) names the
 * in-app page to open once signed in; `AuthService` ignores unsafe values.
 */
@Component({
  selector: 'app-login',
  imports: [MatButtonModule, MatProgressBarModule],
  templateUrl: './login.component.html',
  styleUrl: './login.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class LoginComponent implements OnInit {
  private readonly authService = inject(AuthService);
  private readonly returnUrl = inject(ActivatedRoute).snapshot.queryParamMap.get('returnUrl');

  protected readonly status = signal<'redirecting' | 'error'>('redirecting');
  protected readonly errorMessage = signal('');

  ngOnInit(): void {
    void this.start();
  }

  protected async start(): Promise<void> {
    this.status.set('redirecting');
    try {
      await this.authService.startLogin(this.returnUrl);
    } catch {
      this.errorMessage.set(
        'Sign-in could not be started. Check that your browser allows session storage, then try again.',
      );
      this.status.set('error');
    }
  }
}
