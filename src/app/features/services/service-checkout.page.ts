import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { BackBarComponent } from '../../ui/back-bar.component';
import { ButtonComponent } from '../../ui/button.component';
import { PayButtonComponent } from '../../ui/pay-button.component';
import { PromoInputComponent } from '../../ui/promo-input.component';
import { InputComponent } from '../../ui/input.component';
import { HintComponent } from '../../ui/hint.component';
import {
  ServicesApi, ServiceDenomination, ServiceProduct, denominationLabel, isUnitTopup,
  serviceHasDenominations, serviceNeedsLogin, topupAmountLabel, topupCreditedDisplay,
  topupPayFor, visibleDenominations,
} from '../../core/api/services.api';
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

type PendingAction = 'pay' | 'free' | 'promo';

@Component({
  selector: 'app-service-checkout',
  standalone: true,
  imports: [
    BackBarComponent, ButtonComponent, PayButtonComponent, PromoInputComponent,
    InputComponent, HintComponent, EmailCodeDialog,
    RequisitesDialogComponent, CurrencyPickerDialogComponent,
  ],
  template: `<app-back-bar />
    @if (product(); as p) {
      <section class="wrap">
        <h2>{{ headline(p.kind) }} — {{ p.name }}</h2>

        <div class="summary">
          <div class="s-head">
            @if (p.icon_url) { <img class="s-ico" [src]="p.icon_url" alt="" /> }
            <div class="s-body">
              @if (needsLogin()) {
                <div class="s-line"><span class="s-lbl">{{ p.login_label || 'Логин' }}</span><span class="s-val">{{ login() }}</span></div>
              }
              @if (p.kind === 'account_topup') {
                <div class="s-line">
                  <span class="s-lbl">
                    К зачислению на {{ p.name }}
                    @if (!isUnit()) {
                      <app-hint [text]="'С учётом курсовой разницы на стороне ' + p.name + ' и провайдера услуг.'" />
                    }
                  </span>
                  <span class="s-val">{{ creditedLine() }}</span>
                </div>
              } @else if (denomination(); as d) {
                <div class="s-line">
                  <span class="s-lbl">{{ needsLogin() ? 'План' : 'Номинал' }}</span>
                  <span class="s-val">{{ denomLabel(d, p.denom_currency) }}</span>
                </div>
                <div class="s-line"><span class="s-lbl">Цена</span><span class="s-val">{{ money(d.price, p.issue_currency) }}</span></div>
              }
            </div>
          </div>
          @if (amountNote(); as note) {
            <p class="s-note">{{ note }}</p>
          }
          <button type="button" class="s-edit" (click)="backToDetail()">Изменить</button>
        </div>

        <div class="order">
          @if (isGuest()) {
            <label class="f-label">Email для чека{{ p.kind === 'gift_card' ? ' и кодов' : '' }}</label>
            <app-input
              [value]="email()"
              (valueChange)="onEmailChange($event)"
              type="email"
              autocomplete="email"
              inputmode="email"
              placeholder="you@example.com"
              [error]="emailError()"></app-input>
          }

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
          <app-button variant="primary" [full]="true" [loading]="loading()" [loadingLabel]="busyLabel()" (clicked)="payFree()">
            Получить бесплатно
          </app-button>
        } @else {
          <app-pay-button [loading]="loading()" [loadingLabel]="busyLabel()" [sbpLogo]="sbpOnly()"
                          [label]="'Перейти к оплате — ' + money(finalAmount(), p.issue_currency)"
                          (clicked)="onPayClicked()" />
        }
      </section>
    } @else if (notFound()) {
      <section class="wrap">
        <div class="stub">
          <p>Сервис не найден или параметры заказа неполные.</p>
          <app-button variant="secondary" (clicked)="goServices()">К сервисам</app-button>
        </div>
      </section>
    } @else {
      <section class="wrap" role="status" aria-label="Загрузка">
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
    }
`,
  styles: [`
    .wrap { padding: 0 16px; max-width: 560px; margin: 0 auto; padding-bottom: 110px; display: flex; flex-direction: column; gap: var(--space-lg); }
    h2 { text-align: center; margin: 0; }

    .summary {
      display: flex; flex-direction: column; gap: 8px;
      padding: var(--space-md);
      background: var(--color-surface);
      border: 1px solid transparent;
      border-radius: var(--rounded-lg);
      box-shadow: var(--shadow-card);
    }
    .s-head { display: flex; gap: var(--space-md); align-items: flex-start; }
    .s-ico { width: 44px; height: 44px; border-radius: 10px; object-fit: contain; flex: 0 0 44px; }
    .s-body { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 6px; }
    .s-line { display: flex; justify-content: space-between; gap: var(--space-sm); font-size: 14px; }
    .s-lbl { color: var(--color-muted); }
    .s-val { font-weight: 600; overflow-wrap: anywhere; text-align: right; }
    .s-edit {
      align-self: flex-end;
      background: none; border: none; padding: 4px 0;
      color: var(--color-primary-ink); font-size: 13px; font-weight: 500; cursor: pointer;
    }
    .s-edit:hover { text-decoration: underline; }
    
    .s-note { margin: 0; padding: 8px 12px; background: #fff7e6; color: #663300; border-radius: var(--rounded-md); font-size: 12px; line-height: 1.4; }

    .order {
      display: flex; flex-direction: column;
      padding: var(--space-md);
      background: var(--color-surface-card);
      border-radius: var(--rounded-lg);
      gap: var(--space-sm);
    }
    .f-label { font-size: 13px; font-weight: 600; color: var(--color-muted); }
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
    .skel-lg { height: 120px; }
    .skel::after {
      content: ""; position: absolute; inset: 0;
      background: linear-gradient(100deg, transparent 32%, color-mix(in srgb, #fff 55%, transparent) 50%, transparent 68%);
      transform: translateX(-100%);
      animation: sc-skel 1.6s ease-in-out infinite;
    }
    @keyframes sc-skel { to { transform: translateX(100%); } }
    @media (prefers-reduced-motion: reduce) { .skel::after { animation: none; } }
  `],
})
export class ServiceCheckoutPage implements OnInit {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly servicesApi = inject(ServicesApi);
  private readonly promoApi = inject(PromoApi);
  private readonly currency = inject(CurrencyService);
  private readonly auth = inject(AuthService);
  private readonly analytics = inject(AnalyticsService);
  private readonly toast = inject(ToastService);

