import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { BackBarComponent } from '../../ui/back-bar.component';
import { ButtonComponent } from '../../ui/button.component';
import { PayButtonComponent } from '../../ui/pay-button.component';
import { PromoInputComponent } from '../../ui/promo-input.component';
import { InputComponent } from '../../ui/input.component';
import { EsimApi, EsimProduct, daysWord, formatDataMb } from '../../core/api/esim.api';
import { PromoApi, PromoValidation } from '../../core/api/promo.api';
import { CurrencyService, PaymentCurrency, isMethodAvailable, isSbpProvider, nonPhoneFromFields } from '../../core/currency/currency.service';
import { AuthService } from '../../core/auth/auth.service';
import { AnalyticsService } from '../../core/analytics/analytics.service';
import { ToastService } from '../../core/notifications/toast.service';
import { EMAIL_REGEX, extractApiError } from '../../core/errors/api-error';
import { EmailCodeDialog } from '../auth/email-code.dialog';
import { RequisitesDialogComponent } from '../cards/requisites.dialog';
import { CurrencyPickerDialogComponent } from '../cards/currency-picker.dialog';
import { openExternalLink } from '../../core/utils/open-external';
import { formatAmount, symbolFor } from '../../core/currency/currency-symbols';

/** Действие, отложенное до подтверждения email. */
type PendingAction = 'pay' | 'free' | 'promo';

