import { Component, inject } from '@angular/core';
import { ToastService } from '../../core/notifications/toast.service';

@Component({
  selector: 'app-toasts',
  standalone: true,
  template: `<div class="toasts">
    @for (t of toasts(); track t.id) {
      <div class="toast" [attr.data-kind]="t.kind">{{ t.text }}</div>
    }
  </div>`,
  styles: [`
    .toasts { position: fixed; bottom: 80px; left: 0; right: 0; display: flex; flex-direction: column; align-items: center; gap: 8px; pointer-events: none; z-index: 1100; }
    .toast {
      max-width: 90%; padding: 10px 16px;
      background: var(--color-surface-dark); color: var(--color-on-dark);
      border-radius: var(--rounded-md); font-size: 14px;
      box-shadow: 0 4px 16px rgba(0,0,0,.18);
      animation: toast-in .3s var(--ease-spring) both;
    }
    @keyframes toast-in { from { opacity: 0; transform: translateY(10px) scale(.97); } }
    .toast[data-kind="error"] { background: var(--color-error); }
    .toast[data-kind="success"] { background: var(--color-success); }
  `],
})
export class ToastsView {
  protected readonly toasts = inject(ToastService).toasts;
}
