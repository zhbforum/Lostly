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
  private sessionGeneration = 0;

  async request<T>(path: string, body?: unknown): Promise<T> {
    const generation = this.sessionGeneration;
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
        generation === this.sessionGeneration &&
        error instanceof HttpErrorResponse &&
        (error.status === 401 ||
          (error.status === 403 &&
            !['CASE_ASSIGNED', 'OWNER_MANAGED_ACCOUNT', 'CASE_SCOPE_MISMATCH'].includes(
              error.error?.error?.code,
            )))
      ) {
        this.sessionGeneration++;
        this.user.set(null);
        void this.router.navigate(['/login'], {
          queryParams: {
            reason: error.status === 403 ? 'forbidden' : 'expired',
            returnUrl: adminReturnUrl(this.router.url),
          },
        });
      }
      throw error;
    }
  }

  async restore() {
    const generation = this.sessionGeneration;
    try {
      const { user } = await this.request<AuthResponse>('/auth/me');
      if (generation === this.sessionGeneration) this.user.set(user);
      return user;
    } catch (error) {
      if (generation === this.sessionGeneration) this.user.set(null);
      throw error;
    }
  }

  async login(input: LoginInput) {
    const generation = ++this.sessionGeneration;
    const { user } = await this.request<AuthResponse>('/auth/login', input);
    if (generation === this.sessionGeneration) this.user.set(user);
    return user;
  }

  async logout() {
    const generation = ++this.sessionGeneration;
    await this.request('/auth/logout', {});
    if (generation !== this.sessionGeneration) return;
    this.user.set(null);
    await this.router.navigateByUrl('/login');
  }
}

export function adminReturnUrl(value: string | null | undefined) {
  return value &&
    /^\/(?:(?:listings|users|claims|cases)(?:\/[0-9a-f-]{36})?|audit)?(?:\?[^#]*)?(?:#.*)?$/.test(
      value,
    )
    ? value
    : '/';
}

export const adminGuard: CanActivateFn = async (_, state) => {
  const api = inject(AdminApi);
  const router = inject(Router);
  try {
    return (
      (await api.restore()).role === 'admin' ||
      router.createUrlTree(['/login'], {
        queryParams: { reason: 'forbidden', returnUrl: adminReturnUrl(state.url) },
      })
    );
  } catch (error) {
    return router.createUrlTree(['/login'], {
      queryParams: {
        reason:
          error instanceof HttpErrorResponse && error.status === 401 ? 'expired' : 'unavailable',
        returnUrl: adminReturnUrl(state.url),
      },
    });
  }
};

export function errorMessage(error: unknown): string {
  if (error instanceof HttpErrorResponse) {
    if (error.status === 0) return 'Cannot reach the server. Check your connection and retry.';
    if (error.status === 401) return 'Sign in again. Check your email and password.';
    if (error.status === 403)
      return error.error?.error?.code === 'CASE_ASSIGNED'
        ? 'This case is assigned to another administrator.'
        : error.error?.error?.code === 'OWNER_MANAGED_ACCOUNT'
          ? 'Administrator accounts are managed by project owners.'
          : 'This action is not permitted for this account or case.';
    if (error.status === 404) return 'This record is no longer available. Refresh the list.';
    if (error.status === 410)
      return 'Historical evidence has expired or was not retained for this decision.';
    if (error.status === 400)
      return 'This page link is no longer valid. Reset the filters to start again.';
    if (error.status === 409) return 'This record changed. Refresh the list before trying again.';
    if (error.status === 422) return 'Check the form fields and try again.';
    if (error.status === 429) return 'Too many requests. Wait a minute before trying again.';
    if (error.status >= 500) return 'The server is temporarily unavailable. Please retry.';
  }
  return 'The request failed. Please retry.';
}