  protected readonly product = signal<ServiceProduct | null>(null);
  protected readonly notFound = signal(false);
  protected readonly login = signal('');
  protected readonly amount = signal(0);
  protected readonly denomination = signal<ServiceDenomination | null>(null);
  
  protected readonly amountNote = signal('');

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
  private slug = '';

  protected readonly isGuest = computed(() => !this.auth.isAuthenticated());
  protected readonly busyLabel = computed(() => (this.isGuest() ? 'Отправляем код…' : 'Создание счёта…'));
  protected readonly sbpOnly = computed(() => {
    const list = this.currencies();
    return list.length === 1 && isSbpProvider(list[0].provider) && isMethodAvailable(list[0]);
  });

  protected readonly isUnit = computed(() => isUnitTopup(this.product()));
  
  protected readonly needsLogin = computed(() => serviceNeedsLogin(this.product()?.kind));
  
  protected readonly creditedLine = computed(() => {
    const p = this.product();
    if (!p) return '';
    if (isUnitTopup(p)) return topupAmountLabel(this.amount(), p, formatAmount);
    return `~ ${formatAmount(topupCreditedDisplay(this.basePrice(), p.fee_pct), p.amount_currency)}`;
  });
  
  protected readonly basePrice = computed(() => {
    const p = this.product();
    if (!p) return 0;
    if (serviceHasDenominations(p.kind)) return this.denomination()?.price ?? 0;
    return topupPayFor(this.amount(), p);
  });
  protected readonly finalAmount = computed(() => {
    const d = this.promoApplied();
    return Math.max(0, this.basePrice() - (d?.discount_amount ?? 0));
  });

