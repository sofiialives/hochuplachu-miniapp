import { Component, OnInit, inject, signal } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { BackBarComponent } from '../../ui/back-bar.component';
import { ButtonComponent } from '../../ui/button.component';
import { CopyButtonComponent } from '../../ui/copy-button.component';
import { ServicesApi, ServiceKind, ServiceOrder, orderGross, serviceNeedsLogin, topupCreditedDisplay } from '../../core/api/services.api';
import { ToastService } from '../../core/notifications/toast.service';
import { formatAmount } from '../../core/currency/currency-symbols';

@Component({
  selector: 'app-service-order',
  standalone: true,
  imports: [BackBarComponent, ButtonComponent, CopyButtonComponent, RouterLink],
  template: `<app-back-bar />
    <section class="wrap">
      <h2>Заказ</h2>
      @if (order(); as o) {
        <div class="card">
          <div class="row">
            <span class="lbl">Сервис</span>
            <span class="val">{{ o.product_name }}</span>
          </div>
          <div class="row">
            <span class="lbl">Статус</span>
            <span class="badge" [attr.data-status]="o.status">{{ statusLabel(o.status) }}</span>
          </div>
          @if (needsLogin(o.kind)) {
            <div class="row">
              <span class="lbl">Логин</span>
              <span class="val">{{ o.login }}</span>
            </div>
          }
          @if (o.kind === 'account_topup') {
            <div class="row">
              <span class="lbl">К зачислению</span>
              <!-- «~» только у ДЕНЕЖНОГО пополнения: там это оценка (курс на
                   стороне сервиса плавает). Штучный товар куплен точно: «50 ⭐». -->
              <span class="val">{{ creditedLine(o) }}</span>
            </div>
          } @else {
            <div class="row">
              <span class="lbl">{{ o.kind === 'subscription' ? 'План' : 'Номинал' }}</span>
              <span class="val">{{ o.denom_label || money(o.denom_value ?? 0, o.denom_currency) }}</span>
            </div>
          }
          <div class="row">
            <span class="lbl">Сумма</span>
            <span class="val">{{ money(gross(o), o.price_currency) }}</span>
          </div>
          <!-- Промокод показываем ТОЛЬКО когда он применён: без него строка
               «−0 ₽» была бы шумом. «Сумма» выше — цена заказа ДО скидки,
               поэтому под 100% промокодом заявка не выглядит нулевой. -->
          @if (discount(o) > 0) {
            <div class="row">
              <span class="lbl">Промокод</span>
              <span class="val promo">−{{ money(discount(o), o.price_currency) }}</span>
            </div>
            <div class="row">
              <span class="lbl">К оплате</span>
              <span class="val">{{ money(o.price, o.price_currency) }}</span>
            </div>
          }
          @if (o.created_at) {
            <div class="row">
              <span class="lbl">Создан</span>
              <span class="val">{{ dateOf(o.created_at) }}</span>
            </div>
          }
        </div>

        @if (o.kind === 'gift_card' && o.codes_issued) {
          @if (codes(); as list) {
            <div class="codes">
              @for (code of list; track $index) {
                <div class="secret-row">
                  <span class="secret mono">{{ code }}</span>
                  <app-copy-button [value]="code" label="Код" />
                </div>
              }
            </div>
          } @else {
            <app-button variant="primary" [full]="true" [loading]="codesLoading()" [disabled]="codesLoading()" (clicked)="loadCodes()">Показать коды</app-button>
          }
        } @else if (o.status === 'pending_payment' || o.status === 'pending_kyc') {
          <a [routerLink]="['/services/orders', o.id, 'payment']" class="pay-link">
            <app-button variant="primary" [full]="true">Перейти к оплате</app-button>
          </a>
        } @else if (o.status === 'paid' || o.status === 'processing') {
          <p class="muted center">Оплата получена — заказ обрабатывается. Обычно это занимает не больше пары минут.</p>
        } @else if (o.status === 'completed' && o.kind === 'account_topup') {
          <p class="muted center">Аккаунт пополнен. Подтверждение отправлено на email.</p>
        } @else if (o.status === 'completed' && o.kind === 'subscription') {
          <p class="muted center">Подписка оформлена — провайдер включит её на аккаунт в течение нескольких минут. Подтверждение отправлено на email.</p>
        } @else if (o.status === 'refunded') {
          <p class="muted center">Заказ не выполнен — средства будут возвращены.</p>
        } @else if (o.status === 'failed') {
          <p class="muted center">Заказ не выполнен. Обратитесь в поддержку — мы поможем решить проблему.</p>
        }

        <a class="link-btn" routerLink="/services">К сервисам</a>
      } @else if (notFound()) {
        <p class="muted center">Заказ не найден.</p>
        <a class="link-btn" routerLink="/services">К сервисам</a>
      } @else {
        <div role="status" aria-label="Загрузка заказа">
          <span class="skel"></span>
          <span class="skel"></span>
        </div>
      }
    </section>`,
  styles: [`
    .wrap { padding: var(--space-md); max-width: 560px; margin: 0 auto; padding-bottom: 110px; display: flex; flex-direction: column; gap: var(--space-md); }
    h2 { text-align: center; margin: 0; }
    .muted { color: var(--color-muted); }
    .center { text-align: center; }
    .card {
      display: flex; flex-direction: column;
      padding: 4px var(--space-md);
      background: var(--color-surface);
      border: 1px solid var(--color-hairline-soft);
      border-radius: var(--rounded-lg);
    }
    .row {
      display: flex; align-items: center; justify-content: space-between; gap: var(--space-sm);
      padding: 12px 0;
      border-bottom: 1px solid var(--color-hairline-soft);
    }
    .row:last-child { border-bottom: none; }
    .lbl { color: var(--color-muted); font-size: 13px; }
    .val { font-weight: 500; text-align: right; overflow-wrap: anywhere; }
    .badge {
      padding: 4px 10px; border-radius: var(--rounded-pill);
      font-size: 12px; font-weight: 600;
      background: color-mix(in srgb, var(--color-muted) 14%, transparent);
      color: var(--color-muted);
    }
    .badge[data-status="completed"] { background: color-mix(in srgb, var(--color-success) 14%, transparent); color: var(--color-success); }
    .badge[data-status="paid"], .badge[data-status="processing"], .badge[data-status="pending_payment"], .badge[data-status="pending_kyc"] { background: color-mix(in srgb, var(--color-warning) 16%, transparent); color: var(--color-warning); }
    .badge[data-status="failed"], .badge[data-status="refunded"] { background: color-mix(in srgb, var(--color-error) 12%, transparent); color: var(--color-error); }
    .codes { display: flex; flex-direction: column; gap: var(--space-sm); }
    .secret-row {
      display: flex; align-items: center; gap: var(--space-sm);
      padding: 10px 12px;
      background: var(--color-canvas);
      border: 1px solid var(--color-hairline);
      border-radius: var(--rounded-md);
    }
    .secret { flex: 1; min-width: 0; overflow-wrap: anywhere; font-size: 13px; }
    .secret.mono { font-family: var(--font-mono); }
    .pay-link { text-decoration: none; }
    .link-btn {
      align-self: center;
      color: var(--color-primary-ink); font-size: 14px; font-weight: 500;
      text-decoration: none; padding: var(--space-sm);
    }
    .link-btn:hover { text-decoration: underline; }
    .skel {
      display: block; height: 72px; border-radius: var(--rounded-lg); margin-bottom: var(--space-sm);
      background: color-mix(in srgb, var(--color-primary) 6%, var(--color-surface));
      position: relative; overflow: hidden;
    }
    .skel::after {
      content: ""; position: absolute; inset: 0;
      background: linear-gradient(100deg, transparent 32%, color-mix(in srgb, #fff 55%, transparent) 50%, transparent 68%);
      transform: translateX(-100%);
      animation: so-skel 1.6s ease-in-out infinite;
    }
    @keyframes so-skel { to { transform: translateX(100%); } }
    @media (prefers-reduced-motion: reduce) { .skel::after { animation: none; } }
      .row .val.promo { color: var(--color-success); }
  `],
})
export class ServiceOrderPage implements OnInit {
  private readonly route = inject(ActivatedRoute);
  private readonly servicesApi = inject(ServicesApi);
  private readonly toast = inject(ToastService);

