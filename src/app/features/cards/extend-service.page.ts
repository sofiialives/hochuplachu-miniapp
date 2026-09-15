import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { BackBarComponent } from '../../ui/back-bar.component';
import { PayButtonComponent } from '../../ui/pay-button.component';
import { PromoInputComponent } from '../../ui/promo-input.component';
import { CardsApi, CardProduct, UserCard } from '../../core/api/cards.api';
import { OrdersApi } from '../../core/api/orders.api';
import { PromoApi, PromoValidation } from '../../core/api/promo.api';
import { CurrencyService, PaymentCurrency, isMethodAvailable, isSbpProvider, nonPhoneFromFields } from '../../core/currency/currency.service';
import { openExternalLink } from '../../core/utils/open-external';
import { AnalyticsService } from '../../core/analytics/analytics.service';
import { VerificationService } from '../../core/verification/verification.service';
import { ToastService } from '../../core/notifications/toast.service';
import { symbolFor, formatAmount } from '../../core/currency/currency-symbols';
import { RequisitesDialogComponent } from './requisites.dialog';
import { CurrencyPickerDialogComponent } from './currency-picker.dialog';

// ExtendServicePage — продление годового обслуживания карты. Структурно
// аналогично TopUpPage, но сумма не задаётся пользователем — берётся из
// CardProduct.annual_service_fee. После успешной оплаты Card.service_expires_at
// продлевается на 365 дней, замороженная карта (если была) — размораживается.
@Component({
  selector: 'app-extend-service',
  standalone: true,
  imports: [BackBarComponent, PayButtonComponent, PromoInputComponent, RequisitesDialogComponent, CurrencyPickerDialogComponent],
  template: `<app-back-bar />
    @if (card(); as c) {
      @if (product(); as p) {
        <section class="wrap">
          <h2>Продление обслуживания</h2>
          <p class="hint">Карта *{{ c.last4 }} — «{{ p.name }}»</p>

          <div class="fee">
            <div class="fee-lbl">Стоимость годового обслуживания</div>
            <div class="fee-val">{{ money(p.annual_service_fee, p.issue_currency) }}</div>
            <div class="fee-hint">Срок действия будет продлён на 1 год.</div>
          </div>

          <app-promo-input
            [(code)]="promoCode"
            [applied]="promoApplied()"
            [loading]="promoLoading()"
            [error]="promoError()"
            (codeChanged)="onPromoChanged()"
            (apply)="applyPromo()" />

          <app-pay-button [disabled]="false" [loading]="loading()" [sbpLogo]="sbpOnly()" (clicked)="onPay()" label="Оплатить" />
        </section>
      }
    }

    @if (showPicker()) {
      <app-currency-picker-dialog
        [currencies]="currencies()"
        [amount]="amount()"
        [issueCurrency]="product()?.issue_currency ?? ''"
        [chargeSymbol]="chargeSymbol()"
        (dismissed)="showPicker.set(false)"
        (selected)="selectCurrency($event)" />
    }

    @if (requisitesFor(); as cur) {
      <app-requisites-dialog [currency]="cur" (dismissed)="requisitesFor.set(null)" (submitted)="onRequisites($event)" />
    }`,
  styles: [`
    .wrap { padding: var(--space-md); max-width: 480px; margin: 0 auto; padding-bottom: var(--space-xl); }
    h2 { text-align: center; }
    .hint { text-align: center; color: var(--color-muted); margin-bottom: var(--space-lg); }
    .fee {
      padding: var(--space-md);
      background: var(--color-surface-card);
      border: 1px solid var(--color-hairline);
      border-radius: var(--rounded-md);
      margin-bottom: var(--space-md);
      text-align: center;
    }
    .fee-lbl { font-size: 13px; color: var(--color-muted); margin-bottom: 6px; }
    .fee-val { font-family: var(--font-display); font-size: 26px; font-weight: 700; color: var(--color-ink); }
    .fee-hint { font-size: 13px; color: var(--color-muted); margin-top: 8px; }
    app-promo-input { margin: var(--space-md) 0; display: block; }
    .row { display: flex; justify-content: space-between; padding: 8px 0; }
    .green { color: var(--color-success); }
  `],
})
export class ExtendServicePage implements OnInit {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly cardsApi = inject(CardsApi);
  private readonly orders = inject(OrdersApi);
  private readonly promoApi = inject(PromoApi);
  private readonly currency = inject(CurrencyService);
  private readonly toast = inject(ToastService);
  private readonly analytics = inject(AnalyticsService);
  private readonly verification = inject(VerificationService);

