import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { Location } from '@angular/common';
import { BackBarComponent } from '../../ui/back-bar.component';
import { PayButtonComponent } from '../../ui/pay-button.component';
import { ButtonComponent } from '../../ui/button.component';
import { InputComponent } from '../../ui/input.component';
import { PromoInputComponent } from '../../ui/promo-input.component';
import { CardsApi, CardProduct, UserCard } from '../../core/api/cards.api';
import { OrdersApi } from '../../core/api/orders.api';
import { PromoApi, PromoValidation } from '../../core/api/promo.api';
import { ReferralApi } from '../../core/api/referral.api';
import { AuthService } from '../../core/auth/auth.service';
import { bonusApplicableTo, formatReferralAmount } from '../../core/referral/referral-format';
import { CurrencyService, PaymentCurrency, isMethodAvailable, isSbpProvider, nonPhoneFromFields } from '../../core/currency/currency.service';
import { openExternalLink } from '../../core/utils/open-external';
import { VerificationService } from '../../core/verification/verification.service';
import { anyCurrencyAccepts, rangeAcrossCurrencies } from '../../core/currency/level-calc';
import { ToastService } from '../../core/notifications/toast.service';
import { AnalyticsService } from '../../core/analytics/analytics.service';
import { symbolFor } from '../../core/currency/currency-symbols';
import { RequisitesDialogComponent } from './requisites.dialog';
import { CurrencyPickerDialogComponent } from './currency-picker.dialog';

@Component({
  selector: 'app-topup',
  standalone: true,
  imports: [BackBarComponent, ButtonComponent, InputComponent, PayButtonComponent, PromoInputComponent, RequisitesDialogComponent, CurrencyPickerDialogComponent],
  template: `<app-back-bar />
    @if (card(); as c) {
      <section class="wrap">
        <h2>Пополнение</h2>
        <p class="hint">Карта *{{ c.last4 }}</p>

        @if (disabledForProduct()) {
          <div class="blocked" role="status">
            <div class="blocked__title">Пополнение временно недоступно</div>
            <div class="blocked__text">
              Пополнение этой карты отключено администратором. Использование карты возможно в пределах текущего баланса.
            </div>
            <app-button variant="secondary" [full]="true" (clicked)="goBack()">Назад</app-button>
          </div>
        } @else {
        <div class="amount">
          <label class="lbl">Сумма, {{ symbol(cardCurrency()) }}</label>
          <app-input [(value)]="amount" inputmode="numeric" [integerOnly]="true" placeholder="0" />
          @if (rangeHint(); as h) {
            <div class="range-hint" [class.range-hint--error]="amountError()">{{ h }}</div>
          }
        </div>

        <app-promo-input
          [(code)]="promoCode"
          [applied]="promoApplied()"
          [loading]="promoLoading()"
          [error]="promoError()"
          (codeChanged)="onPromoChanged()"
          (apply)="applyPromo()" />

        @if (referralBonusApplicable() > 0) {
          <div class="row">
            <span>Пригласительный бонус — зачислится на карту</span>
            <span class="green">+{{ formatBonus() }}</span>
          </div>
        }

        @if (isFree()) {
          <app-button variant="primary" [full]="true" [loading]="loading()" loadingLabel="Создание счёта…" (click)="topUpFree()">
            Пополнить бесплатно
          </app-button>
        } @else {
          <app-pay-button [disabled]="!canPay()" [loading]="loading()" [sbpLogo]="sbpOnly()" (clicked)="onPay()" label="Оплатить" />
        }
        }
      </section>
    }

    @if (showPicker()) {
      <app-currency-picker-dialog
        [currencies]="currencies()"
        [amount]="chargeAmount()"
        [chargeSymbol]="chargeSymbol()"
        [formatRange]="formatRangeFn"
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
    .amount { margin-bottom: var(--space-md); }
    .lbl { font-size: 13px; color: var(--color-muted); display: block; margin-bottom: 6px; }
    app-promo-input { margin: var(--space-md) 0; display: block; }
    .row { display: flex; justify-content: space-between; padding: 8px 0; }
    .green { color: var(--color-success); }
    .range-hint { font-size: 12px; color: var(--color-muted); margin-top: 6px; }
    .range-hint--error { color: var(--color-danger, #DC3545); }
    .blocked {
      display: flex; flex-direction: column; gap: var(--space-md);
      padding: var(--space-md);
      background: color-mix(in srgb, var(--color-danger, #c0392b) 8%, var(--color-canvas));
      border: 1px solid var(--color-danger, #c0392b);
      border-radius: var(--rounded-md);
      color: var(--color-ink);
      margin-bottom: var(--space-md);
    }
    .blocked__title { font-weight: 600; font-size: 15px; }
    .blocked__text { font-size: 13px; color: var(--color-muted); line-height: 1.4; }
  `],
})
export class TopUpPage implements OnInit {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly location = inject(Location);
  private readonly cardsApi = inject(CardsApi);
  private readonly orders = inject(OrdersApi);
  private readonly promo = inject(PromoApi);
  private readonly refApi = inject(ReferralApi);
  private readonly auth = inject(AuthService);
  private readonly currency = inject(CurrencyService);
  private readonly toast = inject(ToastService);
  private readonly analytics = inject(AnalyticsService);
  private readonly verification = inject(VerificationService);

