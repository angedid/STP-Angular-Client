import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { AuthService } from '../auth.service';

/** Path of the avatar shown when the user has no photo or it cannot be loaded. */
export const DEFAULT_AVATAR = 'images/default-avatar.svg';

/**
 * Profile photo of the signed-in user. Renders nothing for visitors and falls
 * back to a default avatar when no photo is available or it fails to load.
 */
@Component({
  selector: 'app-profile-photo',
  template: `
    @if (user(); as user) {
      <img
        class="profile-photo"
        width="96"
        height="96"
        [src]="photoSrc()"
        [alt]="'Profile photo of ' + user.displayName"
        (error)="useDefaultAvatar()"
      />
    }
  `,
  styles: `
    /* Size can be adjusted by a parent through --profile-photo-size. */
    .profile-photo {
      display: block;
      width: var(--profile-photo-size, 96px);
      height: var(--profile-photo-size, 96px);
      border-radius: 50%;
      object-fit: cover;
      background-color: #f3f3f3;
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ProfilePhotoComponent {
  private readonly authService = inject(AuthService);
  private readonly failedPhotoUrl = signal<string | null>(null);

  protected readonly user = this.authService.user;
  protected readonly photoSrc = computed(() => {
    const photoUrl = this.user()?.photoUrl ?? null;
    return photoUrl === null || photoUrl === this.failedPhotoUrl() ? DEFAULT_AVATAR : photoUrl;
  });

  protected useDefaultAvatar(): void {
    this.failedPhotoUrl.set(this.user()?.photoUrl ?? null);
  }
}
