import { Component, OnInit, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { BackBarComponent } from '../../ui/back-bar.component';
import { ButtonComponent } from '../../ui/button.component';
import { CatalogApi, ProfileOrderItem } from '../../core/api/catalog.api';
import { formatAmount } from '../../core/currency/currency-symbols';

const PAGE_SIZE = 25;

@Component({
  selector: 'app-profile-orders',
  standalone: true,
  imports: [BackBarComponent, ButtonComponent],
  template: `<app-back-bar />
    <section class="wrap">
      <h2>Мои заказы</h2>

      @if (items(); as list) {
        @if (list.length === 0) {
          <div class="empty">
            <p>Заказов пока нет</p>
          </div>
        } @else {
          <div class="list">
            @for (it of list; track it.type + it.id) {
              <button type="button" class="item" (click)="open(it)">
                <div class="i-info">
                  <div class="i-title">{{ titleOf(it) }}</div>
                  <div class="i-sub">
                    <span class="dot" [attr.data-tone]="toneOf(it.status)"></span>
                    {{ statusLabel(it.status) }} · {{ dateOf(it.created_at) }}
                  </div>
                </div>
                <div class="i-right">
                  <div class="i-sums">
                    @if (amountOf(it); as a) { <div class="i-amount">{{ a }}</div> }
                    <!-- Скидку подписываем ТОЛЬКО когда промокод применён:
                         у обычного заказа лишняя строка сдвигала бы сумму. -->
                    @if (discountOf(it); as d) { <div class="i-promo">{{ d }}</div> }
                  </div>
                  <span class="i-arr" aria-hidden="true">›</span>
                </div>
              </button>
            }
          </div>
          @if (hasMore()) {
            <app-button variant="secondary" [full]="true" [loading]="loadingMore()" (clicked)="loadMore()">Показать ещё</app-button>
          }
        }
      } @else {
        <div class="list" role="status" aria-label="Загрузка заказов">
          <span class="skel"></span>
          <span class="skel"></span>
          <span class="skel"></span>
        </div>
      }
    </section>`,
  styles: [`
    .wrap {
      padding: 0 16px;
      padding-bottom: 110px;
      max-width: 1200px;
      margin: 0 auto;
      display: flex;
      flex-direction: column;
      gap: var(--space-md);
    }
    h2 { text-align: center; margin: 0; }
    .empty { text-align: center; color: var(--color-muted); padding: var(--space-xl) 0; }
    .list { display: flex; flex-direction: column; gap: var(--space-sm); }
    .i-sums { display: flex; flex-direction: column; align-items: flex-end; gap: 2px; }
    .i-promo { font-size: 12px; color: var(--color-success); white-space: nowrap; }
    .item {
      display: flex; align-items: center; justify-content: space-between; gap: var(--space-sm);
      padding: var(--space-md);
      background: var(--color-surface);
      border: 1px solid var(--color-hairline-soft);
      border-radius: var(--rounded-lg);
      cursor: pointer; text-align: left;
      transition: border-color .12s ease, transform .12s ease;
    }
    .item:hover { border-color: var(--color-primary); transform: translateY(-1px); }
    .i-info { min-width: 0; flex: 1; }
    .i-title { font-weight: 600; font-size: 15px; overflow: hidden; text-overflow: ellipsis; }
    .i-sub {
      display: flex; align-items: center; gap: 6px;
      color: var(--color-muted); font-size: 13px; margin-top: 4px;
      font-family: 'Gilroy', sans-serif;
    }
    .dot { width: 8px; height: 8px; border-radius: 50%; flex: 0 0 8px; background: var(--color-muted); }
    .dot[data-tone="ok"] { background: var(--color-success); }
    .dot[data-tone="wait"] { background: var(--color-warning); }
    .dot[data-tone="bad"] { background: var(--color-error); }
    .i-right { display: flex; align-items: center; gap: 10px; flex: 0 0 auto; }
    .i-amount { font-weight: 600; white-space: nowrap; font-family: 'Gilroy', sans-serif; }
    .i-arr { color: var(--color-muted); font-size: 20px; line-height: 1; }
    .skel {
      display: block; height: 68px; border-radius: var(--rounded-lg);
      background: color-mix(in srgb, var(--color-primary) 6%, var(--color-surface));
      position: relative; overflow: hidden;
    }
    .skel::after {
      content: ""; position: absolute; inset: 0;
      background: linear-gradient(100deg, transparent 32%, color-mix(in srgb, var(--color-white) 55%, transparent) 50%, transparent 68%);
      transform: translateX(-100%);
      animation: po-skel 1.6s ease-in-out infinite;
    }
    @keyframes po-skel { to { transform: translateX(100%); } }
    @media (prefers-reduced-motion: reduce) { .skel::after { animation: none; } }

    
    @media (min-width: 1024px) {
      .wrap { padding: 0 120px; }
    }
  `],
})
export class ProfileOrdersPage implements OnInit {
  private readonly catalogApi = inject(CatalogApi);
  private readonly router = inject(Router);

  protected readonly items = signal<ProfileOrderItem[] | null>(null);
  protected readonly hasMore = signal(false);
  protected readonly loadingMore = signal(false);
  private page = 1;

  ngOnInit(): void {
    this.load(1);
  }

  private load(page: number): void {
    this.catalogApi.profileOrders(page, PAGE_SIZE).subscribe({
      next: (r) => {
        const chunk = r.items ?? [];
        this.page = page;
        this.items.set(page === 1 ? chunk : [...(this.items() ?? []), ...chunk]);
        this.hasMore.set((this.items() ?? []).length < (r.total ?? 0) && chunk.length > 0);
        this.loadingMore.set(false);
      },
      error: () => {
        if (page === 1) this.items.set([]);
        this.loadingMore.set(false);
      },
    });
  }

  protected loadMore(): void {
    if (this.loadingMore()) return;
    this.loadingMore.set(true);
    this.load(this.page + 1);
  }

  protected open(it: ProfileOrderItem): void {
    switch (it.type) {
      case 'esim_order': void this.router.navigate(['/esim/orders', it.id]); break;
      case 'esim_recharge': void this.router.navigate(['/esim/recharges', it.id, 'payment']); break;
      case 'service_order': void this.router.navigate(['/services/orders', it.id]); break;
      case 'topup':
        if (it.card_id) void this.router.navigate(['/topup', it.card_id, 'payment', it.id]);
        break;
      case 'renewal':
        if (it.card_id) void this.router.navigate(['/cards', it.card_id, 'extend-service', 'payment', it.id]);
        break;
      case 'card_order':
      default:
        void this.router.navigate(['/orders', it.id, 'payment']);
    }
  }

  protected titleOf(it: ProfileOrderItem): string {
    switch (it.type) {
      case 'card_order': return 'Выпуск карты';
      case 'topup': return 'Пополнение карты';
      case 'renewal': return 'Продление обслуживания';
      case 'esim_order': return it.product_name ? `eSIM — ${it.product_name}` : 'Покупка eSIM';
      case 'esim_recharge': return 'Продление eSIM';
      case 'service_order':
        return it.product_name
          ? `${it.kind === 'gift_card' ? 'Гифткарта' : 'Пополнение'} — ${it.product_name}`
          : 'Сервис';
      default: return it.type;
    }
  }

  protected statusLabel(s: string): string {
    switch (s) {
      case 'pending_payment': return 'Ожидает оплаты';
      case 'pending_kyc': return 'Требуется верификация';
      case 'paid': return 'Оплачен';
      case 'processing': return 'Обрабатывается';
      case 'issuing': return 'Выпускается';
      case 'issued': return 'Выпущена';
      case 'topping_up': return 'Зачисляется';
      case 'topped_up': return 'Зачислено';
      case 'completed': return 'Выполнен';
      case 'done': return 'Выполнен';
      case 'failed': return 'Ошибка';
      case 'refunded': return 'Возврат средств';
      case 'cancelled':
      case 'canceled': return 'Отменён';
      case 'expired': return 'Просрочен';
      default: return s;
    }
  }

  protected toneOf(s: string): 'ok' | 'wait' | 'bad' | 'neutral' {
    if (['paid', 'issued', 'topped_up', 'completed', 'done', 'issuing', 'topping_up'].includes(s)) return 'ok';
    if (['pending_payment', 'pending_kyc', 'processing'].includes(s)) return 'wait';
    if (['failed', 'refunded'].includes(s)) return 'bad';
    return 'neutral';
  }

  
  protected discountOf(it: ProfileOrderItem): string {
    const d = it.discount_amount ?? 0;
    if (d <= 0) return '';
    const cur = it.currency || it.payment_currency?.split('_')[0] || '';
    return `промокод −${formatAmount(d, cur)}`;
  }

  protected amountOf(it: ProfileOrderItem): string {
    if (it.amount != null && it.currency) return formatAmount(it.amount, it.currency);

    if (it.amount_payment != null && it.amount_payment > 0 && it.payment_currency) {
      return formatAmount(it.amount_payment, it.payment_currency.split('_')[0]);
    }
    return '';
  }

  protected dateOf(iso: string): string {
    return new Date(iso).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short', year: 'numeric' });
  }
}