  protected readonly card = signal<UserCard | null>(null);
  protected readonly product = signal<CardProduct | null>(null);
  // Валюта баланса карты — атрибут CardProduct, не самой Card. Резолвим
  // после загрузки карты по её card_product_id.
  protected readonly cardCurrency = computed(() => this.product()?.card_currency ?? '');
  protected readonly amount = signal('');
  protected readonly promoCode = signal('');
  protected readonly promoApplied = signal<PromoValidation | null>(null);
  protected readonly promoLoading = signal(false);
  protected readonly promoError = signal<string>('');
  protected readonly showPicker = signal(false);
  protected readonly currencies = signal<PaymentCurrency[]>([]);
  protected readonly requisitesFor = signal<PaymentCurrency | null>(null);
  // availableCurrencies — методы, доступные к выбору сейчас (без «серых»
  // условных): лимиты/подсказки считаем только по ним.
  protected readonly availableCurrencies = computed(() => this.currencies().filter(isMethodAvailable));
  // sbpOnly — единственный доступный метод — СБП: логотип СБП на кнопке.
  protected readonly sbpOnly = computed(() => {
    const list = this.currencies();
    return list.length === 1 && isSbpProvider(list[0].provider) && isMethodAvailable(list[0]);
  });
  // loading — выставляется на время создания TopUpOrder; блокирует кнопки
  // оплаты, чтобы пользователь не отправил две одинаковые заявки подряд.
  protected readonly loading = signal(false);
  // disabledForProduct — у CardProduct.DisableTopup=true. Рисуем stub вместо
  // формы (и backend всё равно зарежет POST /cards/:id/topup с TOPUP_DISABLED,
  // см. order_service.go); страница защищает от старой вкладки/устаревшего
  // bookmark и убирает «мусорный» интерфейс.
  protected readonly disabledForProduct = computed(() => !!this.product()?.disable_topup);

  // goBack — на закрытие stub-страницы возвращаемся туда же, откуда пришли
  // (обычно /). Location.back() сохраняет состояние home (скролл, активная
  // карта в карусели), router.navigate('/') — сбросил бы.
  protected goBack(): void { this.location.back(); }

  // referralBonus — приветственный бонус приглашённого (bonus_available из
  // /referral/info). Загружается только когда пополняется ПЕРВАЯ карта юзера
  // и бонус ещё не потрачен — см. maybeLoadReferralBonus.
  protected readonly referralBonus = signal<number>(0);
  protected readonly referralBonusCurrency = signal<string>('');

  ngOnInit(): void {
    const id = this.route.snapshot.paramMap.get('cardId')!;
    this.cardsApi.getCard(id).subscribe((c) => {
      this.card.set(c);
      this.cardsApi.getProduct(c.card_product_id).subscribe((p) => this.product.set(p));
    });
    this.currency.loadMethods('topup').subscribe((r) => this.currencies.set(r.methods));
    this.maybeLoadReferralBonus(id);
  }

  // Бонус приглашённого зачисляется НА КАРТУ сверх суммы при ПЕРВОМ пополнении
  // ПЕРВОЙ открытой карты (зеркало backend CreateTopUp + isFirstCard). «Первая
  // карта» — первый элемент GET /cards: backend отдаёт список created_at ASC
  // без deleted. Сумму даёт /referral/info (bonus_available) — бэк учитывает
  // там и тип рефовода (приглашённым партнёром бонус не полагается), и его
  // блокировку. Запрос идёт только при выполнении локальных условий, чтобы не
  // дёргать бэк на каждое пополнение.
  private maybeLoadReferralBonus(cardId: string): void {
    const u = this.auth.user();
    if (!u || !u.referred_by_id || u.referral_bonus_applied) return;
    const check = (cards: UserCard[]): void => {
      if (cards.length === 0 || cards[0].id !== cardId) return;
      this.refApi.info().subscribe({
        next: (info) => {
          this.referralBonus.set(info.bonus_available);
          this.referralBonusCurrency.set(info.referee_bonus.currency);
        },
        error: () => { /* без бонуса — просто не показываем строку */ },
      });
    };
    const cached = this.cardsApi.cardsCache();
    if (cached.length > 0) check(cached);
    else this.cardsApi.myCards().subscribe({ next: (r) => check(r.cards ?? []), error: () => { /* нет списка — нет предпросмотра, backend применит бонус сам */ } });
  }