// EsimCheckoutPage — «/esim/:id/checkout» (композиция референса
// esim-preorder.png): сводка тарифа, промокод, метод оплаты, итог.
// БЕЗ authGuard — гейт внутри (гостевой email-flow как на чекауте карт;
// pendingAction переживает диалог кода). gateVerification/strict-редирект
// НЕ вызывается (решение №4 дизайна).
// Email у авторизованного НЕ спрашиваем ВООБЩЕ — паритет с выпуском карты:
// QR уходит на адрес аккаунта (его подставляет бэк, `deliveryEmailFor`), а
// если адреса нет — покупка всё равно проходит, QR остаётся в приложении.
// Поле в форме видит только гость: ему адрес нужен как логин.
@Component({
  selector: 'app-esim-checkout',
  standalone: true,
  imports: [
    BackBarComponent, ButtonComponent, PayButtonComponent, PromoInputComponent,
    InputComponent, EmailCodeDialog,
    RequisitesDialogComponent, CurrencyPickerDialogComponent,
  ],
  template: `<app-back-bar />
    @if (product(); as p) {
      <section class="wrap">
        <h2>Покупка eSIM</h2>

        <div class="summary">
          <div class="s-head">
            <div>
              <div class="s-country">{{ p.country_name || 'Глобальный' }}</div>
              <div class="s-name">{{ p.name }}</div>
            </div>
            <div class="s-price">{{ money(p.issue_price, p.issue_currency) }}</div>
          </div>
          <div class="s-meta">
            <span class="s-chip">{{ mb(p.data_mb) }}</span>
            <span class="s-chip">{{ p.days }} {{ daysLabel(p.days) }}</span>
          </div>
          @if (p.description) { <p class="s-desc">{{ p.description }}</p> }
        </div>

        <div class="order">
          @if (isGuest()) {
            <label class="f-label">Email для QR-кода</label>
            <app-input
              [value]="email()"
              (valueChange)="onEmailChange($event)"
              type="email"
              autocomplete="email"
              inputmode="email"
              placeholder="you@example.com"
              [error]="emailError()"></app-input>
          }
          <p class="f-hint">QR-код и инструкция по установке придут на email сразу после оплаты.</p>

          <app-promo-input
            [(code)]="promoCode"
            [applied]="promoApplied()"
            [loading]="promoLoading()"
            [showDiscount]="false"
            [error]="promoError()"
            (codeChanged)="onPromoChanged()"
            (apply)="applyPromo()" />

          @if (promoApplied(); as d) {
            <div class="row">
              <span>Скидка</span>
              <span class="green">−{{ money(d.discount_amount, d.currency) }}</span>
            </div>
          }
          <div class="row total">
            <span>К оплате</span>
            <span class="total-val">{{ money(finalAmount(), p.issue_currency) }}</span>
          </div>
        </div>

        @if (finalAmount() <= 0 && promoApplied()) {
          <app-button variant="primary" [full]="true" [loading]="loading()" [loadingLabel]="busyLabel()" (clicked)="issueFree()">
            Получить eSIM бесплатно
          </app-button>
        } @else {
          <app-pay-button [loading]="loading()" [loadingLabel]="busyLabel()" [sbpLogo]="sbpOnly()"
                          [label]="'Перейти к оплате — ' + money(finalAmount(), p.issue_currency)"
                          (clicked)="onPayClicked()" />
        }
      </section>
    } @else if (unavailable()) {
      <section class="wrap">
        <div class="stub">
          <p>Тариф временно недоступен.</p>
          <app-button variant="secondary" (clicked)="goBack()">К тарифам</app-button>
        </div>
      </section>
    } @else if (loadFailed()) {
      <section class="wrap">
        <div class="stub">
          <p>Тариф не найден или временно недоступен.</p>
          <app-button variant="secondary" (clicked)="goBack()">К тарифам</app-button>
        </div>
      </section>
    } @else {
      <section class="wrap" role="status" aria-label="Загрузка тарифа">
        <span class="skel skel-lg"></span>
        <span class="skel"></span>
        <span class="skel"></span>
      </section>
    }

    @if (showPicker()) {
      <app-currency-picker-dialog
        [currencies]="currencies()"
        [amount]="finalAmount()"
        [issueCurrency]="product()?.issue_currency ?? ''"
        [chargeSymbol]="chargeSymbol()"
        (dismissed)="showPicker.set(false)"
        (selected)="selectCurrency($event)" />
    }

    @if (requisitesFor(); as c) {
      <app-requisites-dialog [currency]="c" (dismissed)="requisitesFor.set(null)" (submitted)="onRequisites($event)" />
    }

    @if (showCodeDialog()) {
      <app-email-code-dialog
        [email]="email().trim().toLowerCase()"
        (authenticated)="onAuthenticated()"
        (changeEmail)="onChangeEmail()"
        (dismissed)="onCodeDismissed()" />
    }`,
  styles: [`
    .wrap { padding: var(--space-md); max-width: 560px; margin: 0 auto; padding-bottom: var(--space-xl); display: flex; flex-direction: column; gap: var(--space-lg); }
    h2 { text-align: center; margin: 0; }

    .summary {
      display: flex; flex-direction: column; gap: 10px;
      padding: var(--space-md);
      background: var(--color-surface);
      border: 1px solid transparent;
      border-radius: var(--rounded-lg);
      box-shadow: var(--shadow-card);
    }
    .s-head { display: flex; align-items: flex-start; justify-content: space-between; gap: var(--space-sm); }
    .s-country { font-weight: 600; font-size: 18px; }
    .s-name { color: var(--color-muted); font-size: 13px; margin-top: 2px; }
    .s-price { font-family: var(--font-display); font-size: 22px; color: var(--color-primary-ink); white-space: nowrap; }
    .s-meta { display: flex; gap: 8px; flex-wrap: wrap; }
    .s-chip {
      padding: 4px 12px; border-radius: var(--rounded-pill);
      background: var(--color-surface-card); font-size: 13px; font-weight: 500;
    }
    .s-desc { margin: 0; color: var(--color-body); font-size: 14px; line-height: 1.5; }

    .order {
      display: flex; flex-direction: column;
      padding: var(--space-md);
      background: var(--color-surface-card);
      border-radius: var(--rounded-lg);
      gap: var(--space-sm);
    }
    .f-label { font-size: 13px; font-weight: 600; color: var(--color-muted); }
    .f-hint { margin: 0; font-size: 12px; color: var(--color-muted); }
    .row {
      display: flex; justify-content: space-between; align-items: baseline;
      padding-top: var(--space-sm);
      font-size: 15px; color: var(--color-body);
      border-top: 1px solid color-mix(in srgb, var(--color-hairline) 60%, transparent);
    }
    .row.total { font-weight: 500; font-size: 16px; color: var(--color-ink); }
    .total-val { font-family: var(--font-display); font-size: 22px; color: var(--color-primary-ink); font-weight: 500; }
    .green { color: var(--color-success); font-weight: 500; }

    .stub { text-align: center; padding: var(--space-xl) 0; display: flex; flex-direction: column; gap: var(--space-md); align-items: center; }

    .skel {
      display: block; height: 56px; border-radius: var(--rounded-lg);
      background: color-mix(in srgb, var(--color-primary) 6%, var(--color-surface));
      position: relative; overflow: hidden;
    }
    .skel-lg { height: 140px; }
    .skel::after {
      content: ""; position: absolute; inset: 0;
      background: linear-gradient(100deg, transparent 32%, color-mix(in srgb, #fff 55%, transparent) 50%, transparent 68%);
      transform: translateX(-100%);
      animation: ec-skel 1.6s ease-in-out infinite;
    }
    @keyframes ec-skel { to { transform: translateX(100%); } }
    @media (prefers-reduced-motion: reduce) { .skel::after { animation: none; } }
  `],
})
export class EsimCheckoutPage implements OnInit {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly esimApi = inject(EsimApi);
  private readonly promoApi = inject(PromoApi);
  private readonly currency = inject(CurrencyService);
  private readonly auth = inject(AuthService);
  private readonly analytics = inject(AnalyticsService);
  private readonly toast = inject(ToastService);

