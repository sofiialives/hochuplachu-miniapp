import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { BackBarComponent } from '../../ui/back-bar.component';
import { PayButtonComponent } from '../../ui/pay-button.component';
import { InputComponent } from '../../ui/input.component';
import {
  ServicesApi, ServiceDenomination, ServiceProduct, denominationLabel, isUnitTopup,
  serviceHasDenominations, serviceNeedsLogin, topupCreditedFor, topupCreditedDisplay,
  topupPayFor, visibleDenominations,
} from '../../core/api/services.api';
import { HintComponent } from '../../ui/hint.component';
import { formatAmount } from '../../core/currency/currency-symbols';

@Component({
  selector: 'app-service-detail',
  standalone: true,
  imports: [BackBarComponent, PayButtonComponent, InputComponent, HintComponent, RouterLink],
  template: `<app-back-bar />
    @if (product(); as p) {
      <section class="wrap">
        <div class="head">
          @if (p.icon_url) {
            <img class="ico" [src]="p.icon_url" alt="" />
          }
          <h2>{{ p.name }}</h2>
        </div>

        @if (p.disable_purchase) {
          <div class="soon">
            <div class="soon-sub">Покупка временно недоступна</div>
          </div>
        } @else if (hasPlans()) {
          @if (needsLogin()) {
            <div class="form">
              <div class="field">
                <label class="f-label">{{ p.login_label || 'Логин' }}</label>
                <app-input
                  [value]="login()"
                  (valueChange)="onLoginChange($event)"
                  [placeholder]="p.login_hint || 'Введите логин'"
                  [prefix]="p.login_prefix"
                  [error]="loginError()">
                </app-input>
              </div>
            </div>
          }

          <div class="denoms stagger-in">
            @for (d of denominations(); track d.id) {
              <button
                type="button"
                class="denom"
                [class.on]="selected()?.id === d.id"
                (click)="selected.set(d)">
                <span class="denom-value">
                  {{ denomLabel(d, p.denom_currency) }}
                </span>
                <span class="denom-price">
                  {{ money(d.price, p.issue_currency) }}
                </span>
              </button>
            }
          </div>

          @if (denominations().length === 0) {
            <div class="soon">
              <div class="soon-sub">
                {{ needsLogin()
                  ? 'Планы временно недоступны'
                  : 'Номиналы временно недоступны' }}
              </div>
            </div>
          }

          @if (selected(); as d) {
            <div class="order">
              <div class="row">
                <span>{{ needsLogin() ? 'План' : 'Номинал' }}</span>
                <span class="val">
                  {{ denomLabel(d, p.denom_currency) }}
                </span>
              </div>

              <div class="row total">
                <span>К оплате</span>
                <span class="total-val">
                  {{ money(d.price, p.issue_currency) }}
                </span>
              </div>
            </div>

            <app-pay-button
              label="Продолжить"
              [loading]="checking()"
              loadingLabel="Проверяем логин…"
              (clicked)="goCheckoutPlan()" />
          }
        } @else {
          <div class="form">
            <div class="field">
              <label class="f-label">{{ p.login_label || 'Логин' }}</label>

              <app-input
                [value]="login()"
                (valueChange)="onLoginChange($event)"
                [placeholder]="p.login_hint || 'Введите логин'"
                [prefix]="p.login_prefix"
                [error]="loginError()">
              </app-input>
            </div>

            <div class="field">
              <label class="f-label">{{ amountLabel() }}</label>

              <app-input
                [value]="entered()"
                (valueChange)="onAmountChange($event)"
                [inputmode]="isUnit() ? 'numeric' : 'decimal'"
                placeholder="0"
                [error]="amountError()">
              </app-input>

              @if (isUnit()) {
                @if (minPay() > 0 || maxPay() > 0) {
                  <p class="f-hint">
                    Количество
                    @if (minPay() > 0) {
                      от {{ minPay() }}
                      <img class="f-hint-ico" src="/assets/star.png" alt="" />
                    }
                    @if (maxPay() > 0) {
                      до {{ maxPay() }}
                      <img class="f-hint-ico" src="/assets/star.png" alt="" />
                    }
                  </p>
                }
              } @else if (limitsNote()) {
                <p class="f-hint">{{ limitsNote() }}</p>
              }

              @if (presets().length > 0) {
                <div class="presets">
                  @for (v of presets(); track v) {
                    <button
                      type="button"
                      class="preset"
                      [class.on]="num() === v"
                      (click)="pickPreset(v)">
                      @if (isUnit()) {
                        <span class="preset-num">{{ v }}</span>
                        <img
                          class="preset-ico"
                          src="/assets/star.png"
                          alt="" />
                      } @else {
                        {{ presetLabel(v) }}
                      }
                    </button>
                  }
                </div>
              }
            </div>

            <div class="credit">
              <span class="f-label">
                @if (isUnit()) {
                  К оплате
                } @else {
                  К зачислению на {{ p.name }}
                  <app-hint
                    [text]="'С учётом курсовой разницы на стороне ' + p.name + ' и провайдера услуг.'" />
                }
              </span>

              <!-- Визуально полностью такой же контейнер, как обычный app-input -->
              <output class="credit__val">
                {{ creditLine() }}
              </output>
            </div>

            <app-pay-button
              label="Продолжить"
              [loading]="checking()"
              loadingLabel="Проверяем логин…"
              (clicked)="goCheckoutTopup()" />
          </div>
        }
      </section>
    } @else if (notFound()) {
      <section class="wrap">
        <div class="soon">
          <div class="soon-sub">Сервис не найден</div>
        </div>
        <a class="link-btn" routerLink="/services">К сервисам</a>
      </section>
    } @else {
      <section
        class="wrap"
        role="status"
        aria-label="Загрузка сервиса">
        <span class="skel skel-lg"></span>
        <span class="skel"></span>
        <span class="skel"></span>
      </section>
    }`,

  styles: [`
    .wrap {
      padding: 0 16px;
      margin-bottom: 110px
      max-width: 1200px;
      margin: 0 auto;
      display: flex;
      flex-direction: column;
      gap: 20px;
      padding-bottom: 110px;
    }

    h2 {
      margin: 0;
      font-family: 'Syncopate Cyr';
      font-size: 22px;
      text-transform: uppercase;
      text-align: center;
    }


    /* =========================
       HEADER
       ========================= */

    .head {
      display: flex;
      flex-direction: row;
      align-items: center;
      gap: 20px;
    }

    .ico {
      width: 84px;
      height: 84px;
      flex: 0 0 84px;
      border-radius: 50%;
      object-fit: cover;
    }

    @media (min-width: 1024px) {
      h2 {
        font-size: 44px;
      }

      .ico {
        width: 120px;
        height: 120px;
        flex-basis: 120px;
        border-radius: 50%;
      }

      .wrap {
        padding-left: 120px;
        padding-right: 120px;
      }
    }


    /* =========================
       DENOMINATIONS
       ========================= */

    .denoms {
      display: grid;
      grid-template-columns: repeat(2, 1fr);
      gap: var(--space-sm);
    }

    .denom {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 12px;
      padding: var(--space-md) var(--space-sm);
      background: rgba(255, 255, 255, 1);
      border: 1px solid transparent;
      border-radius: var(--rounded-lg);
      box-shadow: 0px 27.22px 64.84px -22.27px rgba(0, 0, 0, 0.15);
      cursor: pointer;
      text-align: center;
      transition:
        border-color var(--dur-quick) ease,
        background var(--dur-quick) ease,
        transform var(--dur-quick) var(--ease-out),
        box-shadow var(--dur-quick) ease;
    }

    .denom:hover {
      transform: translateY(-1px);
      border-color: var(--color-primary);
      box-shadow: var(--shadow-card-hover);
    }

    .denom:active {
      transform: scale(.97);
    }

    .denom.on {
      border: 2px solid var(--color-primary);
      background: var(--color-primary-soft);
      padding: calc(var(--space-md) - 1px) calc(var(--space-sm) - 1px);
    }

    .denom-value {
    font-family: 'Gilroy'
      font-weight: 500;
      font-size: 18px;
      color: var(--color-ink);
    }

    .denom-price {
      color: rgba(114, 86, 22, 1);
      font-family: 'Gilroy', sans-serif;
      font-size: 15px;
    }

    @media (min-width: 1024px) {
      .denoms {
        grid-template-columns: repeat(3, 1fr);
        gap: 10px;
      }

      .denom {
        gap: 6px;
        padding: 11px 8px;
        border-radius: 15px;
      }

      .denom.on {
        padding: 10px 7px;
      }

      .denom-value {
        font-size: 22px;
      }

      .denom-price {
        font-size: 17px;
      }
    }


    /* =========================
       FORM
       ========================= */

    .form {
      display: flex;
      flex-direction: column;
      gap: 28px;
    }

    .field {
      display: flex;
      flex-direction: column;
      gap: 12px;
    }

    .f-label {
      font-family: 'Gilroy';
      font-size: 13px;
      font-weight: 600;
      color: rgba(0, 0, 0, 1);
    }

    .f-hint {
      font-family: 'Gilroy';
      margin: 0;
      display: flex;
      align-items: center;
      gap: 4px;
      font-size: 13px;
      font-weight: 600;
      color: rgba(0, 0, 0, 1);
      margin-top: 20px;
    }

    .f-hint-ico {
      width: 14px;
      height: 14px;
      flex: 0 0 14px;
    }

    @media (min-width: 1024px) {
      .form {
        gap: 20px;
      }

      .field {
        gap: 7px;
      }

      .f-label {
        font-size: 16px;
      }

      .f-hint {
        font-size: 16px;
      }

      .f-hint-ico {
        width: 11px;
        height: 11px;
        flex: 0 0 11px;
      }

      /*
       * ОБЫЧНЫЕ INPUT
       *
       * Было:
       * height: 62px
       * font-size: 20px
       * padding: 0 14px
       *
       * Теперь ещё компактнее.
       */
      .form ::ng-deep input {
        height: 52px;
        min-height: 52px;
        padding: 0 12px;
        font-size: 16px;
        border-radius: 14px;
      }
    }


    /* =========================
       CREDIT INPUT
       ========================= */

    .credit {
      display: flex;
      flex-direction: column;
      gap: 6px;
    }
.credit__val {

  display: flex;

  align-items: center;

  width: 100%;

  box-sizing: border-box;

  height: 52px;

  min-height: 52px;

  padding: 0 14px;

  border: 1.5px solid rgba(211, 211, 211, 1);

  border-radius: 14px;

  background: var(--color-surface);

  color: var(--color-ink);

  font-family: 'Gilroy', sans-serif;

  font-size: 16px;

  font-weight: 600;

  line-height: 1;

  margin: 0;

  outline: none;

}

    @media (min-width: 1024px) {
      /*
       * Ровно те же размеры, что и у обычного input:
       * 52px / 12px / 16px / 14px.
       */
      .credit__val {
    height: 52px;

    min-height: 52px;

    padding: 0 12px;

    border-radius: 14px;

    font-size: 16px;
      }
    }


    /* =========================
       PRESETS
       ========================= */

    .presets {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
    }

    .preset {
      font-family: 'Gilroy';
      display: inline-flex;
      align-items: center;
      gap: 4px;
      padding: 8px 14px;
      border-radius: var(--rounded-pill);
      background: rgba(255, 255, 255, 1);
      color: var(--color-ink);
      border: 1.5px solid transparent;
      cursor: pointer;
      font-size: 16px;
      font-weight: 500;
      transition:
        background var(--dur-quick) ease,
        border-color var(--dur-quick) ease,
        color var(--dur-quick) ease,
        transform var(--dur-quick) var(--ease-out);
    }

    .preset:active {
      transform: scale(.96);
    }

    .preset.on {
      border: 1.5px solid rgba(255, 186, 38, 1);
      background: rgba(250, 240, 218, 1);
      color: var(--color-ink);
    }

    .preset-ico {
      width: 20px;
      height: 20px;
    }

    @media (min-width: 1024px) {
      .presets {
        gap: 5px;
      }

      .preset {
        padding: 5px 9px;
        font-size: 14px;
      }

      .preset-ico {
        width: 16px;
        height: 16px;
      }
    }


    /* =========================
       ORDER
       ========================= */

    .order {
      display: flex;
      flex-direction: column;
      padding: var(--space-md);
      background: var(--color-surface-card);
      border-radius: var(--rounded-lg);
    }

    .row {
      display: flex;
      justify-content: space-between;
      align-items: baseline;
      padding: var(--space-sm) 0;
      font-size: 15px;
      color: var(--color-body);
    }

    .row + .row {
      border-top: 1px solid color-mix(
        in srgb,
        var(--color-hairline) 60%,
        transparent
      );
    }

    .row.total {
      font-weight: 500;
      font-size: 16px;
      color: var(--color-ink);
    }

    .val {
      font-weight: 500;
    }

    .total-val {
      font-family: var(--font-display);
      font-size: 22px;
      color: var(--color-primary-ink);
      font-weight: 500;
    }

    @media (min-width: 1024px) {
      .order {
        padding: 12px 14px;
        border-radius: 14px;
      }

      .row {
        padding: 5px 0;
        font-size: 12px;
      }

      .row.total {
        font-size: 13px;
      }

      .total-val {
        font-size: 17px;
      }
    }


    /* =========================
       OTHER STATES
       ========================= */

    .soon {
      padding: var(--space-lg) var(--space-md);
      border: 2px dashed color-mix(
        in srgb,
        var(--color-ink) 22%,
        transparent
      );
      border-radius: var(--rounded-lg);
      text-align: center;
      background: var(--color-surface);
    }

    .soon-sub {
      color: var(--color-muted);
      font-size: 13px;
    }

    .link-btn {
      align-self: center;
      color: var(--color-primary-ink);
      font-size: 14px;
      font-weight: 500;
      text-decoration: none;
      padding: var(--space-sm);
    }

    .skel {
      display: block;
      height: 56px;
      border-radius: var(--rounded-lg);
      background: color-mix(
        in srgb,
        var(--color-primary) 6%,
        var(--color-surface)
      );
      position: relative;
      overflow: hidden;
    }

    .skel-lg {
      height: 120px;
    }

    .skel::after {
      content: "";
      position: absolute;
      inset: 0;
      background: linear-gradient(
        100deg,
        transparent 32%,
        color-mix(in srgb, #fff 55%, transparent) 50%,
        transparent 68%
      );
      transform: translateX(-100%);
      animation: sd-skel 1.6s ease-in-out infinite;
    }

    @keyframes sd-skel {
      to {
        transform: translateX(100%);
      }
    }

    @media (prefers-reduced-motion: reduce) {
      .skel::after {
        animation: none;
      }
    }
  `],
})
export class ServiceDetailPage implements OnInit {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly servicesApi = inject(ServicesApi);