  // referralBonusApplicable — сумма бонуса, которая будет зачислена на карту
  // сверх суммы пополнения (валюта бонуса должна быть совместима с валютой
  // карты). На плату НЕ влияет — это не скидка (зеркало backend CreateTopUp:
  // funding публикуется на Amount + ReferralBonus).
  protected readonly referralBonusApplicable = computed(() =>
    bonusApplicableTo(this.referralBonus(), this.referralBonusCurrency(), this.cardCurrency()));

  protected formatBonus(): string {
    return formatReferralAmount(this.referralBonusApplicable(), this.referralBonusCurrency());
  }

  // chargeAmount — то, что реально пойдёт в coincat как to_amount. Логика
  // зеркалит backend OrderService.CreateTopUp: на amount накидываем сервисный
  // процент (DepositFeePct), затем вычитаем скидку промокода. Скидка влияет
  // ТОЛЬКО на оплату — на карту в любом случае зачисляется полная amount
  // (плюс пригласительный бонус, если он применим).
  protected readonly chargeAmount = computed(() => {
    const n = parseFloat(this.amount());
    if (isNaN(n) || n <= 0) return 0;
    const p = this.product();
    const fee = p && p.deposit_fee_pct > 0 ? p.deposit_fee_pct : 0;
    const gross = n * (1 + fee);
    const discount = this.promoApplied()?.discount_amount ?? 0;
    return Math.max(0, gross - discount);
  });

  // amountError — пользователь ввёл сумму > 0, но ни одна валюта не возьмёт.
  protected readonly amountError = computed(() => {
    const n = parseFloat(this.amount());
    if (isNaN(n) || n <= 0) return false;
    const list = this.availableCurrencies();
    if (list.length === 0) return false;
    return !anyCurrencyAccepts(list, this.chargeAmount());
  });

  // rangeHint — текст под полем суммы: либо «Допустимая сумма: X — Y», либо
  // ошибка «Сумма вне диапазона: X — Y». Диапазон выражаем в card-валюте
  // (делим на 1+fee_pct), чтобы пользователь сравнивал с тем, что вводит.
  protected readonly rangeHint = computed(() => {
    const list = this.availableCurrencies();
    if (list.length === 0) return '';
    const r = rangeAcrossCurrencies(list);
    if (!r.hasLimits) return '';
    const p = this.product();
    const fee = p && p.deposit_fee_pct > 0 ? p.deposit_fee_pct : 0;
    const factor = 1 + fee;
    const b = this.bounds(r.minAmount / factor, r.maxAmount / factor);
    const sym = symbolFor(this.cardCurrency());
    const range = `${b.fmt(b.min)} — ${b.fmt(b.max)} ${sym}`;
    if (!this.amountError()) return `Допустимая сумма: ${range}`;
    // Введённая сумма может быть в диапазоне, но к оплате идёт сумма ЗА
    // ВЫЧЕТОМ скидки промокода — и она уже ниже минимума. Без пояснения
    // пользователь видит «вне диапазона» на корректной с виду сумме.
    const discount = this.promoApplied()?.discount_amount ?? 0;
    const eff = this.chargeAmount() / factor;
    if (discount > 0 && eff < b.min && !this.isFree()) {
      return `Допустимая сумма пополнения: ${range}. С учётом скидки к оплате выйдет ${this.fmt(eff)} ${sym} — увеличьте сумму.`;
    }
    return `Сумма вне диапазона. Допустимо: ${range}`;
  });

  canPay(): boolean {
    const n = parseFloat(this.amount());
    if (isNaN(n) || n <= 0) return false;
    const list = this.availableCurrencies();
    if (list.length === 0) return true;
    return anyCurrencyAccepts(list, this.chargeAmount());
  }

  // isFree — промокод покрыл всю плату (gross − discount ≤ 0). Бэк примет
  // топап со status="paid" без обращения к провайдеру оплаты; ввод суммы
  // обязателен, иначе вычислять нечего. Пригласительный бонус на плату не
  // влияет вовсе — он зачисляется на карту сверх суммы.
  protected readonly isFree = computed(() => {
    const n = parseFloat(this.amount());
    if (isNaN(n) || n <= 0) return false;
    return this.promoApplied() != null && this.chargeAmount() <= 0;
  });

