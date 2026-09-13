import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { AdminApi, errorMessage } from './api';

@Component({
  imports: [FormsModule],
  template: `
    <section class="panel login">
      <p class="eyebrow">Lostly / Administration</p>
      <h1>Sign in</h1>
      <p>Use your administrator account to review reports and claims.</p>
      @if (error()) {
        <p class="error" role="alert">{{ error() }}</p>
      }
      <form (ngSubmit)="submit()" #form="ngForm">
        <label for="email">Email</label>
        <input
          id="email"
          name="email"
          type="email"
          autocomplete="username"
          required
          email
          maxlength="254"
          [(ngModel)]="email"
        />
        <label for="password">Password</label>
        <input
          id="password"
          name="password"
          type="password"
          autocomplete="current-password"
          required
          maxlength="128"
          [(ngModel)]="password"
        />
        <button type="submit" [disabled]="busy() || form.invalid">
          {{ busy() ? 'Signing in…' : 'Sign in' }}
        </button>
      </form>
    </section>
  `,
})
export class Login {
  private readonly api = inject(AdminApi);
  private readonly router = inject(Router);
  private readonly reason = inject(ActivatedRoute).snapshot.queryParamMap.get('reason');
  readonly error = signal(
    this.reason === 'forbidden'
      ? 'This account does not have administrator access.'
      : this.reason === 'unavailable'
        ? 'Cannot check your session. Retry signing in when the server is available.'
        : this.reason === 'expired'
          ? 'Please sign in to continue.'
          : '',
  );
  readonly busy = signal(false);
  email = '';
  password = '';

  async submit() {
    if (this.busy()) return;
    this.busy.set(true);
    this.error.set('');
    try {
      const user = await this.api.login({ email: this.email.trim(), password: this.password });
      this.password = '';
      if (user.role !== 'admin') this.error.set('This account does not have administrator access.');
      else await this.router.navigateByUrl('/');
    } catch (error) {
      this.error.set(errorMessage(error));
    } finally {
      this.busy.set(false);
    }
  }
}
