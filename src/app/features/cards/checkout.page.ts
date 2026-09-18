import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { CardsApi, CardProduct } from '../../core/api/cards.api';
import { OrdersApi, storeIssuingOrderId } from '../../core/api/orders.api';
import { PromoApi, PromoValidation } from '../../core/api/promo.api';
import { BackBarComponent } from '../../ui/back-bar.component';
import { PayButtonComponent } from '../../ui/pay-button.component';
import { ButtonComponent } from '../../ui/button.component';
import { CardTileComponent } from '../../ui/card-tile.component';
import { PromoInputComponent } from '../../ui/promo-input.component';
import { CurrencyService, PaymentCurrency, isMethodAvailable, isSbpProvider, nonPhoneFromFields } from '../../core/currency/currency.service';
import { openExternalLink } from '../../core/utils/open-external';
import { VerificationService } from '../../core/verification/verification.service';
import { previewRate } from '../../core/currency/level-calc';
import { RuntimeConfigService } from '../../core/config/runtime-config.service';
import { ToastService } from '../../core/notifications/toast.service';
import { AnalyticsService } from '../../core/analytics/analytics.service';
import { AuthService } from '../../core/auth/auth.service';
import { EMAIL_REGEX, extractApiError } from '../../core/errors/api-error';
import { EmailCodeDialog } from '../auth/email-code.dialog';
import { InputComponent } from '../../ui/input.component';
import { RequisitesDialogComponent } from './requisites.dialog';
import { CurrencyPickerDialogComponent } from './currency-picker.dialog';
import { formatAmount, isPrefixSymbolCurrency, symbolFor } from '../../core/currency/currency-symbols';
import { GuideTargetDirective } from '../guides/guide-target.directive';
import { GuideClickTargetDirective } from '../guides/guide-click-target.directive';

type PendingAction = 'pay' | 'free' | 'promo';