  protected readonly product = signal<EsimProduct | null>(null);
  protected readonly loadFailed = signal(false);
  /** Тариф есть в каталоге, но скрыт от покупки (disable_purchase). */
  protected readonly unavailable = signal(false);
  protected readonly promoCode = signal('');
  protected readonly promoApplied = signal<PromoValidation | null>(null);
  protected readonly promoLoading = signal(false);
  protected readonly promoError = signal('');
  protected readonly loading = signal(false);
  protected readonly showPicker = signal(false);
  protected readonly currencies = signal<PaymentCurrency[]>([]);
  protected readonly requisitesFor = signal<PaymentCurrency | null>(null);

  protected readonly email = signal('');
  protected readonly emailError = signal('');
  protected readonly showCodeDialog = signal(false);
  private pendingAction: PendingAction | null = null;

  protected readonly isGuest = computed(() => !this.auth.isAuthenticated());
  protected readonly busyLabel = computed(() => (this.isGuest() ? 'Отправляем код…' : 'Создание счёта…'));
  protected readonly sbpOnly = computed(() => {
    const list = this.currencies();
    return list.length === 1 && isSbpProvider(list[0].provider) && isMethodAvailable(list[0]);
  });

  protected readonly finalAmount = computed(() => {
    const p = this.product();
    if (!p) return 0;
    const d = this.promoApplied();
    return Math.max(0, p.issue_price - (d?.discount_amount ?? 0));
  });

  ngOnInit(): void {
    const id = this.route.snapshot.paramMap.get('id') ?? '';
    this.esimApi.product(id).subscribe({
      next: (r) => {
        const p = r.product ?? null;
        // disable_purchase — заглушка вместо формы чекаута (паритет с
        // service-checkout). Отдельного поля available/coming_soon в DTO нет:
        // тариф без резолвящегося провайдера бэк отдаёт как 404 — такой уходит
        // в ветку loadFailed.
        if (p?.disable_purchase) {
          this.unavailable.set(true);
          return;
        }
        this.product.set(p);
        this.loadFailed.set(!p);
      },
      error: () => this.loadFailed.set(true),
    });
    this.currency.loadMethods('issue', 'esim').subscribe((r) => this.currencies.set(r.methods));
  }

  protected goBack(): void { void this.router.navigate(['/esim']); }

  protected onEmailChange(v: string): void {
    this.email.set(v);
    if (this.emailError()) this.emailError.set('');
  }

  /** Гостю нужен email до любого действия, которое требует сессии (зеркало
   *  `requireAuth` чекаута карт). true = flow запущен, выходим. Авторизованного
   *  НЕ гейтим: адрес доставки бэкенд берёт из аккаунта, а его отсутствие
   *  покупку не блокирует — паритет с выпуском карты. Порядок ветвей важен:
   *  поле email видит только гость, поэтому его валидация идёт ПОСЛЕ проверки
   *  сессии — иначе у авторизованного пустой сигнал не проходил бы регексп и
   *  кнопки гасились молча (ошибку рисовать негде). */
  private requireEmail(action: PendingAction): boolean {
    if (this.auth.isAuthenticated()) return false;
    const value = this.email().trim().toLowerCase();
    if (!EMAIL_REGEX.test(value)) {
      this.emailError.set('Введите корректный email, например you@example.com');
      return true;
    }
    this.pendingAction = action;
    this.loading.set(true);
    this.auth.requestCode(value).subscribe({
      next: () => {
        this.loading.set(false);
        this.showCodeDialog.set(true);
      },
      error: (err) => {
        this.loading.set(false);
        this.pendingAction = null;
        const e = extractApiError(err);
        this.emailError.set(e.code === 'RATE_LIMITED'
          ? 'Слишком много запросов. Попробуйте через минуту.'
          : (e.message ?? 'Не удалось отправить код'));
      },
    });
    return true;
  }

