import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';

import { AuthService, UserProfile } from '../auth.service';
import { DEFAULT_AVATAR, ProfilePhotoComponent } from './profile-photo.component';

describe('ProfilePhotoComponent', () => {
  let fixture: ComponentFixture<ProfilePhotoComponent>;
  const user = signal<UserProfile | null>(null);

  const image = (): HTMLImageElement | null =>
    (fixture.nativeElement as HTMLElement).querySelector('img.profile-photo');

  beforeEach(async () => {
    user.set(null);
    await TestBed.configureTestingModule({
      imports: [ProfilePhotoComponent],
      providers: [{ provide: AuthService, useValue: { user } }],
    }).compileComponents();
    fixture = TestBed.createComponent(ProfilePhotoComponent);
    await fixture.whenStable();
  });

  it('renders nothing for visitors', () => {
    expect(image()).toBeNull();
  });

  it('shows the user photo with a descriptive alternative text', async () => {
    user.set({ username: 'jane', displayName: 'Jane Doe', photoUrl: 'https://cdn.test/jane.png' });
    await fixture.whenStable();

    expect(image()?.getAttribute('src')).toBe('https://cdn.test/jane.png');
    expect(image()?.getAttribute('alt')).toBe('Profile photo of Jane Doe');
  });

  it('shows the default avatar when the user has no photo', async () => {
    user.set({ username: 'jane', displayName: 'Jane Doe', photoUrl: null });
    await fixture.whenStable();

    expect(image()?.getAttribute('src')).toBe(DEFAULT_AVATAR);
  });

  it('falls back to the default avatar when the photo fails to load', async () => {
    user.set({ username: 'jane', displayName: 'Jane Doe', photoUrl: 'https://cdn.test/broken.png' });
    await fixture.whenStable();

    image()!.dispatchEvent(new Event('error'));
    await fixture.whenStable();

    expect(image()?.getAttribute('src')).toBe(DEFAULT_AVATAR);
  });

  it('disappears again after logout', async () => {
    user.set({ username: 'jane', displayName: 'Jane Doe', photoUrl: null });
    await fixture.whenStable();
    user.set(null);
    await fixture.whenStable();

    expect(image()).toBeNull();
  });
});