@Component({
  selector: 'app-checkout',
  standalone: true,
  imports: [
    BackBarComponent, PayButtonComponent, ButtonComponent,
    CardTileComponent, PromoInputComponent, InputComponent,
    RequisitesDialogComponent, CurrencyPickerDialogComponent, EmailCodeDialog,
    GuideTargetDirective, GuideClickTargetDirective,
  ],
  template: `<app-back-bar />
    @if (product(); as p) {
      <section class="wrap">
        <div class="right-side">
          <h2>Оформление</h2>

          <div class="right-col" appGuideTarget="checkout-pay">
            <div class="order">
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
              @if (isGuest()) {
                <app-input
                  class="guest-email"
                  [value]="email()"
                  (valueChange)="onEmailChange($event)"
                  (enterPressed)="onPayClicked()"
                  type="email"
                  autocomplete="email"
                  inputmode="email"
                  placeholder="Введите email"
                  [error]="emailError()"></app-input>
              }

              <div class="row total">
                <span>Итого к оплате</span>
                <span class="total-val">{{ money(finalAmount(), p.issue_currency) }}</span>
              </div>
            </div>

            <label class="agree">
              <span class="agree-box" [class.checked]="agreed()" (click)="agreed.set(!agreed())" role="checkbox" [attr.aria-checked]="agreed()" tabindex="0" (keydown.enter)="agreed.set(!agreed())" (keydown.space)="agreed.set(!agreed()); $event.preventDefault()">
                @if (agreed()) {
                  <svg xmlns="http://www.w3.org/2000/svg" width="16" height="12" viewBox="0 0 18 14" fill="none">
                    <path d="M0.652344 7.45595L5.30878 12.1124L16.7708 0.650391" stroke="white" stroke-width="1.84211"/>
                  </svg>
                }
              </span>
              <span>Открывая карту, вы соглашаетесь с <a [href]="legalUrl('agreement')" target="_blank" rel="noopener">Условиями использования</a> и <a [href]="legalUrl('privacy')" target="_blank" rel="noopener">Политикой конфиденциальности</a></span>
            </label>

            <!-- loadingLabel зависит от того, что реально происходит по клику:
                 у гостя первый клик отправляет код на почту, а не создаёт счёт. -->
            @if (finalAmount() <= 0 && promoApplied()) {
              <app-button variant="primary" [full]="true" [disabled]="!agreed()" [loading]="loading()" [loadingLabel]="busyLabel()" (click)="issueFree()">
                Получить карту бесплатно
              </app-button>
            } @else {
              <app-pay-button appGuideClickTarget="checkout-pay" [disabled]="!agreed()" [loading]="loading()" [loadingLabel]="busyLabel()" [sbpLogo]="sbpOnly()" (clicked)="onPayClicked()" />
            }
          </div>
        </div>

        <div class="ticket">
          <app-card-tile [product]="p" />
          <div class="info">
            <div class="name">{{ p.name }}</div>
            <div class="divider" aria-hidden="true"></div>
            <div class="price">
              @if (symBefore(p.issue_currency)) {
                <span class="ccy">{{ symbol(p.issue_currency) }}</span>{{ p.issue_price }}
              } @else {
                {{ p.issue_price }} <span class="ccy">{{ symbol(p.issue_currency) }}</span>
              }
            </div>
          </div>
        </div>
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
    .wrap {
      display: flex; flex-direction: column;
      gap: var(--space-lg);
      padding: 0 16px;
      padding-bottom: 110px;
      max-width: 1200px; margin: 0 auto;
    }
    
    .right-side { display: contents; }
    h2 { order: 1; text-align: center; margin: 0; }

    
    .ticket {
      order: 2;
      display: flex; flex-direction: column; align-items: center;
      justify-content: center;
      padding: 44px 52px;
      background: rgba(255, 245, 222, 1);
      border: 1.51px solid rgba(200, 200, 200, 1);
      border-radius: var(--rounded-lg);
      box-shadow: 0px 26.88px 64.02px -21.99px rgba(0, 0, 0, 0.15);
    }
    .ticket app-card-tile { width: 100%; max-width: 320px; }
    .info { width: 100%; text-align: center; margin-top: 52px; }
    
    .name { font-family: 'Syncopate Cyr'; font-size: 22px; text-transform: uppercase; color: var(--color-ink); }
    .divider { width: 78px; height: 2px; background: rgba(200, 200, 200, 1); margin: 20px auto 0; }
    
    .price { font-family: 'Syncopate Cyr'; font-size: 26px; color: rgba(114, 86, 22, 1); line-height: 1.1; margin-top: 14px; }
    .price .ccy { font-size: 16px; color: rgba(114, 86, 22, 1); margin-left: 4px; vertical-align: 0.15em; font-family: 'Syncopate Cyr'; }
    
    .price .ccy:first-child { margin-left: 0; margin-right: 1px; }

      @media (max-width: 530px) {
        .name { font-size: 16px }

    }
    
    .order {
      display: flex; flex-direction: column;
      padding: 24px 18px;
      background: rgba(255, 255, 255, 1);
      border-radius: var(--rounded-lg);
    }
    .row {
      display: flex; justify-content: space-between; align-items: baseline;
      padding: var(--space-md) 0 var(--space-sm);
      font-size: 15px; color: var(--color-body);
    }
    .row + .row { border-top: 1px solid color-mix(in srgb, var(--color-hairline) 60%, transparent); padding-top: var(--space-sm); }
    .row.total { font-weight: 500; font-size: 16px; color: var(--color-ink); }
    .total-val { font-family: var(--font-display); font-size: 22px; color: var(--color-primary-ink); font-weight: 500; }
    .green { color: var(--color-success); font-weight: 500; }

    .agree {
      display: flex; align-items: flex-start; gap: 10px;
      color: var(--color-muted); font-size: 13px; line-height: 1.5;
      cursor: pointer;
    }
    
    .agree-box {
      flex: 0 0 auto;
      flex-shrink: 0; flex-grow: 0;
      width: 18px; height: 18px;
      min-width: 18px; min-height: 18px;
      max-width: 18px; max-height: 18px;
      display: inline-flex; align-items: center; justify-content: center;
      align-self: flex-start;
      background: rgba(255, 186, 38, 1);
      border-radius: 8px;
      padding: 8px;
      box-sizing: content-box;
      cursor: pointer;
    }
    .agree-box svg { display: block; }
    .agree span { flex: 1; }
    .agree a { color: var(--color-primary-ink); text-decoration: underline; text-underline-offset: 2px; }
    .agree a:hover { text-decoration: none; }

    
    .guest-email { margin: var(--space-sm) 0; }

    
    .right-col { order: 3; display: flex; flex-direction: column; gap: var(--space-lg); }

    
    
    
    @media (min-width: 1024px) {
      .wrap {
        flex-direction: row;
        align-items: stretch;
        gap: var(--space-xl);
        padding: 0 120px;
      }
      .right-side {
        display: flex; flex-direction: column;
        gap: 20px;
        flex: 1 1 0;
        order: 2;
      }
      h2 { text-align: left; margin: 0; }
      
      .ticket {
        flex: 1 1 0;
        justify-content: center;
        order: 1;
        padding: 28px 32px;
      }
      .ticket app-card-tile { max-width: 240px; }
      .info { margin-top: 28px; }
      .name { font-size: 24px; }
      .divider { margin: 14px auto 0; }
      .price { font-size: 30px; margin-top: 14px; }
      .price .ccy { font-size: 13px; }
    }
  `],
})
export class CheckoutPage implements OnInit {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly cards = inject(CardsApi);
  private readonly orders = inject(OrdersApi);
  private readonly promoApi = inject(PromoApi);
  private readonly currency = inject(CurrencyService);
  private readonly cfg = inject(RuntimeConfigService);
  private readonly toast = inject(ToastService);
  private readonly analytics = inject(AnalyticsService);
  private readonly auth = inject(AuthService);
  private readonly verification = inject(VerificationService);

