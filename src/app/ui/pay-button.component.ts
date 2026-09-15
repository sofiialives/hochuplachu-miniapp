import { Component, input, output } from '@angular/core';

@Component({
  selector: 'app-pay-button',
  standalone: true,
  template: `<button class="pay" [disabled]="disabled() || loading()" (click)="clicked.emit()">
    @if (loading()) {
      <span class="label">{{ loadingLabel() }}</span>
    } @else {
      @if (sbpLogo()) {
        <img class="sbp-logo" src="/assets/coins/RUB_SBP.png" alt="СБП" />
      }
      <span class="label">{{ label() || 'Перейти к оплате' }}</span>
    }
  </button>`,
  styles: [`
    :host { display: block; }
    /* Цвет/hover/active/disabled — один в один с button.component.ts
       variant="primary" (см. .pay/.pay:hover/.pay:active/.pay:disabled
       ниже); ширина на всю строку, высота 56px, флекс-раскладка под
       лого СБП + текст — своя специфика этой кнопки, не часть variant. */
    .pay {
      width: 100%; height: 48px;
      display: flex; align-items: center; justify-content: center; gap: 10px;
      background: rgba(255, 186, 38, 1); color: var(--color-on-primary);
      border-radius: var(--rounded-lg);
      font-size: 14px; font-weight: 700;
      transition:
        box-shadow var(--dur-quick) ease,
        transform var(--dur-quick) var(--ease-out),
        background var(--dur-quick) ease;
    }
    .pay:hover:not(:disabled) { transform: translateY(-1px); box-shadow: var(--shadow-primary-hover); }
    .pay:active:not(:disabled) {
      background: var(--color-primary-active);
      transform: none;
      box-shadow: var(--shadow-primary);
    }
    .pay:disabled { opacity: .6; cursor: not-allowed; }
    .sbp-logo { width: 18px; height: 18px; }
  `],
})
export class PayButtonComponent {
  readonly label = input<string>('');
  readonly disabled = input(false);
  readonly loading = input(false);
  readonly loadingLabel = input<string>('Создание счёта…');
  // sbpLogo — показать логотип СБП слева от текста: страница включает его,
  // когда единственный доступный метод оплаты — СБП (kassaai / platega) и
  // клик ведёт сразу в СБП-флоу, минуя выбор валюты.
  readonly sbpLogo = input(false);
  readonly clicked = output<void>();
}