import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { BackBarComponent } from '../../ui/back-bar.component';
import { ButtonComponent } from '../../ui/button.component';
import { PayButtonComponent } from '../../ui/pay-button.component';
import { PromoInputComponent } from '../../ui/promo-input.component';
import { InputComponent } from '../../ui/input.component';
import { EsimApi, EsimProduct, MyEsim, daysWord, formatDataMb } from '../../core/api/esim.api';
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

// EsimRechargePage — «/esim/my/:esimId/recharge» — чекаут продления:
// продлевается ТОЛЬКО текущий план (ограничение buvei), цена = текущая цена
// EsimProduct. БЕЗ authGuard — гостю показываем email-гейт прямо на странице
// (владелец eSIM без сессии, пришедший по deep-link из письма).
@Component({
  selector: 'app-esim-recharge',
  standalone: true,
  imports: [
    BackBarComponent, ButtonComponent, PayButtonComponent, PromoInputComponent,
    InputComponent, EmailCodeDialog,
    RequisitesDialogComponent, CurrencyPickerDialogComponent,
  ],
  template: `<app-back-bar />
    <section class="wrap">
      <h2>Продление eSIM</h2>

      @if (isGuest()) {
        <div class="guest">
          <p class="muted">Войдите по email, чтобы продлить eSIM.</p>
          <app-input
            [value]="email()"
            (valueChange)="onEmailChange($event)"
            (enterPressed)="startGuestLogin()"
            type="email" autocomplete="email" inputmode="email"
            placeholder="Введите email"
            [error]="emailError()"></app-input>
          <app-button variant="primary" [full]="true" [loading]="loading()" loadingLabel="Отправляем код…" (clicked)="startGuestLogin()">
            Продолжить
          </app-button>
        </div>
      } @else if (esim(); as e) {
        @if (!rechargeAvailable()) {
          <div class="stub">
            <p><b>Продление для этого тарифа недоступно.</b></p>
            <p class="muted">У оператора нет пакета продления такого объёма —
              для дальнейшего пользования оформите новую eSIM.</p>
            <app-button variant="primary" [full]="true" (clicked)="goBack()">Выбрать новую eSIM</app-button>
          </div>
        } @else {
        <div class="summary">
          <div class="s-head">
            <div>
              <div class="s-country">{{ e.country_name || e.name || 'eSIM' }}</div>
              <div class="s-name">{{ e.name }}</div>
            </div>
            @if (product(); as p) {
              <div class="s-price">{{ money(p.issue_price, p.issue_currency) }}</div>
            }
          </div>
          @if (product(); as p) {
            <div class="s-meta">
              <span class="s-chip">{{ mb(p.data_mb) }}</span>
              <span class="s-chip">{{ p.days }} {{ daysLabel(p.days) }}</span>
            </div>
          }
          <p class="s-desc">Продлевается текущий тариф — пакет трафика и срок добавятся к вашей eSIM после оплаты.</p>
        </div>

        <div class="order">
          @if (product()) {
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
              <span class="total-val">{{ money(finalAmount(), product()!.issue_currency) }}</span>
            </div>
          } @else {
            <!-- Тариф скрыт из каталога (провайдер выключен и т.п.) — цену
                 посчитает бэк, промокод без известной суммы не применить. -->
            <div class="row total">
              <span>К оплате</span>
              <span class="total-val">по текущему тарифу</span>
            </div>
          }
        </div>

        @if (product() && finalAmount() <= 0 && promoApplied()) {
          <app-button variant="primary" [full]="true" [loading]="loading()" loadingLabel="Создание счёта…" (clicked)="payFree()">
            Продлить бесплатно
          </app-button>
        } @else {
          <app-pay-button [loading]="loading()" loadingLabel="Создание счёта…" [sbpLogo]="sbpOnly()"
                          label="Продлить eSIM"
                          (clicked)="onPayClicked()" />
        }
        }
      } @else if (loadFailed()) {
        <div class="stub">
          <p>eSIM не найдена.</p>
          <app-button variant="secondary" (clicked)="goBack()">К моим eSIM</app-button>
        </div>
      } @else {
        <div role="status" aria-label="Загрузка">
          <span class="skel skel-lg"></span>
          <span class="skel"></span>
        </div>
      }
    </section>

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
    .wrap { padding: var(--space-md); max-width: 560px; margin: 0 auto; padding-bottom: var(--space-xl); display: flex; flex-direction: column; gap: var(--space-lg); }
    h2 { text-align: center; margin: 0; }
    .muted { color: var(--color-muted); }

    .guest { display: flex; flex-direction: column; gap: var(--space-sm); }

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
    .s-desc { margin: 0; color: var(--color-muted); font-size: 13px; line-height: 1.5; }

    .order {
      display: flex; flex-direction: column;
      padding: var(--space-md);
      background: var(--color-surface-card);
      border-radius: var(--rounded-lg);
      gap: var(--space-sm);
    }
    .row {
      display: flex; justify-content: space-between; align-items: baseline;
      padding-top: var(--space-sm);
      font-size: 15px; color: var(--color-body);
      border-top: 1px solid color-mix(in srgb, var(--color-hairline) 60%, transparent);
    }
    .row:first-child { border-top: none; padding-top: 0; }
    .row.total { font-weight: 500; font-size: 16px; color: var(--color-ink); }
    .total-val { font-family: var(--font-display); font-size: 22px; color: var(--color-primary-ink); font-weight: 500; }
    .green { color: var(--color-success); font-weight: 500; }

    .stub { text-align: center; padding: var(--space-xl) 0; display: flex; flex-direction: column; gap: var(--space-md); align-items: center; }
    .skel {
      display: block; height: 56px; border-radius: var(--rounded-lg); margin-bottom: var(--space-sm);
      background: color-mix(in srgb, var(--color-primary) 6%, var(--color-surface));
      position: relative; overflow: hidden;
    }
    .skel-lg { height: 140px; }
    .skel::after {
      content: ""; position: absolute; inset: 0;
      background: linear-gradient(100deg, transparent 32%, color-mix(in srgb, #fff 55%, transparent) 50%, transparent 68%);
      transform: translateX(-100%);
      animation: er-skel 1.6s ease-in-out infinite;
    }
    @keyframes er-skel { to { transform: translateX(100%); } }
    @media (prefers-reduced-motion: reduce) { .skel::after { animation: none; } }
  `],
})
export class EsimRechargePage implements OnInit {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly esimApi = inject(EsimApi);
  private readonly promoApi = inject(PromoApi);
  private readonly currency = inject(CurrencyService);
  private readonly auth = inject(AuthService);
  private readonly analytics = inject(AnalyticsService);
  private readonly toast = inject(ToastService);