  protected readonly product = signal<ServiceProduct | null>(null);
  protected readonly notFound = signal(false);
  protected readonly selected = signal<ServiceDenomination | null>(null);
  protected readonly login = signal('');
  protected readonly loginError = signal('');

  protected readonly entered = signal('');
  protected readonly amountError = signal('');
  protected readonly checking = signal(false);
  private slug = '';

  protected readonly denominations = computed<ServiceDenomination[]>(() =>
    visibleDenominations(this.product())
  );

  protected readonly hasPlans = computed(() =>
    serviceHasDenominations(this.product()?.kind)
  );

  protected readonly needsLogin = computed(() =>
    serviceNeedsLogin(this.product()?.kind)
  );

  protected readonly isUnit = computed(() =>
    isUnitTopup(this.product())
  );

  protected readonly num = computed(() => {
    const v = parseFloat(this.entered().replace(',', '.'));
    return isFinite(v) && v > 0 ? v : 0;
  });

  protected readonly credited = computed(() => {
    const p = this.product();
    if (!p) return 0;

    if (this.isUnit()) return Math.floor(this.num());

    const c = topupCreditedFor(this.num(), p);

    if (
      p.min_amount > 0 &&
      c < p.min_amount &&
      this.num() >= this.minPay()
    ) {
      return p.min_amount;
    }

    if (p.max_amount > 0 && c > p.max_amount) {
      return p.max_amount;
    }

    return c;
  });

