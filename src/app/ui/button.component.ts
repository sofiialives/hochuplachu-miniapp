import { Component, input, output } from '@angular/core';

@Component({
  selector: 'app-button',
  standalone: true,
  host: { '[class.full]': 'full()' },
  // Сознательно эмитим именно (clicked), а не полагаемся на bubbling нативного
  // (click). Так шаблоны единообразны с app-pay-button и app-referral-banner,
  // и нельзя случайно повесить (clicked) на app-button и получить тихий no-op
  // (был такой баг с кнопкой «Зачислить» в реф-выводе).
  template: `<button
    [type]="type()"
    [disabled]="disabled() || loading()"
    [class.variant-primary]="variant() === 'primary'"
    [class.variant-secondary]="variant() === 'secondary'"
    [class.variant-ghost]="variant() === 'ghost'"
    [class.variant-coral-band]="variant() === 'coral-band'"
    [class.full]="full()"
    (click)="clicked.emit($event)">
    @if (loading()) {
      @if (loadingLabel()) { {{ loadingLabel() }} } @else { … }
    } @else { <ng-content /> }
  </button>`,
  styles: [`
    :host { display: inline-block; }
    :host(.full) { display: block; width: 100%; }
    button.full { width: 100%; }
    button {
      font-family: var(--font-body);
      font-size: 14px;
      font-weight: 600;
      line-height: 1;
      padding: 12px 20px;
      height: 40px;
      border-radius: var(--rounded-md);
      transition:
        background var(--dur-quick) ease,
        color var(--dur-quick) ease,
        border-color var(--dur-quick) ease,
        box-shadow var(--dur-quick) ease,
        transform var(--dur-quick) var(--ease-out);
      letter-spacing: 0;
    }
    button:disabled { opacity: .6; cursor: not-allowed; }
    /* Primary — фирменный градиент лендинга + тёмный on-primary текст.
       Градиент и тени — производные от --color-primary (color-mix в токенах),
       поэтому бренд с другим primary красится сам. */
    button.variant-primary {
      background: rgba(255, 186, 38, 1); color: var(--color-on-primary);
    }
    button.variant-primary:hover:not(:disabled) {
      transform: translateY(-1px);
      box-shadow: var(--shadow-primary-hover);
    }
    button.variant-primary:active:not(:disabled) {
      background: var(--color-primary-active);
      transform: none;
      box-shadow: var(--shadow-primary);
    }
    button.variant-secondary {
      background: var(--color-surface); color: var(--color-ink);
      border: 1px solid var(--color-hairline);
    }
    button.variant-secondary:hover:not(:disabled) {
      background: var(--color-surface-soft);
      border-color: color-mix(in srgb, var(--color-primary) 45%, var(--color-hairline));
    }
    button.variant-ghost { background: transparent; color: var(--color-ink); }
    button.variant-ghost:hover:not(:disabled) { background: var(--color-surface-card); }
    button.variant-coral-band {
      background: var(--grad-primary); color: var(--color-on-primary);
      box-shadow: var(--shadow-primary);
      height: 56px; padding: 0 28px; font-size: 16px;
      border-radius: var(--rounded-lg);
    }
    button.variant-coral-band:hover:not(:disabled) {
      transform: translateY(-1px);
      box-shadow: var(--shadow-primary-hover);
    }
    button.variant-coral-band:active:not(:disabled) {
      background: var(--color-primary-active);
      transform: none;
    }
  `],
})
export class ButtonComponent {
  readonly variant = input<'primary' | 'secondary' | 'ghost' | 'coral-band'>('primary');
  readonly type = input<'button' | 'submit'>('button');
  readonly disabled = input(false);
  readonly loading = input(false);
  readonly loadingLabel = input<string>('');
  readonly full = input(false);
  readonly clicked = output<MouseEvent>();
}
