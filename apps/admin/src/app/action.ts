import { Component, input, output, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { AdminApi, errorMessage } from './api';

@Component({
  selector: 'app-action',
  imports: [FormsModule],
  template: `<details class="panel">
    <summary>{{ label() }}</summary>
    <p>{{ description() }}</p>
    <form (ngSubmit)="submit()">
      <label
        >Internal reason<textarea
          name="reason"
          [(ngModel)]="reason"
          required
          minlength="3"
          maxlength="500"
          [disabled]="busy()"
        ></textarea>
      </label>
      @if (publicMessage()) {
        <label
          >Message to affected user<textarea
            name="publicReason"
            [(ngModel)]="publicReason"
            maxlength="1000"
            [disabled]="busy()"
          ></textarea>
        </label>
      }
      <button type="submit" [disabled]="busy() || reason.trim().length < 3">
        {{ busy() ? 'Saving…' : label() }}
      </button>
      @if (error()) {
        <p class="error" role="alert">{{ error() }}</p>
      }
      @if (notice()) {
        <p role="status">{{ notice() }}</p>
      }
    </form>
  </details>`,
})
export class Action {
  private readonly api = inject(AdminApi);
  readonly endpoint = input.required<string>();
  readonly label = input.required<string>();
  readonly description = input('Every action is recorded in the audit log.');
  readonly payload = input<Record<string, unknown>>({});
  readonly publicMessage = input(true);
  readonly changed = output<void>();
  readonly busy = signal(false);
  readonly error = signal('');
  readonly notice = signal('');
  reason = '';
  publicReason = '';
  async submit() {
    if (this.busy() || this.reason.trim().length < 3) return;
    this.busy.set(true);
    this.error.set('');
    this.notice.set('');
    try {
      await this.api.request(this.endpoint(), {
        ...this.payload(),
        reason: this.reason.trim(),
        ...(this.publicMessage() && this.publicReason.trim()
          ? { publicReason: this.publicReason.trim() }
          : {}),
      });
      this.reason = '';
      this.publicReason = '';
      this.notice.set('Saved.');
      this.changed.emit();
    } catch (error) {
      this.error.set(errorMessage(error));
    } finally {
      this.busy.set(false);
    }
  }
}
