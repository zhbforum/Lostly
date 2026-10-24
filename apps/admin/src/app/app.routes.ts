import { Routes } from '@angular/router';
import { adminGuard } from './api';
import { Dashboard } from './dashboard';
import { Login } from './login';
import { Records } from './records';
import { Entity } from './entity';
import { CaseQueue } from './case-queue';
import { CaseDetail } from './case-detail';
import { Audit } from './audit';

export const routes: Routes = [
  { path: 'login', component: Login, title: 'Sign in · Lostly Admin' },
  { path: '', component: Dashboard, canActivate: [adminGuard], title: 'Dashboard · Lostly Admin' },
  { path: 'cases', component: CaseQueue, canActivate: [adminGuard], title: 'Cases · Lostly Admin' },
  {
    path: 'cases/:id',
    component: CaseDetail,
    canActivate: [adminGuard],
    title: 'Case · Lostly Admin',
  },
  { path: 'audit', component: Audit, canActivate: [adminGuard], title: 'Audit · Lostly Admin' },
  ...(['listings', 'users', 'claims'] as const).map((resource) => ({
    path: resource + '/:id',
    component: Entity,
    canActivate: [adminGuard],
    data: { resource },
    title: resource + ' · Lostly Admin',
  })),
  ...(['listings', 'users', 'claims'] as const).map((resource) => ({
    path: resource,
    component: Records,
    canActivate: [adminGuard],
    data: { resource },
    title: resource + ' · Lostly Admin',
  })),
  { path: '**', redirectTo: '' },
];
