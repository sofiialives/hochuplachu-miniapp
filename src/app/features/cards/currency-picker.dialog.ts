import { Component, input, output } from '@angular/core';
import { DialogComponent } from '../../ui/dialog.component';
import { CoinIconComponent } from '../../ui/coin-icon.component';
import { PaymentCurrency, isMethodAvailable } from '../../core/currency/currency.service';
import { CurrencyLimits, fromAmountForTo, limitsForCurrency, limitsForCurrencyFrom } from '../../core/currency/level-calc';
import { currencyLabel, symbolFor } from '../../core/currency/currency-symbols';

// Единый диалог выбора валюты оплаты для checkout / topup / extend-service.
// Расчёт суммы оплаты и лимитов делается внутри по PaymentCurrency и amount.
// formatRange — опциональный override (top-up делит границы на 1+fee_pct,
// чтобы пользователь видел диапазон в card-валюте).
@Component({
  selector: 'app-currency-picker-dialog',
  standalone: true,
  imports: [DialogComponent, CoinIconComponent],
  template: `<app-dialog [title]="title()" (dismissed)="dismissed.emit()">
    <div class="cur-list">
      @for (c of currencies(); track c.id) {
        @if (!isAvailable(c)) {
          <!-- Метод включён, но условия доступности не выполнены: рисуем
               отключённым, подпись условия (из админки) — серым, не красным,
               чтобы не пугать пользователя. -->
          <button class="cur cur--disabled" [disabled]="true">
            <app-coin-icon class="ico-wrap" [id]="c.id" [shortName]="c.short_name || c.currency_short_name" />
            <div class="cur-text">
              <div class="cur-name">{{ label(c) }}</div>
              <div class="cur-rate cond-msg">{{ c.condition_note || 'Пока недоступно' }}</div>
            </div>
          </button>
        } @else {
          @let lim = limitsFor(c);
          <button class="cur" [class.cur--disabled]="!lim.ok" [disabled]="!lim.ok" (click)="select(c)">
            <app-coin-icon class="ico-wrap" [id]="c.id" [shortName]="c.short_name || c.currency_short_name" />
            <div class="cur-text">
              <div class="cur-name">{{ label(c) }}</div>
              @if (lim.ok) {
                <div class="cur-rate">≈ {{ formatPay(payAmountFor(c)) }} {{ sym(c) }}</div>
              } @else {
                <div class="cur-rate range-msg">Допустимо: {{ formatRangeText(c, lim) }} {{ chargeSymbol() }}</div>
              }
            </div>
          </button>
        }
      }
    </div>
  </app-dialog>`,
  styles: [`
    .cur-list { display: flex; flex-direction: column; gap: 8px; }
    .cur {
      display: flex; align-items: center; gap: 12px;
      padding: 12px;
      background: var(--color-surface-card);
      border-radius: var(--rounded-md);
      border: none; width: 100%;
      cursor: pointer;
      font: inherit;
      color: inherit;
    }
    .cur--disabled { opacity: .5; cursor: not-allowed; }
    .cur-text { flex: 1; text-align: left; }
    .cur-name { font-weight: 500; }
    .cur-rate { font-size: 12px; color: var(--color-muted); }
    .range-msg { color: var(--color-danger, #DC3545) !important; }
    /* Подпись условия доступности — намеренно серая (не danger). */
    .cond-msg { color: var(--color-muted); }
  `],
})
export class CurrencyPickerDialogComponent {
  readonly title = input('Выберите валюту оплаты');
  readonly currencies = input.required<PaymentCurrency[]>();
  // amount — сумма к оплате. По умолчанию — в to-валюте (то, что мы хотим
  // получить на наш receive адрес); при issueCurrency='RUB' — цена в рублях.
  readonly amount = input.required<number>();
  readonly chargeSymbol = input<string>('');
  // issueCurrency — валюта прайса. 'RUB' включает рублёвый режим (зеркало
  // backend issueCoincatSum): рублёвые направления получают счёт ровно на
  // amount (сумма в них — from-сторона, курс не участвует), остальные — на
  // эквивалент amount в receive-валюте по курсу RUB_SBP. Пусто/не-RUB —
  // прежнее поведение: amount уже в receive-валюте.
  readonly issueCurrency = input<string>('');
  // formatRange — опциональный кастомизатор. Принимает min/max в to-валюте,
  // возвращает строку "X — Y" (без символа валюты — он добавляется отдельно).
  readonly formatRange = input<((min: number, max: number) => string) | null>(null);

  readonly dismissed = output<void>();
  readonly selected = output<PaymentCurrency>();

  protected label(c: PaymentCurrency): string { return currencyLabel(c.id, c.name); }
  protected sym(c: PaymentCurrency): string { return symbolFor(c.currency_short_name || c.id.split('_')[0]); }
  protected isAvailable(c: PaymentCurrency): boolean { return isMethodAvailable(c); }

  private isRubIssue(): boolean { return this.issueCurrency().toUpperCase() === 'RUB'; }
  private isRubPay(c: PaymentCurrency): boolean { return c.id.startsWith('RUB'); }

  // rubRate — курс RUB_SBP → receive (receive за 1 ₽) из загруженного списка;
  // 0, если рублёвого направления в списке нет.
  private rubRate(): number {
    const list = this.currencies();
    const rub = list.find((c) => c.id === 'RUB_SBP') ?? list.find((c) => this.isRubPay(c));
    return rub && rub.rate > 0 ? rub.rate : 0;
  }

  // toAmount — сумма заявки в receive-валюте (для не-рублёвых направлений).
  private toAmount(): number {
    if (!this.isRubIssue()) return this.amount();
    const r = this.rubRate();
    return r > 0 ? this.amount() * r : 0;
  }

  protected limitsFor(c: PaymentCurrency): CurrencyLimits {
    if (this.isRubIssue() && this.isRubPay(c)) return limitsForCurrencyFrom(c, this.amount());
    return limitsForCurrency(c, this.toAmount());
  }

  protected payAmountFor(c: PaymentCurrency): number {
    // Рублёвый прайс: счёт по рублёвому направлению — ровно на цену.
    if (this.isRubIssue() && this.isRubPay(c)) return this.amount();
    const n = this.toAmount();
    if (n <= 0) return 0;
    const v = fromAmountForTo(c, n);
    if (v != null) return v;
    return c.rate > 0 ? n / c.rate : 0;
  }

  protected formatPay(n: number): string {
    return this.fmt(n);
  }

  protected formatRangeText(c: PaymentCurrency, lim: CurrencyLimits): string {
    let min = lim.minAmount;
    let max = lim.maxAmount;
    // В рублёвом режиме лимиты не-рублёвых направлений приходят в receive-валюте
    // — переводим в рубли, чтобы подсказка была в валюте прайса (chargeSymbol=₽).
    if (this.isRubIssue() && !this.isRubPay(c)) {
      const r = this.rubRate();
      if (r > 0) { min = min / r; max = max / r; }
    }
    const fmt = this.formatRange();
    if (fmt) return fmt(min, max);
    return `${this.fmt(min)} — ${this.fmt(max)}`;
  }

  private fmt(n: number): string {
    if (!isFinite(n)) return '∞';
    if (n >= 1000) return n.toFixed(0);
    if (n >= 1) return n.toFixed(2);
    return n.toFixed(4);
  }

  select(c: PaymentCurrency): void {
    this.selected.emit(c);
  }
}
