import { Component, input, inject } from '@angular/core';
import { ToastService } from '../core/notifications/toast.service';

@Component({
  selector: 'app-copy-button',
  standalone: true,
  template: `<button
    type="button"
    class="cp"
    [class.dark]="variant() === 'dark'"
    (click)="copy($event)"
    [attr.aria-label]="'Копировать ' + label()">
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <rect x="9" y="9" width="13" height="13" rx="2" ry="2"/>
      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
    </svg>
  </button>`,
  styles: [`
    .cp {
      width: 32px; height: 32px;
      display: inline-flex; align-items: center; justify-content: center;
      flex: 0 0 32px;
      border: none;
      border-radius: var(--rounded-pill);
      background: var(--color-surface-card);
      color: var(--color-ink);
      cursor: pointer;
      transition: background .15s ease, color .15s ease;
    }
    .cp:hover { background: var(--color-surface); }
    .cp.dark {
      background: rgba(255, 255, 255, .14);
      color: var(--color-on-dark, #fff);
    }
    .cp.dark:hover { background: rgba(255, 255, 255, .24); }
  `],
})
export class CopyButtonComponent {
  readonly value = input<string>('');
  readonly label = input<string>('');
  readonly variant = input<'light' | 'dark'>('light');
  private readonly toast = inject(ToastService);

  copy(ev: Event): void {
    ev.stopPropagation();
    const v = this.value();
    if (!v) return;
    if (typeof navigator !== 'undefined' && navigator.clipboard) {
      navigator.clipboard.writeText(v).then(() => this.toast.success('Скопировано'));
    }
  }
}