  protected readonly payTotal = computed(() => {
    const p = this.product();
    if (!p) return 0;

    return this.isUnit()
      ? topupPayFor(this.credited(), p)
      : this.num();
  });

  protected readonly creditedShown = computed(() =>
    topupCreditedDisplay(
      this.payTotal(),
      this.product()?.fee_pct ?? 0
    )
  );

  protected readonly minPay = computed(() => {
    const p = this.product();
    if (!p || p.min_amount <= 0) return 0;

    return this.isUnit()
      ? p.min_amount
      : topupPayFor(p.min_amount, p);
  });

  protected readonly maxPay = computed(() => {
    const p = this.product();
    if (!p || p.max_amount <= 0) return 0;

    return this.isUnit()
      ? p.max_amount
      : topupPayFor(p.max_amount, p);
  });

  protected readonly presets = computed(() => {
    const list = this.product()?.amount_presets ?? [];

    return list.filter(
      (v) =>
        (this.minPay() <= 0 || v >= this.minPay()) &&
        (this.maxPay() <= 0 || v <= this.maxPay())
    );
  });

  protected readonly amountLabel = computed(() => {
    const p = this.product();
    if (!p) return '';

    return (
      p.amount_label ||
      (this.isUnit()
        ? 'Количество'
        : `Сумма к оплате, ${p.issue_currency}`)
    );
  });

