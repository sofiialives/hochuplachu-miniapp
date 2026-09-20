import { Component, computed, inject, input, OnInit } from '@angular/core';
import { CurrencyService } from '../core/currency/currency.service';
import { previewRate } from '../core/currency/level-calc';

export type RateQuoteVariant = 'plain' | 'pill';

@Component({
  selector: 'app-rate-quote',
  standalone: true,
  template: `
    @if (quotes().length > 0) {
      <div class="rate-quote" [class.pill]="variant() === 'pill'">
        @for (q of quotes(); track q.label) {
          <span class="line">1 {{ displayBase() }} ≈ {{ q.value }} <span class="ccy">{{ q.label }}</span></span>
        }
      </div>
    }
  `,
  styles: [`
    
    .rate-quote {
      display: flex; gap: var(--space-md);
      justify-content: center; flex-wrap: wrap;
      color: var(--page-body, var(--color-muted));
      font-family: 'Gilroy';
      font-size: 16px;
      font-weight: 500;
      line-height: 1.4;
    }
    .line { white-space: nowrap; }
    .ccy { color: var(--page-h, var(--color-body)); font-weight: 500; }

    
    .rate-quote.pill {
      gap: 10px;
      flex-wrap: wrap;
      line-height: 1.2;
    }
    .rate-quote.pill .line {
      display: inline-flex; align-items: baseline; gap: 6px;
      font-family: 'Gilroy';
      font-size: 16px;
      font-weight: 500;
      /* Раньше было захардкожено чёрным — на тёмных карточках (premium /
       * subscription) текст сливался с тёмным page-bg и был не виден.
       * --page-body/--page-h выставляются родительской страницей под цвет
       * конкретной карты (см. product-detail.page.ts), с фолбэком на
       * прежний чёрный для мест, где эти переменные не заданы. */
      color: var(--page-body, rgba(0, 0, 0, 1));
      white-space: nowrap;
    }
    .rate-quote.pill .ccy {
      font-family: 'Gilroy';
      font-size: 16px;
      font-weight: 500;
      color: var(--page-h, rgba(0, 0, 0, 1));
    }
  `],
})
export class RateQuoteComponent implements OnInit {
  private readonly currency = inject(CurrencyService);

  readonly base = input.required<string>();
  readonly markupPct = input<number>(0);
  readonly variant = input<RateQuoteVariant>('plain');

  ngOnInit(): void {
    if (this.currency.issueMethods().length === 0) {
      this.currency.loadMethods('issue').subscribe({ error: () => {  } });
    }
  }

  protected readonly displayBase = computed(() => {
    const b = this.base().toUpperCase();
    return b === 'RUB' || b === 'USDT' ? 'USD' : this.base();
  });

  protected readonly quotes = computed<{ label: string; value: string }[]>(() => {
    const factor = 1 + Math.max(0, this.markupPct() ?? 0);

    const out: { label: string; value: string }[] = [];
    const list = this.currency.issueMethods();
    const rub = list.find((c) => c.id === 'RUB_SBP') ?? list.find((c) => c.id.startsWith('RUB'));
    const usdt = list.find((c) => c.id === 'USDT_TRX');
    if (rub) {
      const r = previewRate(rub, 1);
      if (r > 0) {
        out.push({ label: '₽ через СБП', value: ((1 / r) * factor).toFixed(2) });
      }
    }
    // USDT TRX временно скрыт по просьбе — оставляем только курс по СБП,
    // чтобы он точно был виден, пока по стилям блока не разберёмся отдельно.
    // Раскомментировать, когда понадобится вернуть вторую строку курса.
    // if (usdt) {
    //   const r = previewRate(usdt, 1);
    //   if (r > 0) {
    //     out.push({ label: 'USDT TRX', value: ((1 / r) * factor).toFixed(4) });
    //   }
    // }
    void usdt;
    return out;
  });
}