import { Routes } from '@angular/router';
import { LoginComponent } from './login/login.component';
import { RegisterComponent } from './register/register.component';
import { WelcomeComponent } from './welcome/welcome.component';
import { FourOFour } from './four-ofour/four-ofour';
import { HomeComponent } from './home/home.component';
import { AuthorizationCallbackComponent } from './authorization-callback/authorization-callback.component';
import { PlaceholderComponent } from './placeholder/placeholder.component';
import { TenantDetailComponent } from './tenant-detail/tenant-detail.component';
import { authGuard } from './auth.guard';

/** Screens reachable without a session. */
export const guestRoutes: Routes = [
  {
    path: '',
    component: WelcomeComponent,
    title: 'Welcome',
  },
  {
    path: 'login',
    component: LoginComponent,
    title: 'Login',
  },
  {
    path: 'register',
    component: RegisterComponent,
    title: 'Register',
  },
  {
    path: 'oauth/callback',
    component: AuthorizationCallbackComponent,
    title: 'Auth-Callback',
  },
];

/** Screens of the signed-in area, before access control is applied. */
const signedInScreens: Routes = [
  {
    path: 'home',
    component: HomeComponent,
    title: 'Home',
  },
  {
    path: 'profile',
    component: PlaceholderComponent,
    title: 'Profile',
  },
  {
    path: 'tenants',
    component: TenantDetailComponent,
    title: 'Tenant',
  },
  {
    path: 'eligibility',
    component: PlaceholderComponent,
    title: 'Eligibility',
  },
  {
    path: 'vendors',
    component: PlaceholderComponent,
    title: 'Vendeurs',
  },
  {
    path: 'alerts',
    component: PlaceholderComponent,
    title: 'Alertes',
  },
  {
    path: 'credits/new',
    component: PlaceholderComponent,
    title: 'Nouveau crédit',
  },
];

/**
 * Screens of the signed-in area. Each one is protected by {@link authGuard},
 * which sends visitors to `/login` and brings them back afterwards.
 */
export const authRoutes: Routes = signedInScreens.map((route) => ({
  ...route,
  canActivate: [authGuard],
}));

/**
 * Complete route table. The wildcard must stay last: a `**` entry placed
 * before `home` used to shadow it and show the 404 page instead.
 */
export const routes: Routes = [
  ...guestRoutes,
  ...authRoutes,
  {
    path: '**',
    component: FourOFour,
  },
];