  protected readonly order = signal<ServiceOrder | null>(null);
  protected readonly notFound = signal(false);
  protected readonly codes = signal<string[] | null>(null);
  protected readonly codesLoading = signal(false);
  private id = '';

  ngOnInit(): void {
    this.id = this.route.snapshot.paramMap.get('id') ?? '';
    if (!this.id) {
      this.notFound.set(true);
      return;
    }
    this.servicesApi.getOrder(this.id).subscribe({
      next: (r) => this.order.set(r.order),
      error: () => this.notFound.set(true),
    });
  }

  protected loadCodes(): void {
    if (this.codesLoading()) return;
    this.codesLoading.set(true);
    this.servicesApi.codes(this.id).subscribe({
      next: (r) => { this.codesLoading.set(false); this.codes.set(r.codes ?? []); },
      error: (e) => {
        this.codesLoading.set(false);
        this.toast.error(e?.error?.error?.message ?? 'Коды ещё не получены');
      },
    });
  }

  protected statusLabel(s: string): string {
    switch (s) {
      case 'pending_payment': return 'Ожидает оплаты';
      case 'pending_kyc': return 'Требуется верификация';
      case 'paid': return 'Оплачен';
      case 'processing': return 'Обрабатывается';
      case 'completed': return 'Выполнен';
      case 'failed': return 'Ошибка';
      case 'refunded': return 'Возврат средств';
      case 'cancelled': return 'Отменён';
      default: return s;
    }
  }
  protected money(v: number, c: string | null | undefined): string { return formatAmount(v, c); }
  
  protected gross(o: ServiceOrder): number { return orderGross(o); }
  protected discount(o: ServiceOrder): number { return o.discount_amount ?? 0; }
  protected needsLogin(kind: ServiceKind): boolean { return serviceNeedsLogin(kind); }

  
  protected creditedLine(o: ServiceOrder): string {
    const amount = o.amount ?? 0;
    if (o.amount_unit) return `${amount} ${o.amount_unit}`;
    return `~ ${formatAmount(topupCreditedDisplay(orderGross(o), o.fee_pct ?? 0), o.amount_currency)}`;
  }
  protected dateOf(iso: string): string {
    return new Date(iso).toLocaleString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  }
}