  protected readonly limitsNote = computed(() => {
    const p = this.product();
    if (!p) return '';

    const parts: string[] = [];

    if (this.minPay() > 0) {
      parts.push(`от ${this.enteredLabel(this.minPay())}`);
    }

    if (this.maxPay() > 0) {
      parts.push(`до ${this.enteredLabel(this.maxPay())}`);
    }

    if (!parts.length) return '';

    return `${this.isUnit() ? 'Количество' : 'Сумма'} ${parts.join(' ')}`;
  });

  protected readonly creditLine = computed(() => {
    const p = this.product();
    if (!p) return '—';

    if (this.isUnit()) {
      return this.credited() > 0
        ? formatAmount(this.payTotal(), p.issue_currency)
        : '—';
    }

    return this.credited() > 0
      ? `~ ${formatAmount(this.creditedShown(), p.amount_currency)}`
      : '—';
  });

  ngOnInit(): void {
    this.slug = this.route.snapshot.paramMap.get('slug') ?? '';

    this.servicesApi.productBySlug(this.slug).subscribe({
      next: (r) => this.product.set(r.product),
      error: () => this.notFound.set(true),
    });
  }

  private loginValue(): string {
    const v = this.login().trim();
    const prefix = this.product()?.login_prefix ?? '';

    return prefix && v === prefix ? '' : v;
  }