  topUpFree(): void {
    if (this.gateVerification()) return;
    this.create('', {});
  }

  protected chargeSymbol(): string {
    return symbolFor(this.cardCurrency());
  }

  // formatRangeFn — arrow-property передаётся в currency-picker-dialog как input.
  // Диапазон лимитов приходит в charge-валюте (после fee); приводим обратно
  // к card-валюте (то, что пользователь ввёл в поле суммы) делением на 1+fee.
  protected readonly formatRangeFn = (min: number, max: number): string => {
    const p = this.product();
    const fee = p && p.deposit_fee_pct > 0 ? p.deposit_fee_pct : 0;
    const factor = 1 + fee;
    const b = this.bounds(min / factor, max / factor);
    return `${b.fmt(b.min)} — ${b.fmt(b.max)}`;
  };

  // bounds — границы диапазона под целочисленный ввод суммы: минимум округляем
  // вверх, максимум вниз, чтобы любое целое из подсказки гарантированно прошло
  // проверку лимитов (сужение безопасно в обе стороны). Если целых внутри
  // диапазона не осталось (1.2 — 1.8), оставляем дробные границы — иначе
  // подсказка выглядела бы как «2 — 1».
  private bounds(min: number, max: number): { min: number; max: number; fmt: (n: number) => string } {
    const lo = Math.ceil(min);
    const hi = Math.floor(max);
    if (lo > hi) return { min, max, fmt: (n) => this.fmt(n) };
    return { min: lo, max: hi, fmt: (n) => (isFinite(n) ? String(n) : '∞') };
  }

  private fmt(n: number): string {
    if (!isFinite(n)) return '∞';
    if (n >= 1000) return n.toFixed(0);
    if (n >= 1) return n.toFixed(2);
    return n.toFixed(4);
  }

  applyPromo(): void {
    const c = this.card();
    if (!c || !this.promoCode().trim()) return;
    const a = parseFloat(this.amount());
    if (isNaN(a) || a <= 0) {
      this.toast.error('Сначала введите сумму пополнения');
      return;
    }
    this.promoLoading.set(true);
    this.promoError.set('');
    this.promo.validate({ code: this.promoCode(), scope: 'topup', amount: a, currency: this.cardCurrency() }).subscribe({
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
    const avail = this.availableCurrencies();
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
    const a = parseFloat(this.amount());
    this.loading.set(true);
    // matomo_cid + utm — для серверной атрибуции конверсии (см. checkout.page).
    const utm = this.analytics.getUtm();
    this.analytics.getMatomoVisitorId().then((matomoCid) => {
    this.orders.topup(c.id, {
      amount: a,
      payment_currency: payCurrency,
      promo_code: this.promoCode() || undefined,
      requisites_from: requisitesFrom,
      matomo_cid: matomoCid || undefined,
      utm: Object.keys(utm).length ? utm : undefined,
    }).subscribe({
      next: (res) => {
        // Backend применил пригласительный бонус — он потрачен (резервируется
        // созданием заявки). Синхронизируем локального юзера, чтобы до
        // следующего /auth/me предпросмотр скидки больше нигде не показывался.
        if ((res.topup.referral_bonus ?? 0) > 0) {
          const cur = this.auth.user();
          if (cur) this.auth.user.set({ ...cur, referral_bonus_applied: true });
        }
        // Событие покупки не шлём на создании. Если промокод покрыл всю сумму —
        // backend сразу ставит топап paid (реальное пополнение) и ведём на
        // главную; фиксируем Яндекс-цель здесь. Иначе цель выстрелит в
        // payment.page при isPaid(). Matomo-пополнение отправит backend при paid.
        if (res.topup.status === 'paid') {
          this.analytics.reachGoalTopUp(res.topup.id);
          this.toast.success('Карта пополняется!');
          // Бонус зачисляется отдельным пополнением — сообщаем сумму.
          const bonus = res.topup.referral_bonus ?? 0;
          if (bonus > 0) {
            this.toast.success(`На карту также зачислен пригласительный бонус ${formatReferralAmount(bonus, res.topup.currency)}`);
          }
          this.router.navigate(['/cards']);
          return;
        }
        // redirect-режим СБП: пейформу эквайра открываем сразу в новом окне
        // (окно активации клика ещё живо — попап-блокер пропускает).
        if (res.topup.mode === 'redirect') openExternalLink(res.topup.url);
        this.router.navigate(['/topup', c.id, 'payment', res.topup.id]);
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
}
