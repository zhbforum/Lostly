import { Routes } from '@angular/router';
import { adminGuard } from './api';
import { Dashboard } from './dashboard';
import { Login } from './login';
import { Records } from './records';

export const routes: Routes = [
  { path: 'login', component: Login, title: 'Sign in · Lostly Admin' },
  { path: '', component: Dashboard, canActivate: [adminGuard], title: 'Dashboard · Lostly Admin' },
  ...(['listings', 'users', 'claims'] as const).map((resource) => ({
    path: resource,
    component: Records,
    canActivate: [adminGuard],
    data: { resource },
    title: resource + ' · Lostly Admin',
  })),
  { path: '**', redirectTo: '' },
];
