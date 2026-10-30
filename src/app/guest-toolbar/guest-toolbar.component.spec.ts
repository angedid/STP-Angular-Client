import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';

import { GuestToolbarComponent } from './guest-toolbar.component';

describe('GuestToolbarComponent', () => {
  let component: GuestToolbarComponent;
  let fixture: ComponentFixture<GuestToolbarComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [GuestToolbarComponent],
      providers: [provideRouter([])],
    }).compileComponents();

    fixture = TestBed.createComponent(GuestToolbarComponent);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('shows the registration and sign-in links', () => {
    const element = fixture.nativeElement as HTMLElement;
    expect(element.querySelector('a.register-link')?.textContent).toContain("S'enregistrer");
    expect(element.querySelector('a.login-link')?.textContent).toContain('Connexion');
  });
});
