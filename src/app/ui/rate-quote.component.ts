import { Component, computed, inject, input, OnInit } from '@angular/core';
import { CurrencyService } from '../core/currency/currency.service';
import { previewRate } from '../core/currency/level-calc';

// variant — стиль подачи:
// - 'plain' (по умолчанию): компактная строка курса для каталог-ячейки,
//   где места мало и pill-капсулы лишние.
// - 'pill': курс как самостоятельный блок (страница продукта рядом с ценой),
//   каждая строка — pill с лёгким фоном из брендинга продукта.
export type RateQuoteVariant = 'plain' | 'pill';

// RateQuoteComponent — показывает курс «1 base ≈ N currency».
// Используется в каталог-карточках (home.page), где курс не зависит от
// стоимости конкретной карты, а только от валютной пары и наценки карточного
// продукта.
//
// Логика курса:
// - Берём чистый rate провайдера через previewRate() (это `lvl.rate` без
//   `lvl.fee` — т.е. без deposit/withdraw комиссии CC-провайдера).
// - Затем умножаем на (1 + markupPct) — это наценка карточного продукта
//   (CardProduct.deposit_fee_pct), её сервис накидывает к курсу провайдера.
//
// Входы:
// - base — валюта-источник (обычно CardProduct.issue_currency, USDT).
// - markupPct — наценка карточного продукта.
// - 2 строки: RUB_SBP (₽ через СБП — cc / kassaai / platega, курс из /payment/methods)
//   и USDT_TRX.
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
    /* --page-body / --page-h — переменные брендинга карт-продукта.
       Если parent-scope (например .catalog-row) их задал — подхватываем,
       иначе работают глобальные muted/body. Так компонент читается и
       на cream-фоне, и на тёмном/цветном фоне продукта. */
    .rate-quote {
      display: flex; gap: var(--space-md);
      justify-content: center; flex-wrap: wrap;
      color: var(--page-body, var(--color-muted));
      font-size: 13px;
      line-height: 1.4;
    }
    .line { white-space: nowrap; }
    .ccy { color: var(--page-h, var(--color-body)); font-weight: 500; }

    /* Pill-вариант используется только на странице продукта (рядом с
       ценой) — по спеку курс там читается как обычный текст, а не капсула:
       чёрный, 500, 24px на телефоне / 20px на десктопе, без фона/рамки. */
    .rate-quote.pill {
      gap: 10px;
      flex-wrap: wrap;
      line-height: 1.2;
    }
    .rate-quote.pill .line {
      display: inline-flex; align-items: baseline; gap: 6px;
      font-size: 17px;
      font-weight: 500;
      color: rgba(0, 0, 0, 1);
      white-space: nowrap;
    }
    .rate-quote.pill .ccy {
      font-size: 17px;
      font-weight: 500;
      color: rgba(0, 0, 0, 1);
    }
    @media (min-width: 1024px) {
      .rate-quote.pill .line, .rate-quote.pill .ccy { font-size: 20px; }
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
      this.currency.loadMethods('issue').subscribe({ error: () => { /* ignore: курсы не критичны */ } });
    }
  }

  // Базовая валюта курса пополнения. Пополнения считаются в receive-валюте
  // (USDT-эквивалент) независимо от валюты прайса — сами котировки (RUB_SBP /
  // USDT_TRX к receive) от валюты прайса не зависят, поэтому при рублёвом
  // прайсе (base=RUB) «₽ за 1 ₽» был бы бессмыслицей.
  //
  // В подписи показываем USD, а не USDT: пользователь оперирует валютой
  // карты (доллар), USDT — лишь внутренний рельс пополнения, и как стейбл
  // он 1:1 к доллару, так что цифра курса от подмены подписи не меняется.
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
    // previewRate(c, 1) — rate провайдера БЕЗ deposit/withdraw fee
    // (`lvl.rate`, не `(toAmount + lvl.fee)/lvl.rate`). rate выражен как
    // «receive за 1 from», нам нужно «from за 1 receive» — поэтому 1/rate.
    // Для СБП-методов (kassaai / platega) rate уже несёт комиссию шлюза
    // (источник курса — ЦБ / Rapira — + fee).
    if (rub) {
      const r = previewRate(rub, 1);
      if (r > 0) {
        out.push({ label: '₽ через СБП', value: ((1 / r) * factor).toFixed(2) });
      }
    }
    if (usdt) {
      const r = previewRate(usdt, 1);
      if (r > 0) {
        out.push({ label: 'USDT TRX', value: ((1 / r) * factor).toFixed(4) });
      }
    }
    return out;
  });
}