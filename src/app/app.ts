import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { AuthService } from './auth.service';
import { GuestToolbarComponent } from './guest-toolbar/guest-toolbar.component';
import { SidebarComponent } from './sidebar/sidebar.component';

/**
 * Application shell. Visitors get the public toolbar above the content;
 * signed-in users get the sidebar layout (navigation column + main area).
 */
@Component({
  selector: 'app-root',
  imports: [RouterOutlet, GuestToolbarComponent, SidebarComponent],
  templateUrl: './app.html',
  styleUrl: './app.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class App {
  protected readonly title = signal('asso-angular-client');
  protected readonly isAuthenticated = inject(AuthService).isAuthenticated;
}
