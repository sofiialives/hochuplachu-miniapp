import { Component, computed, input, model, output } from '@angular/core';
import { ButtonComponent } from './button.component';
import { InputComponent } from './input.component';
import { PromoValidation } from '../core/api/promo.api';
import { formatAmount } from '../core/currency/currency-symbols';

// Единый блок «Промокод + Применить» + строка скидки. Внешний вид
// синхронизирован между checkout/topup/extend-service — раньше дублировался
// тремя разными CSS-классами и расходился по паддингам.
@Component({
  selector: 'app-promo-input',
  standalone: true,
  imports: [ButtonComponent, InputComponent],
  template: `
    <div class="promo">
      <app-input class="grow"
        [value]="code()"
        (valueChange)="onInput($event)"
        [placeholder]="placeholder()"
        [error]="error() ? ' ' : ''" />
      <app-button variant="primary" (click)="apply.emit()" [loading]="loading()" [disabled]="!canApply()">
        Применить
      </app-button>
    </div>
    @if (error()) {
      <div class="promo-err">{{ error() }}</div>
    } @else if (showDiscount() && applied(); as d) {
      <div class="discount-row">
        <span>Скидка</span>
        <span class="discount-val">−{{ money(d.discount_amount, d.currency) }}</span>
      </div>
    }
  `,
  styles: [`
    :host { display: block; }
    .promo {
      display: flex; gap: var(--space-sm); align-items: stretch;
    }
    .promo .grow { flex: 1 1 auto; min-width: 0; }
    .promo app-button { flex: 0 0 auto; }
    .promo app-button button { height: 44px; }
    .discount-row {
      display: flex; justify-content: space-between; align-items: baseline;
      padding: var(--space-md) 0 0;
      font-size: 15px; color: var(--color-body);
    }
    .discount-val { color: var(--color-success); font-weight: 500; }
    .promo-err {
      margin-top: 8px;
      font-size: 13px; color: var(--color-error);
      line-height: 1.4;
    }
  `],
})
export class PromoInputComponent {
  readonly code = model<string>('');
  readonly applied = input<PromoValidation | null>(null);
  readonly loading = input<boolean>(false);
  readonly placeholder = input<string>('Промокод');
  /** Сообщение об ошибке промокода. Когда задано, поле подсвечивается
   *  красным и под ним рендерится текст ошибки (вместо строки скидки). */
  readonly error = input<string>('');
  /** Когда true — компонент сам рисует строку «Скидка …». Использовать в
   *  topup/extend-service, где скидка стоит отдельно. В checkout — false,
   *  потому что строка должна жить внутри блока «Итого». */
  readonly showDiscount = input<boolean>(true);
  readonly apply = output<void>();
  /** Эмитится при правке поля. Родитель использует, чтобы стирать `error`
   *  и `applied` — старый результат больше не релевантен новому коду. */
  readonly codeChanged = output<string>();

  protected readonly canApply = computed(() => this.code().trim().length > 0);

  protected onInput(v: string): void {
    this.code.set(v);
    this.codeChanged.emit(v);
  }

  protected money(v: number | string | null | undefined, c: string | null | undefined): string {
    return formatAmount(v, c);
  }
}