  protected readonly card = signal<UserCard | null>(null);
  protected readonly product = signal<CardProduct | null>(null);
  protected readonly promoCode = signal('');
  protected readonly promoApplied = signal<PromoValidation | null>(null);
  protected readonly promoLoading = signal(false);
  protected readonly promoError = signal<string>('');
  protected readonly showPicker = signal(false);
  protected readonly currencies = signal<PaymentCurrency[]>([]);
  protected readonly requisitesFor = signal<PaymentCurrency | null>(null);
  // sbpOnly — единственный доступный метод — СБП: логотип СБП на кнопке.
  protected readonly sbpOnly = computed(() => {
    const list = this.currencies();
    return list.length === 1 && isSbpProvider(list[0].provider) && isMethodAvailable(list[0]);
  });
  protected readonly amount = computed(() => this.product()?.annual_service_fee ?? 0);
  // loading — на время создания ServiceRenewalOrder. Блокирует кнопки
  // оплаты, чтобы избежать дубликата заявки.
  protected readonly loading = signal(false);

  ngOnInit(): void {
    const id = this.route.snapshot.paramMap.get('cardId')!;
    this.cardsApi.getCard(id).subscribe((c) => {
      this.card.set(c);
      this.cardsApi.getProduct(c.card_product_id).subscribe((p) => this.product.set(p));
    });
    this.currency.loadMethods('topup').subscribe((r) => this.currencies.set(r.methods));
  }

  applyPromo(): void {
    const p = this.product();
    if (!p || !this.promoCode()) return;
    this.promoLoading.set(true);
    this.promoError.set('');
    this.promoApi.validate({
      code: this.promoCode(),
      scope: 'topup',
      amount: p.annual_service_fee,
      currency: p.issue_currency,
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

  onPay(): void {
    if (this.gateVerification()) return;
    const list = this.currencies();
    const avail = list.filter(isMethodAvailable);
    // Одна валюта в списке — выбор метода оплаты не показываем: сразу её флоу.
    if (list.length === 1 && avail.length === 1) {
      this.selectCurrency(avail[0]);
      return;
    }
    this.showPicker.set(true);
  }
  selectCurrency(c: PaymentCurrency): void {
    this.showPicker.set(false);
    // СБП (kassaai / platega): реквизитов плательщика нет — сразу счёт.
    if (isSbpProvider(c.provider)) {
      this.create(c.id, {});
      return;
    }
    if (nonPhoneFromFields(c).length === 0) {
      this.create(c.id, {});
      return;
    }
    this.requisitesFor.set(c);
  }
  onRequisites(reqs: Record<string, string>): void {
    const c = this.requisitesFor();
    this.requisitesFor.set(null);
    if (!c) return;
    this.create(c.id, reqs);
  }
  private gateVerification(): boolean {
    if (!this.verification.needed()) return false;
    void this.router.navigate(['/verification'], { queryParams: { return: this.router.url } });
    return true;
  }

  private create(payCurrency: string, requisitesFrom: Record<string, string>): void {
    const c = this.card();
    if (!c) return;
    this.loading.set(true);
    // matomo_cid + utm — для серверной атрибуции конверсии (см. checkout.page).
    const utm = this.analytics.getUtm();
    this.analytics.getMatomoVisitorId().then((matomoCid) => {
    this.orders.extendService(c.id, {
      payment_currency: payCurrency,
      promo_code: this.promoCode() || undefined,
      requisites_from: requisitesFrom,
      matomo_cid: matomoCid || undefined,
      utm: Object.keys(utm).length ? utm : undefined,
    }).subscribe({
      next: (res) => {
        // redirect-режим СБП: пейформу эквайра открываем сразу в новом окне
        // (окно активации клика ещё живо — попап-блокер пропускает).
        if (res.renewal.mode === 'redirect') openExternalLink(res.renewal.url);
        this.router.navigate(['/cards', c.id, 'extend-service', 'payment', res.renewal.id]);
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

  symbol(s: string): string { return symbolFor(s); }
  money(v: number | string | null | undefined, c: string | null | undefined): string { return formatAmount(v, c); }

  protected chargeSymbol(): string {
    return symbolFor(this.product()?.issue_currency ?? '');
  }
}