  protected readonly product = signal<CardProduct | null>(null);
  protected readonly promoCode = signal('');
  protected readonly promoApplied = signal<PromoValidation | null>(null);
  protected readonly promoLoading = signal(false);
  protected readonly promoError = signal<string>('');
  protected readonly agreed = signal(true);
  protected readonly loading = signal(false);
  protected readonly showPicker = signal(false);
  protected readonly currencies = signal<PaymentCurrency[]>([]);
  protected readonly requisitesFor = signal<PaymentCurrency | null>(null);
  protected readonly sbpOnly = computed(() => {
    const list = this.currencies();
    return list.length === 1 && isSbpProvider(list[0].provider) && isMethodAvailable(list[0]);
  });

  protected readonly isGuest = computed(() => !this.auth.isAuthenticated());
  protected readonly email = signal('');
  protected readonly emailError = signal('');
  protected readonly showCodeDialog = signal(false);
  protected readonly busyLabel = computed(() => (this.isGuest() ? 'Отправляем код…' : 'Создание счёта…'));
  private pendingAction: PendingAction | null = null;

  protected readonly finalAmount = computed(() => {
    const p = this.product();
    if (!p) return 0;
    const d = this.promoApplied();
    return Math.max(0, p.issue_price - (d?.discount_amount ?? 0));
  });

  ngOnInit(): void {
    const id = this.route.snapshot.paramMap.get('id')!;
    this.cards.getProduct(id).subscribe((p) => this.product.set(p));
    this.currency.loadMethods('issue').subscribe((r) => this.currencies.set(r.methods));
  }

  
  protected legalUrl(slug: 'agreement' | 'privacy'): string {
    const base = (this.cfg.brand.landing_base_url || 'https://catcard.app').replace(/\/+$/, '');
    return `${base}/legal/${slug}/`;
  }

  protected onEmailChange(v: string): void {
    this.email.set(v);
    if (this.emailError()) this.emailError.set('');
  }

  
  private requireAuth(action: PendingAction): boolean {
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

  
  protected async onAuthenticated(): Promise<void> {
    this.showCodeDialog.set(false);
    const action = this.pendingAction;
    this.pendingAction = null;
    this.currency.loadMethods('issue').subscribe((r) => this.currencies.set(r.methods));
    await this.verification.refresh();
    switch (action) {
      case 'promo': this.applyPromo(); break;
      case 'free': this.issueFree(); break;
      case 'pay': this.onPayClicked(); break;
    }
  }

  protected onChangeEmail(): void {
    this.showCodeDialog.set(false);
    this.pendingAction = null;
  }

  protected onCodeDismissed(): void {
    this.showCodeDialog.set(false);
    this.pendingAction = null;
  }

  applyPromo(): void {
    const p = this.product();
    if (!p || !this.promoCode().trim()) return;
    if (this.requireAuth('promo')) return;
    this.promoLoading.set(true);
    this.promoError.set('');
    this.promoApi.validate({ code: this.promoCode(), scope: 'issue', card_product_id: p.id }).subscribe({
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
    if (this.requireAuth('pay')) return;
    if (this.gateVerification()) return;
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
    if (this.requireAuth('free')) return;
    if (this.gateVerification()) return;
    this.issue('', {});
  }

  
  private gateVerification(): boolean {
    if (!this.verification.needed()) return false;
    void this.router.navigate(['/verification'], { queryParams: { return: this.router.url } });
    return true;
  }

  private issue(paymentCurrency: string, requisitesFrom: Record<string, string>): void {
    const p = this.product();
    if (!p) return;
    this.loading.set(true);
    const utm = this.analytics.getUtm();
    this.analytics.getMatomoVisitorId().then((matomoCid) => {
    this.orders.issue({
      card_product_id: p.id,
      payment_currency: paymentCurrency,
      promo_code: this.promoCode() || undefined,
      requisites_from: requisitesFrom,
      matomo_cid: matomoCid || undefined,
      utm: Object.keys(utm).length ? utm : undefined,
    }).subscribe({
      next: (res) => {
        this.loading.set(false);
        if (res.order.status === 'paid') {
          this.analytics.reachGoalCardPurchase(res.order.id);
          this.toast.success('Карта выпускается!');
          storeIssuingOrderId(res.order.id);
          this.router.navigate(['/cards']);
        } else {
          if (res.order.mode === 'redirect') openExternalLink(res.order.url);
          this.router.navigate(['/orders', res.order.id, 'payment']);
        }
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
        if (code === 'VERIFICATION_EMAIL_REQUIRED' || code === 'VERIFICATION_PHONE_REQUIRED' || code === 'VERIFICATION_KYC_REQUIRED') {
          void this.verification.refresh();
          void this.router.navigate(['/verification'], { queryParams: { return: this.router.url } });
          return;
        }
        this.toast.error(msg);
      },
    });
    });
  }

  protected rateFor(c: PaymentCurrency): number {
    return previewRate(c, this.finalAmount());
  }

  protected chargeSymbol(): string {
    return symbolFor(this.product()?.issue_currency ?? '');
  }

  protected symbol(c: string | null | undefined): string { return symbolFor(c); }
  protected symBefore(c: string | null | undefined): boolean { return isPrefixSymbolCurrency(c); }
  protected money(v: number | string | null | undefined, c: string | null | undefined): string {
    return formatAmount(v, c);
  }
}