import { Component, HostListener, OnInit, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { TransactionsApi, CardTransaction } from '../../core/api/transactions.api';
import { CardsApi, CardProduct, UserCard } from '../../core/api/cards.api';
import { BackBarComponent } from '../../ui/back-bar.component';
import { ButtonComponent } from '../../ui/button.component';
import { PullToRefreshComponent } from '../../ui/pull-to-refresh.component';
import { symbolFor, formatAmount } from '../../core/currency/currency-symbols';

interface DayGroup { label: string; rows: CardTransaction[]; }

@Component({
  selector: 'app-history',
  standalone: true,
  imports: [BackBarComponent, ButtonComponent, PullToRefreshComponent, RouterLink],
  template: `<app-pull-to-refresh #ptr (refresh)="onPullRefresh(ptr)">
    <app-back-bar />
    <section class="wrap">
      <h2>История транзакций</h2>

      @if (pendingEmpty()) {
        <!-- Данных ещё нет и запросы в полёте — не рисуем ни фильтры, ни
             заглушку, чтобы они не мигали друг в друга у юзера без карт. -->
      } @else if (noCards()) {
        <!-- Карт нет — фильтры и список операций бессмысленны, показываем
             заглушку с CTA выпуска (ведёт на экран выбора карты). -->
        <div class="no-cards">
          <svg class="no-cards-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <rect x="2" y="5" width="20" height="14" rx="3"/>
            <line x1="2" y1="10" x2="22" y2="10"/>
          </svg>
          <p>У вас ещё нет ни одной карты</p>
          <a class="no-cards-cta" routerLink="/cards/new">
            <app-button variant="primary">Выпустить карту</app-button>
          </a>
        </div>
      } @else {
      <p class="hint">Последние операции</p>

      <div class="filters">
        <div class="chip-wrap">
          <button
            type="button"
            class="chip"
            [class.active]="cardFilter() !== ''"
            (click)="toggleDropdown('card', $event)">
            {{ cardLabel() }} ▾
          </button>
          @if (cardOpen()) {
            <div class="dropdown" (click)="$event.stopPropagation()">
              <button type="button" class="opt" [class.selected]="cardFilter() === ''" (click)="pickCard('', $event)">
                Все карты
              </button>
              @for (c of cards(); track c.id) {
                <button type="button" class="opt" [class.selected]="cardFilter() === c.id" (click)="pickCard(c.id, $event)">
                  <span>•• {{ c.last4 || '—' }}</span>
                  <span class="cur">{{ cardCurrency(c) }}</span>
                </button>
              }
              @if (cards().length === 0) {
                <div class="opt empty">У вас пока нет выпущенных карт</div>
              }
            </div>
          }
        </div>

        <div class="chip-wrap">
          <button
            type="button"
            class="chip"
            [class.active]="kind() !== ''"
            (click)="toggleDropdown('kind', $event)">
            {{ kindLabel() }} ▾
          </button>
          @if (kindOpen()) {
            <div class="dropdown" (click)="$event.stopPropagation()">
              @for (opt of kindOptions; track opt.value) {
                <button type="button" class="opt" [class.selected]="kind() === opt.value" (click)="pickKind(opt.value, $event)">
                  {{ opt.label }}
                </button>
              }
            </div>
          }
        </div>
      </div>

      @for (g of groups(); track g.label) {
        <div class="day-label">{{ g.label }}</div>
        @for (t of g.rows; track t.id) {
          <div class="tx">
            <div class="info">
              <div class="title">
                {{ t.description || t.kind }}
                @if (last4For(t.card_id); as l4) {
                  <span class="card-tag">•• {{ l4 }}</span>
                }
              </div>
              <div class="status">
                <span class="dot" [class.green]="t.status === 'success'" [class.red]="t.status !== 'success'"></span>
                {{ t.status === 'success' ? 'Успешно' : t.status }} · {{ time(t.happened_at) }}
              </div>
            </div>
            <div class="amount" [class.plus]="t.amount > 0" [class.minus]="t.amount < 0">
              {{ t.amount > 0 ? '+' : '' }}{{ money(t.amount, t.currency) }}
              @if (t.raw_currency_amount != null) {
                <div class="raw">{{ money(t.raw_currency_amount, t.raw_currency) }}</div>
              }
              @if (t.fee_amount) {
                <div class="raw">Включая комиссию {{ money(t.fee_amount, t.currency) }}</div>
              }
            </div>
          </div>
        }
      }
      }
    </section>
  </app-pull-to-refresh>`,
  styles: [`
    .wrap { padding: var(--space-md); padding-bottom: 96px; max-width: 640px; margin: 0 auto; }
    h2 { text-align: center; }
    .hint { text-align: center; color: var(--color-muted); margin-bottom: var(--space-lg); }
    /* Заглушка «нет карт» — вместо фильтров и списка операций. */
    .no-cards {
      display: flex; flex-direction: column; align-items: center;
      gap: var(--space-sm);
      padding: var(--space-xl) var(--space-md);
      text-align: center;
    }
    .no-cards-ico {
      width: 44px; height: 44px;
      color: color-mix(in srgb, var(--color-ink) 38%, transparent);
    }
    .no-cards p { margin: 0 0 var(--space-sm); color: var(--color-muted); font-size: 15px; }
    .no-cards-cta { text-decoration: none; }
    .filters { display: flex; flex-wrap: wrap; gap: var(--space-sm); margin-bottom: var(--space-md); }
    .chip-wrap { position: relative; }
    .chip {
      padding: 6px 14px; border-radius: var(--rounded-pill);
      background: var(--color-surface-card); color: var(--color-ink);
      font-size: 14px; white-space: nowrap;
    }
    .chip.active { background: var(--color-primary); color: var(--color-on-primary); }

    .dropdown {
      position: absolute; top: calc(100% + 6px); left: 0; z-index: 50;
      min-width: 220px; max-width: 320px;
      display: flex; flex-direction: column;
      padding: 6px;
      background: var(--color-surface); color: var(--color-ink);
      border: 1px solid var(--color-hairline);
      border-radius: var(--rounded-md);
      box-shadow: 0 8px 24px rgba(20, 20, 19, .14);
    }
    .opt {
      display: flex; align-items: center; justify-content: space-between; gap: 8px;
      text-align: left; padding: 10px 12px;
      border-radius: var(--rounded-sm);
      color: var(--color-ink); font-size: 14px;
      cursor: pointer;
    }
    .opt:hover { background: var(--color-surface-card); }
    .opt.selected { background: var(--color-surface-card); font-weight: 600; }
    .opt.empty { color: var(--color-muted); cursor: default; padding: 12px; }
    .opt .cur { color: var(--color-muted); font-size: 12px; }
    .day-label { font-weight: 500; padding: var(--space-md) 0 var(--space-sm); color: var(--color-ink); }
    .tx { display: flex; gap: 8px; padding: var(--space-sm) 0; border-bottom: 1px solid var(--color-hairline-soft); }
    .info { flex: 1; }
    .title { font-weight: 500; }
    .card-tag { margin-left: 6px; color: var(--color-muted); font-weight: 400; font-size: 13px; }
    .status { color: var(--color-muted); font-size: 13px; display: flex; align-items: center; gap: 6px; margin-top: 2px; }
    .dot { width: 8px; height: 8px; border-radius: 50%; }
    .dot.green { background: var(--color-success); }
    .dot.red { background: var(--color-error); }
    .amount { text-align: right; font-weight: 500; }
    .amount.plus { color: var(--color-success); }
    .amount.minus { color: var(--color-error); }
    .raw { font-size: 12px; color: var(--color-muted); font-weight: 400; }
  `],
})
export class HistoryPage implements OnInit {
  private readonly txApi = inject(TransactionsApi);
  private readonly cardsApi = inject(CardsApi);

  protected readonly kind = signal('');
  protected readonly cardFilter = signal('');
  protected readonly cardOpen = signal(false);
  protected readonly kindOpen = signal(false);
  // Берём карты из глобального кэша CardsApi — он наполняется app-shell'ом
  // при старте, поэтому на момент рендера history-страницы карты уже на
  // руках. ngOnInit ниже параллельно ре-фетчит, чтобы освежить данные.
  protected readonly cards = this.cardsApi.cardsCache;
  // cardsLoaded/txLoaded — дождались ли ответов myCards()/list() этой страницы.
  // Пока false, заглушку «нет карт» не показываем — иначе при прямом заходе на
  // /history она мигала бы до прихода данных. Транзакции проверяем тоже:
  // у юзера с удалённой админом картой карт 0, но операции по ней остаются —
  // прятать их заглушкой нельзя.
  protected readonly cardsLoaded = signal(false);
  protected readonly txLoaded = signal(false);
  protected readonly noCards = computed(() =>
    this.cardsLoaded() && this.txLoaded()
    && this.cards().length === 0 && (this.items() ?? []).length === 0,
  );
  // pendingEmpty — то же пустое состояние, но пока запросы не завершены:
  // рендерим пустоту вместо фильтров, которые через мгновение схлопнулись бы
  // в заглушку. У юзера с прогретым кэшем карт условие сразу false.
  protected readonly pendingEmpty = computed(() =>
    !(this.cardsLoaded() && this.txLoaded())
    && this.cards().length === 0 && (this.items() ?? []).length === 0,
  );
  // Каталог продуктов — для резолва валюты карты по card_product_id
  // (Card сам валюту не хранит, она атрибут CardProduct).
  protected readonly products = signal<CardProduct[]>([]);
  protected readonly items = signal<CardTransaction[]>([]);

  protected readonly kindOptions = [
    { value: '', label: 'Все типы' },
    { value: 'charge', label: 'Покупки' },
    { value: 'topup', label: 'Пополнения' },
    { value: 'refund', label: 'Возвраты' },
  ];

  protected readonly cardLabel = computed(() => {
    const id = this.cardFilter();
    if (!id) return 'Карта';
    const c = this.cards().find((x) => x.id === id);
    return c ? `•• ${c.last4 || '—'}` : 'Карта';
  });
  protected readonly kindLabel = computed(() => {
    const k = this.kind();
    return this.kindOptions.find((o) => o.value === k)?.label ?? 'Тип';
  });

  protected toggleDropdown(which: 'card' | 'kind', ev: Event): void {
    ev.stopPropagation();
    if (which === 'card') {
      this.cardOpen.update((v) => !v);
      this.kindOpen.set(false);
    } else {
      this.kindOpen.update((v) => !v);
      this.cardOpen.set(false);
    }
  }
  protected pickCard(id: string, ev: Event): void {
    ev.stopPropagation();
    this.cardFilter.set(id);
    this.cardOpen.set(false);
  }
  protected pickKind(value: string, ev: Event): void {
    ev.stopPropagation();
    this.kind.set(value);
    this.kindOpen.set(false);
  }

  // Клик вне дропдауна закрывает его.
  @HostListener('document:click')
  protected onDocClick(): void {
    if (this.cardOpen()) this.cardOpen.set(false);
    if (this.kindOpen()) this.kindOpen.set(false);
  }

  protected readonly groups = computed<DayGroup[]>(() => {
    // ?? [] — на случай если items() = null (бэк может вернуть `null` slice).
    const rows = (this.items() ?? []).filter((t) => {
      if (this.kind() && t.kind !== this.kind()) return false;
      if (this.cardFilter() && t.card_id !== this.cardFilter()) return false;
      return true;
    });
    const map = new Map<string, CardTransaction[]>();
    for (const r of rows) {
      const key = this.dayLabel(r.happened_at);
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(r);
    }
    return Array.from(map.entries()).map(([label, rows]) => ({ label, rows }));
  });

  ngOnInit(): void {
    // myCards() сам пишет в cardsCache через tap — отдельный subscribe не нужен,
    // но дёрнем его, чтобы освежить, и залогируем ошибку (раньше swallowилось).
    // cardsLoaded взводим и на ошибке: иначе при недоступном бэке страница
    // вечно считала бы список «ещё грузящимся».
    this.cardsApi.myCards().subscribe({
      next: () => this.cardsLoaded.set(true),
      error: (err) => {
        console.error('myCards failed', err);
        this.cardsLoaded.set(true);
      },
    });
    this.cardsApi.listProducts().subscribe({
      next: (r) => this.products.set(r?.products ?? []),
      error: (err) => console.error('listProducts failed', err),
    });
    this.refresh();
  }

  protected cardCurrency(c: UserCard): string {
    return this.products().find((p) => p.id === c.card_product_id)?.card_currency ?? '';
  }

  protected last4For(cardId: string): string {
    return this.cards().find((c) => c.id === cardId)?.last4 ?? '';
  }

  private refresh(): void {
    this.txApi.list().subscribe({
      next: (r) => {
        this.items.set(r?.items ?? []);
        this.txLoaded.set(true);
      },
      error: (err) => {
        console.error('transactions list failed', err);
        this.txLoaded.set(true);
      },
    });
  }

  // onPullRefresh — обработчик pull-to-refresh: освежаем транзакции и
  // список карт (чтобы фильтр по карте и баланс на других страницах
  // были актуальны). Спиннер скрываем, когда оба запроса завершились.
  protected onPullRefresh(ptr: PullToRefreshComponent): void {
    let pending = 2;
    const done = (): void => { if (--pending === 0) ptr.finishRefresh(); };
    this.txApi.list().subscribe({
      next: (r) => this.items.set(r?.items ?? []),
      error: done,
      complete: done,
    });
    this.cardsApi.myCards().subscribe({
      error: done,
      complete: done,
    });
  }

  private dayLabel(iso: string): string {
    const d = new Date(iso);
    const today = new Date();
    if (d.toDateString() === today.toDateString()) return 'Сегодня';
    return d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' });
  }
  protected time(iso: string): string {
    return new Date(iso).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
  }
  protected symbol(c: string): string { return symbolFor(c); }
  protected money(v: number | string | null | undefined, c: string | null | undefined): string { return formatAmount(v, c); }
}
