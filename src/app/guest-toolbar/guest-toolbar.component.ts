import { ChangeDetectionStrategy, Component } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatToolbarModule } from '@angular/material/toolbar';
import { RouterLink } from '@angular/router';

/**
 * Top navigation bar of the public pages. Signed-in users get the sidebar
 * layout instead (see `SidebarComponent`), which hosts the account menu.
 */
@Component({
  selector: 'app-guest-toolbar',
  templateUrl: './guest-toolbar.component.html',
  imports: [MatToolbarModule, MatIconModule, MatButtonModule, RouterLink],
  styleUrl: './guest-toolbar.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class GuestToolbarComponent {}