  protected readonly esim = signal<MyEsim | null>(null);
  protected readonly product = signal<EsimProduct | null>(null);
  protected readonly loadFailed = signal(false);
  // false = вендор явно ответил, что пакета продления этого тарифа нет
  // (микро-планы вроде «Россия 100 МБ»); форма заменяется заглушкой. Сбои
  // проверки бэкенд деградирует в true — форма показывается как раньше.
  protected readonly rechargeAvailable = signal(true);
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
  private esimId = '';

  protected readonly isGuest = computed(() => !this.auth.isAuthenticated());
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
    this.esimId = this.route.snapshot.paramMap.get('esimId') ?? '';
    if (this.auth.isAuthenticated()) this.loadData();
  }

  private loadData(): void {
    this.esimApi.my().subscribe({
      next: (r) => {
        const e = (r.esims ?? []).find((x) => x.id === this.esimId) ?? null;
        this.esim.set(e);
        this.loadFailed.set(!e);
        if (e) {
          // Цена продления = текущая цена продукта; тариф может быть скрыт из
          // каталога (провайдер выключен) — тогда цену посчитает бэк.
          this.esimApi.product(e.esim_product_id).subscribe({
            next: (res) => this.product.set(res.product ?? null),
            error: () => {},
          });
          // Есть ли у вендора продление «тем же планом». Ошибку глотаем:
          // fail-open уже на бэке, здесь просто не трогаем сигнал.
          this.esimApi.rechargeAvailability(e.id).subscribe({
            next: (res) => this.rechargeAvailable.set(res.available !== false),
            error: () => {},
          });
        }
      },
      error: () => this.loadFailed.set(true),
    });
    this.currency.loadMethods('topup', 'esim').subscribe((r) => this.currencies.set(r.methods));
  }

  protected goBack(): void { void this.router.navigate(['/esim']); }

  protected onEmailChange(v: string): void {
    this.email.set(v);
    if (this.emailError()) this.emailError.set('');
  }

  /** Гостевой вход прямо на странице (deep-link на продление без сессии). */
  protected startGuestLogin(): void {
    const value = this.email().trim().toLowerCase();
    if (!EMAIL_REGEX.test(value)) {
      this.emailError.set('Введите корректный email, например you@example.com');
      return;
    }
    this.loading.set(true);
    this.auth.requestCode(value).subscribe({
      next: () => {
        this.loading.set(false);
        this.showCodeDialog.set(true);
      },
      error: (err) => {
        this.loading.set(false);
        const e = extractApiError(err);
        this.emailError.set(e.code === 'RATE_LIMITED'
          ? 'Слишком много запросов. Попробуйте через минуту.'
          : (e.message ?? 'Не удалось отправить код'));
      },
    });
  }

  // Гость вошёл кодом — страница только теперь может загрузить свою eSIM
  // (эндпоинты продления под авторизацией). Отложенного действия здесь нет:
  // до входа форма продления вообще не показывается.
  protected onAuthenticated(): void {
    this.showCodeDialog.set(false);
    this.loadData();
  }
  protected onChangeEmail(): void { this.showCodeDialog.set(false); }
  protected onCodeDismissed(): void { this.showCodeDialog.set(false); }

  applyPromo(): void {
    const p = this.product();
    if (!p || !this.promoCode().trim()) return;
    this.promoLoading.set(true);
    this.promoError.set('');
    // Recharge = scope topup (семантика промокодов из дизайна §3.5).
    this.promoApi.validate({
      code: this.promoCode(), scope: 'topup',
      product_type: 'esim', product_id: p.id,
      amount: p.issue_price, currency: p.issue_currency,
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
      this.recharge(c.id, {});
      return;
    }
    if (nonPhoneFromFields(c).length === 0) {
      this.recharge(c.id, {});
      return;
    }
    this.requisitesFor.set(c);
  }
  onRequisites(reqs: Record<string, string>): void {
    const c = this.requisitesFor();
    this.requisitesFor.set(null);
    if (!c) return;
    this.recharge(c.id, reqs);
  }
  payFree(): void {
    this.recharge('', {});
  }

  private recharge(paymentCurrency: string, requisitesFrom: Record<string, string>): void {
    if (!this.esimId) return;
    this.loading.set(true);
    const utm = this.analytics.getUtm();
    this.analytics.getMatomoVisitorId().then((matomoCid) => {
      this.esimApi.createRecharge(this.esimId, {
        payment_currency: paymentCurrency,
        promo_code: this.promoCode() || undefined,
        requisites_from: requisitesFrom,
        matomo_cid: matomoCid || undefined,
        utm: Object.keys(utm).length ? utm : undefined,
      }).subscribe({
        next: (res) => {
          this.loading.set(false);
          if (res.recharge.mode === 'redirect') openExternalLink(res.recharge.url);
          void this.router.navigate(['/esim/recharges', res.recharge.id, 'payment']);
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
