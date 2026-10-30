import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatButtonToggleChange, MatButtonToggleModule } from '@angular/material/button-toggle';
import { MatIconModule } from '@angular/material/icon';
import { MatMenuModule } from '@angular/material/menu';
import { Router, RouterLink, RouterLinkActive } from '@angular/router';
import { AuthService } from '../auth.service';
import { ProfilePhotoComponent } from '../profile-photo/profile-photo.component';
import { Workspace, WorkspaceService } from '../workspace.service';

export interface SidebarLink {
  readonly label: string;
  readonly icon: string;
  readonly path: string;
}

export const SIDEBAR_LINKS: readonly SidebarLink[] = [
  { label: 'Tableau de bord', icon: 'home', path: '/home' },
  { label: 'Vendeurs', icon: 'group', path: '/vendors' },
  { label: 'Score portefeuille', icon: 'workspace_premium', path: '/eligibility' },
  { label: 'Alertes', icon: 'notifications', path: '/alerts' },
];

/**
 * Navigation column of the signed-in layout: brand, the user's photo and name
 * (which opens the account menu), the main sections and the "Espace" switch.
 *
 * The Logout entry only reports success once the server has revoked the
 * token; otherwise the user stays signed in and an error is shown here.
 */
@Component({
  selector: 'app-sidebar',
  imports: [
    MatButtonModule,
    MatButtonToggleModule,
    MatIconModule,
    MatMenuModule,
    RouterLink,
    RouterLinkActive,
    ProfilePhotoComponent,
  ],
  templateUrl: './sidebar.component.html',
  styleUrl: './sidebar.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SidebarComponent {
  private readonly authService = inject(AuthService);
  private readonly workspaceService = inject(WorkspaceService);
  private readonly router = inject(Router);

  protected readonly links = SIDEBAR_LINKS;
  protected readonly user = this.authService.user;
  protected readonly workspace = this.workspaceService.workspace;
  protected readonly loggingOut = signal(false);
  protected readonly logoutError = signal('');

  protected selectWorkspace(change: MatButtonToggleChange): void {
    this.workspaceService.select(change.value as Workspace);
  }

  protected async logout(): Promise<void> {
    if (this.loggingOut()) {
      return;
    }
    this.loggingOut.set(true);
    this.logoutError.set('');
    try {
      const result = await this.authService.logout();
      if (result.status === 'error') {
        this.logoutError.set(result.message);
        return;
      }
      await this.router.navigateByUrl('/');
    } finally {
      this.loggingOut.set(false);
    }
  }

  protected dismissLogoutError(): void {
    this.logoutError.set('');
  }
}