  protected onLoginChange(v: string): void {
    this.login.set(v);

    if (this.loginError()) {
      this.loginError.set('');
    }
  }

  protected onAmountChange(v: string): void {
    this.entered.set(v);

    if (this.amountError()) {
      this.amountError.set('');
    }
  }

  protected pickPreset(v: number): void {
    this.entered.set(String(v));
    this.amountError.set('');
  }

  protected presetLabel(v: number): string {
    const p = this.product();
    if (!p) return String(v);

    return this.isUnit()
      ? `${v} ${p.amount_unit}`
      : formatAmount(v, p.issue_currency);
  }

  private enteredLabel(v: number): string {
    const p = this.product();
    if (!p) return String(v);

    return this.isUnit()
      ? `${v} ${p.amount_unit}`
      : formatAmount(v, p.issue_currency);
  }

  protected goCheckoutPlan(): void {
    const p = this.product();
    const d = this.selected();

    if (!p || !d || this.checking()) return;

    if (!this.needsLogin()) {
      void this.router.navigate(
        ['/services', this.slug, 'checkout'],
        { queryParams: { denomination: d.id } }
      );
      return;
    }

    const login = this.loginValue();

    if (!login) {
      this.loginError.set(
        `Укажите ${p.login_label || 'логин'}`
      );
      return;
    }

    const go = (): void => {
      void this.router.navigate(
        ['/services', this.slug, 'checkout'],
        {
          queryParams: {
            login,
            denomination: d.id,
          },
        }
      );
    };

    this.checking.set(true);

    this.servicesApi.validateLogin(p.id, login).subscribe({
      next: (r) => {
        this.checking.set(false);

        if (r.checked && !r.valid) {
          this.loginError.set(
            'Логин не найден — проверьте правильность'
          );
          return;
        }

        go();
      },
      error: () => {
        this.checking.set(false);
        go();
      },
    });
  }

  protected goCheckoutTopup(): void {
    const p = this.product();

    if (!p || this.checking()) return;

    const login = this.loginValue();

    if (!login) {
      this.loginError.set(
        `Укажите ${p.login_label || 'логин'}`
      );
      return;
    }

    const entered = this.num();

    if (entered <= 0) {
      this.amountError.set(
        this.isUnit()
          ? 'Укажите количество'
          : 'Укажите сумму пополнения'
      );
      return;
    }

    if (
      this.isUnit() &&
      entered !== Math.floor(entered)
    ) {
      this.amountError.set(
        'Количество должно быть целым'
      );
      return;
    }

    if (this.minPay() > 0 && entered < this.minPay()) {
      this.amountError.set(
        `Минимум — ${this.enteredLabel(this.minPay())}`
      );
      return;
    }

    if (this.maxPay() > 0 && entered > this.maxPay()) {
      this.amountError.set(
        `Максимум — ${this.enteredLabel(this.maxPay())}`
      );
      return;
    }

    const a = this.credited();

    this.checking.set(true);

    this.servicesApi.validateLogin(p.id, login).subscribe({
      next: (r) => {
        this.checking.set(false);

        if (r.checked && !r.valid) {
          this.loginError.set(
            'Логин не найден — проверьте правильность'
          );
          return;
        }

        void this.router.navigate(
          ['/services', this.slug, 'checkout'],
          {
            queryParams: {
              login,
              amount: a,
            },
          }
        );
      },
      error: () => {
        this.checking.set(false);

        void this.router.navigate(
          ['/services', this.slug, 'checkout'],
          {
            queryParams: {
              login,
              amount: a,
            },
          }
        );
      },
    });
  }

  protected money(
    v: number | string | null | undefined,
    c: string | null | undefined
  ): string {
    return formatAmount(v, c);
  }

  protected denomLabel(
    d: ServiceDenomination,
    denomCurrency: string
  ): string {
    return denominationLabel(
      d,
      denomCurrency,
      (v, c) => formatAmount(v, c)
    );
  }
}