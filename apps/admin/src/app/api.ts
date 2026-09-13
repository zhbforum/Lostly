import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { inject, Injectable, signal } from '@angular/core';
import { Router, type CanActivateFn } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import type { AuthResponse, AuthUser, LoginInput } from '@lostly/contracts/auth';

@Injectable({ providedIn: 'root' })
export class AdminApi {
  private readonly http = inject(HttpClient);
  private readonly router = inject(Router);
  readonly user = signal<AuthUser | null>(null);

  async request<T>(path: string, body?: unknown): Promise<T> {
    try {
      return await firstValueFrom(
        this.http.request<T>(body === undefined ? 'GET' : 'POST', '/api' + path, {
          body,
          withCredentials: true,
          headers: body === undefined ? {} : { 'X-CSRF-Protection': '1' },
        }),
      );
    } catch (error) {
      if (
        path.startsWith('/admin/') &&
        error instanceof HttpErrorResponse &&
        [401, 403].includes(error.status)
      ) {
        this.user.set(null);
        void this.router.navigate(['/login'], {
          queryParams: { reason: error.status === 403 ? 'forbidden' : 'expired' },
        });
      }
      throw error;
    }
  }

  async restore() {
    const { user } = await this.request<AuthResponse>('/auth/me');
    this.user.set(user);
    return user;
  }

  async login(input: LoginInput) {
    const { user } = await this.request<AuthResponse>('/auth/login', input);
    this.user.set(user);
    return user;
  }

  async logout() {
    await this.request('/auth/logout', {});
    this.user.set(null);
    await this.router.navigateByUrl('/login');
  }
}

export const adminGuard: CanActivateFn = async () => {
  const api = inject(AdminApi);
  const router = inject(Router);
  try {
    return (
      (await api.restore()).role === 'admin' ||
      router.createUrlTree(['/login'], { queryParams: { reason: 'forbidden' } })
    );
  } catch (error) {
    api.user.set(null);
    return router.createUrlTree(['/login'], {
      queryParams: {
        reason:
          error instanceof HttpErrorResponse && error.status === 401 ? 'expired' : 'unavailable',
      },
    });
  }
};

export function errorMessage(error: unknown): string {
  if (error instanceof HttpErrorResponse) {
    if (error.status === 0) return 'Cannot reach the server. Check your connection and retry.';
    if (error.status === 401) return 'Sign in again. Check your email and password.';
    if (error.status === 403) return 'Administrator access is required.';
    if (error.status === 409) return 'This record changed. Refresh the list before trying again.';
    if (error.status === 422) return 'Check the form fields and try again.';
  }
  return 'The request failed. Please retry.';
}