  ngOnInit(): void {
    this.slug = this.route.snapshot.paramMap.get('slug') ?? '';
    const qp = this.route.snapshot.queryParamMap;
    this.servicesApi.productBySlug(this.slug).subscribe({
      next: (r) => {
        const p = r.product;
        if (!p || p.disable_purchase) {
          this.notFound.set(true);
          return;
        }
        if (serviceHasDenominations(p.kind)) {
          const denomId = qp.get('denomination') ?? '';
          const d = visibleDenominations(p).find((x) => x.id === denomId) ?? null;
          const login = (qp.get('login') ?? '').trim();
          if (!d || (serviceNeedsLogin(p.kind) && !login)) {
            void this.router.navigate(['/services', this.slug], { replaceUrl: true });
            return;
          }
          this.denomination.set(d);
          this.login.set(login);
        } else {
          const login = (qp.get('login') ?? '').trim();
          let amount = parseFloat((qp.get('amount') ?? '').replace(',', '.'));
          if (!login || !isFinite(amount) || amount <= 0) {
            void this.router.navigate(['/services', this.slug], { replaceUrl: true });
            return;
          }
          if (p.min_amount > 0 && amount < p.min_amount) {
            amount = p.min_amount;
            this.amountNote.set(`Минимум — ${formatAmount(topupPayFor(p.min_amount, p), p.issue_currency)}, ${isUnitTopup(p) ? 'количество увеличено' : 'сумма увеличена'}`);
          } else if (p.max_amount > 0 && amount > p.max_amount) {
            amount = p.max_amount;
            this.amountNote.set(`Максимум — ${formatAmount(topupPayFor(p.max_amount, p), p.issue_currency)}, ${isUnitTopup(p) ? 'количество уменьшено' : 'сумма уменьшена'}`);
          }
          this.login.set(login);
          this.amount.set(amount);
        }
        this.product.set(p);
      },
      error: () => this.notFound.set(true),
    });
    this.currency.loadMethods('issue', 'service').subscribe((r) => this.currencies.set(r.methods));
  }

  protected goServices(): void { void this.router.navigate(['/services']); }
  protected backToDetail(): void { void this.router.navigate(['/services', this.slug]); }

  protected onEmailChange(v: string): void {
    this.email.set(v);
    if (this.emailError()) this.emailError.set('');
  }

  
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

  protected onAuthenticated(): void {
    this.showCodeDialog.set(false);
    this.continuePending();
  }
  private continuePending(): void {
    const action = this.pendingAction;
    this.pendingAction = null;
    this.currency.loadMethods('issue', 'service').subscribe((r) => this.currencies.set(r.methods));
    switch (action) {
      case 'promo': this.applyPromo(); break;
      case 'free': this.payFree(); break;
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
    this.promoApi.validate({
      code: this.promoCode(), scope: 'issue',
      product_type: 'service', product_id: p.id,
      amount: this.basePrice(), currency: p.issue_currency,
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
      this.createOrder(c.id, {});
      return;
    }
    if (nonPhoneFromFields(c).length === 0) {
      this.createOrder(c.id, {});
      return;
    }
    this.requisitesFor.set(c);
  }
  onRequisites(reqs: Record<string, string>): void {
    const c = this.requisitesFor();
    this.requisitesFor.set(null);
    if (!c) return;
    this.createOrder(c.id, reqs);
  }
  payFree(): void {
    if (this.requireEmail('free')) return;
    this.createOrder('', {});
  }

  private createOrder(paymentCurrency: string, requisitesFrom: Record<string, string>): void {
    const p = this.product();
    if (!p) return;
    this.loading.set(true);
    const utm = this.analytics.getUtm();
    this.analytics.getMatomoVisitorId().then((matomoCid) => {
      this.servicesApi.createOrder({
        service_product_id: p.id,
        payment_currency: paymentCurrency,
        promo_code: this.promoCode() || undefined,
        login: serviceNeedsLogin(p.kind) ? this.login() : undefined,
        amount: p.kind === 'account_topup' ? this.amount() : undefined,
        denomination_id: serviceHasDenominations(p.kind) ? this.denomination()?.id : undefined,
        requisites_from: requisitesFrom,
        matomo_cid: matomoCid || undefined,
        utm: Object.keys(utm).length ? utm : undefined,
      }).subscribe({
        next: (res) => {
          this.loading.set(false);
          if (res.order.mode === 'redirect') openExternalLink(res.order.url);
          void this.router.navigate(['/services/orders', res.order.id, 'payment']);
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
          if (code === 'LOGIN_INVALID') {
            this.toast.error(msg);
            void this.router.navigate(['/services', this.slug]);
            return;
          }
          this.toast.error(msg);
        },
      });
    });
  }

  
  protected headline(kind: ServiceProduct['kind']): string {
    switch (kind) {
      case 'account_topup': return 'Пополнение';
      case 'subscription': return 'Подписка';
      default: return 'Покупка';
    }
  }

  protected chargeSymbol(): string {
    return symbolFor(this.product()?.issue_currency ?? '');
  }
  
  protected denomLabel(d: ServiceDenomination, denomCurrency: string): string {
    return denominationLabel(d, denomCurrency, (v, c) => formatAmount(v, c));
  }

  protected money(v: number | string | null | undefined, c: string | null | undefined): string { return formatAmount(v, c); }
}