  /** Сессия установлена — методы перегружаем (условные валюты зависят от
   *  юзера) и доигрываем отложенное действие тем же кликом. */
  protected onAuthenticated(): void {
    this.showCodeDialog.set(false);
    this.continuePending();
  }
  private continuePending(): void {
    const action = this.pendingAction;
    this.pendingAction = null;
    this.currency.loadMethods('issue', 'esim').subscribe((r) => this.currencies.set(r.methods));
    switch (action) {
      case 'promo': this.applyPromo(); break;
      case 'free': this.issueFree(); break;
      case 'pay': this.onPayClicked(); break;
    }
  }
  protected onChangeEmail(): void { this.showCodeDialog.set(false); this.pendingAction = null; }
  protected onCodeDismissed(): void { this.showCodeDialog.set(false); this.pendingAction = null; }

  applyPromo(): void {
    const p = this.product();
    if (!p || !this.promoCode().trim()) return;
    if (this.requireEmail('promo')) return;
    this.promoLoading.set(true);
    this.promoError.set('');
    // Цена eSIM фиксирована на продукте — бэк резолвит её сам по product_id.
    this.promoApi.validate({
      code: this.promoCode(), scope: 'issue',
      product_type: 'esim', product_id: p.id,
    }).subscribe({
      next: (d) => { this.promoLoading.set(false); this.promoApplied.set(d); },
      error: (err) => {
        this.promoLoading.set(false);
        this.promoApplied.set(null);
        this.promoError.set(err?.error?.error?.message ?? 'Промокод не действителен');
      },
    });
  }

  onPromoChanged(): void {
    this.promoApplied.set(null);
    this.promoError.set('');
  }

  onPayClicked(): void {
    if (this.requireEmail('pay')) return;
    const list = this.currencies();
    const avail = list.filter(isMethodAvailable);
    if (list.length === 1 && avail.length === 1) {
      this.selectCurrency(avail[0]);
      return;
    }
    this.showPicker.set(true);
  }

  selectCurrency(c: PaymentCurrency): void {
    this.showPicker.set(false);
    if (isSbpProvider(c.provider)) {
      this.issue(c.id, {});
      return;
    }
    if (nonPhoneFromFields(c).length === 0) {
      this.issue(c.id, {});
      return;
    }
    this.requisitesFor.set(c);
  }
  onRequisites(reqs: Record<string, string>): void {
    const c = this.requisitesFor();
    this.requisitesFor.set(null);
    if (!c) return;
    this.issue(c.id, reqs);
  }
  issueFree(): void {
    if (this.requireEmail('free')) return;
    this.issue('', {});
  }

  private issue(paymentCurrency: string, requisitesFrom: Record<string, string>): void {
    const p = this.product();
    if (!p) return;
    this.loading.set(true);
    const utm = this.analytics.getUtm();
    this.analytics.getMatomoVisitorId().then((matomoCid) => {
      this.esimApi.createOrder({
        esim_product_id: p.id,
        payment_currency: paymentCurrency,
        promo_code: this.promoCode() || undefined,
        requisites_from: requisitesFrom,
        matomo_cid: matomoCid || undefined,
        utm: Object.keys(utm).length ? utm : undefined,
      }).subscribe({
        next: (res) => {
          this.loading.set(false);
          // redirect-СБП: пейформа эквайра — сразу в новом окне (окно
          // активации клика ещё живо — попап-блокер пропускает); страница
          // оплаты покажет «ожидание платежа» с кнопкой-фолбэком.
          if (res.order.mode === 'redirect') openExternalLink(res.order.url);
          // Free-заявка тоже уходит на payment-страницу: она поллит до
          // ТЕРМИНАЛЬНОГО статуса и покажет QR, когда eSIM выпустится.
          void this.router.navigate(['/esim/orders', res.order.id, 'payment']);
        },
        error: (e) => {
          this.loading.set(false);
          const code: string = e?.error?.error?.code ?? '';
          const msg: string = e?.error?.error?.message ?? 'Ошибка';
          if (code.startsWith('PROMO_')) {
            this.promoApplied.set(null);
            this.promoError.set(msg);
            return;
          }
          this.toast.error(msg);
        },
      });
    });
  }

  protected chargeSymbol(): string {
    return symbolFor(this.product()?.issue_currency ?? '');
  }
  protected money(v: number | string | null | undefined, c: string | null | undefined): string { return formatAmount(v, c); }
  protected mb(v: number): string { return formatDataMb(v); }
  protected daysLabel(n: number): string { return daysWord(n); }
}
