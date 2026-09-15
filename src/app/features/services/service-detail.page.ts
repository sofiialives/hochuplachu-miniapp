import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { BackBarComponent } from '../../ui/back-bar.component';
import { ButtonComponent } from '../../ui/button.component';
import { InputComponent } from '../../ui/input.component';
import {
  ServicesApi, ServiceDenomination, ServiceProduct, denominationLabel, isUnitTopup,
  serviceHasDenominations, serviceNeedsLogin, topupCreditedFor, topupCreditedDisplay,
  topupPayFor, visibleDenominations,
} from '../../core/api/services.api';
import { HintComponent } from '../../ui/hint.component';
import { formatAmount } from '../../core/currency/currency-symbols';

// ServiceDetailPage — «/services/:slug». Три вида продукта, две формы:
// gift_card и subscription — сетка позиций («50 TRY — 1 490 ₽», «12 месяцев»)
// плюс сводка заказа, и у подписки над сеткой поле логина (она включается на
// аккаунт); account_topup — логин + сумма/количество + пресеты.
//
// Считаем ОТ СУММЫ ОПЛАТЫ: пользователь вводит, сколько платит, и видит
// оценку зачисления (сумма минус наценка, «~» — курс на стороне сервиса и
// провайдера плавает). Наценку отдельной строкой не показываем. Контракт бэка
// обратный (ждёт сумму зачисления и сам добавляет наценку), поэтому в query
// чекаута — как и раньше — уезжает amount = сумма ЗАЧИСЛЕНИЯ; так же её
// строит лендинг. CTA ведёт на /services/:slug/checkout c query
// (deep-link-совместимо с лендингом).
@Component({
  selector: 'app-service-detail',
  standalone: true,
  imports: [BackBarComponent, ButtonComponent, InputComponent, HintComponent, RouterLink],
  template: `<app-back-bar />
    @if (product(); as p) {
      <section class="wrap">
        <div class="head">
          @if (p.icon_url) { <img class="ico" [src]="p.icon_url" alt="" /> }
          <h2>{{ p.name }}</h2>
        </div>

        @if (p.disable_purchase) {
          <div class="soon"><div class="soon-sub">Покупка временно недоступна</div></div>
        } @else if (hasPlans()) {
          <!-- ===== Выбор позиции: номиналы гифткарты либо планы подписки.
               Разница одна — подписка включается на АККАУНТ, поэтому над
               выбором у неё поле логина. -->
          @if (needsLogin()) {
            <div class="form">
              <div class="field">
                <label class="f-label">{{ p.login_label || 'Логин' }}</label>
                <app-input
                  [value]="login()"
                  (valueChange)="onLoginChange($event)"
                  [placeholder]="p.login_hint || 'Введите логин'"
                  [prefix]="p.login_prefix"
                  [error]="loginError()"></app-input>
              </div>
            </div>
          }
          <div class="denoms stagger-in">
            @for (d of denominations(); track d.id) {
              <button type="button" class="denom" [class.on]="selected()?.id === d.id" (click)="selected.set(d)">
                <span class="denom-value">{{ denomLabel(d, p.denom_currency) }}</span>
                <span class="denom-price">{{ money(d.price, p.issue_currency) }}</span>
              </button>
            }
          </div>
          @if (denominations().length === 0) {
            <div class="soon"><div class="soon-sub">{{ needsLogin() ? 'Планы временно недоступны' : 'Номиналы временно недоступны' }}</div></div>
          }
          @if (selected(); as d) {
            <div class="order">
              <div class="row">
                <span>{{ needsLogin() ? 'План' : 'Номинал' }}</span>
                <span class="val">{{ denomLabel(d, p.denom_currency) }}</span>
              </div>
              <div class="row total">
                <span>К оплате</span>
                <span class="total-val">{{ money(d.price, p.issue_currency) }}</span>
              </div>
            </div>
            <app-button variant="primary" [full]="true" [loading]="checking()" loadingLabel="Проверяем логин…" (clicked)="goCheckoutPlan()">
              Продолжить
            </app-button>
          }
        } @else {
          <!-- ===== Пополнение аккаунта =====
               Две формы одного вида продукта: ДЕНЕЖНАЯ (Steam) — вводится
               сумма оплаты, показывается оценка зачисления; ШТУЧНАЯ (звёзды) —
               вводится количество единиц, показывается точная цена. -->
          <div class="form">
            <div class="field">
              <label class="f-label">{{ p.login_label || 'Логин' }}</label>
              <app-input
                [value]="login()"
                (valueChange)="onLoginChange($event)"
                [placeholder]="p.login_hint || 'Введите логин'"
                [prefix]="p.login_prefix"
                [error]="loginError()"></app-input>
            </div>

            <div class="field">
              <label class="f-label">{{ amountLabel() }}</label>
              <app-input
                [value]="entered()"
                (valueChange)="onAmountChange($event)"
                [inputmode]="isUnit() ? 'numeric' : 'decimal'"
                placeholder="0"
                [error]="amountError()"></app-input>
              @if (limitsNote()) { <p class="f-hint">{{ limitsNote() }}</p> }

              @if (presets().length > 0) {
                <div class="presets">
                  @for (v of presets(); track v) {
                    <button type="button" class="preset" [class.on]="num() === v" (click)="pickPreset(v)">
                      @if (isUnit()) {
                        <span class="preset-num">{{ v }}</span>
                        <!-- TODO: заменить на реальный PNG звезды 20×20, когда
                             пришлёшь файл — сейчас путь-заглушка. -->
                        <img class="preset-ico" src="/assets/services/star.png" alt="" />
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
                  <app-hint [text]="'С учётом курсовой разницы на стороне ' + p.name + ' и провайдера услуг.'" />
                }
              </span>
              <output class="credit__val">{{ creditLine() }}</output>
            </div>

            <app-button variant="primary" [full]="true" [loading]="checking()" loadingLabel="Проверяем логин…" (clicked)="goCheckoutTopup()">
              Продолжить
            </app-button>
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
      <section class="wrap" role="status" aria-label="Загрузка сервиса">
        <span class="skel skel-lg"></span>
        <span class="skel"></span>
        <span class="skel"></span>
      </section>
    }`,
  styles: [`
    /* .wrap — общий паттерн отступов, как в main.page.ts/services.page.ts. */
    .wrap {
      padding: 0 16px;
      max-width: 1200px; margin: 0 auto;
      display: flex; flex-direction: column; gap: 20px;
      padding-bottom: var(--space-xl);
    }
    @media (min-width: 1024px) { .wrap { padding-left: 120px; padding-right: 120px; } }
    h2 { margin: 0; font-family: 'Syncopate Cyr'; font-size: 22px; text-transform: uppercase; text-align: center; }
    /* Иконка+название — центрированный столбик, без описания (убрано вовсе).
       Раньше margin-bottom на .head СКЛАДЫВАЛСЯ с общим gap самого .wrap —
       получалось двойное расстояние. Теперь единственный источник
       расстояния — gap: 20px у .wrap выше, здесь его больше нет. */
    .head { display: flex; flex-direction: column; align-items: center; gap: 12px; }
    .ico { width: 64px; height: 64px; border-radius: 12px; object-fit: contain; }
    @media (min-width: 1024px) {
      h2 { font-size: 36px; }
      .ico { width: 102px; height: 102px; }
    }

    /* Номиналы: карточки цен для обычных gift_card/subscription — 2 в ряд на
       телефоне, 3 на десктопе, текст по центру. */
    .denoms { display: grid; grid-template-columns: repeat(2, 1fr); gap: var(--space-sm); }
    @media (min-width: 1024px) { .denoms { grid-template-columns: repeat(3, 1fr); } }
    .denom {
      display: flex; flex-direction: column; align-items: center; gap: 12px;
      padding: var(--space-md) var(--space-sm);
      background: rgba(255, 255, 255, 1);
      border: 1px solid transparent;
      border-radius: var(--rounded-lg);
      box-shadow: 0px 27.22px 64.84px -22.27px rgba(0, 0, 0, 0.15);
      cursor: pointer;
      text-align: center;
      transition: border-color var(--dur-quick) ease, background var(--dur-quick) ease, transform var(--dur-quick) var(--ease-out), box-shadow var(--dur-quick) ease;
    }
    .denom:hover { transform: translateY(-1px); border-color: var(--color-primary); box-shadow: var(--shadow-card-hover); }
    .denom:active { transform: scale(.97); }
    .denom.on {
      border: 2px solid var(--color-primary);
      background: var(--color-primary-soft);
      padding: calc(var(--space-md) - 1px) calc(var(--space-sm) - 1px);
    }
    /* «дата» — верхняя строка номинала (для подписок это реально длительность
       вроде «12 месяцев», для гифткарт — сумма/название товара). */
    .denom-value { font-weight: 600; font-size: 18px; color: var(--color-ink); }
    .denom-price { color: rgba(114, 86, 22, 1); font-size: 15px; }
    @media (min-width: 1024px) {
      .denom-value { font-size: 32px; }
      .denom-price { font-size: 26px; }
    }

    /* .form — контейнеры (поля ввода, звёзды, «к оплате») разделены 28px на
       телефоне / 36px на десктопе; .field — гэп ровно между лейблом и полем. */
    .form { display: flex; flex-direction: column; gap: 28px; }
    .field { display: flex; flex-direction: column; gap: 12px; }
    @media (min-width: 1024px) { .form { gap: 36px; } }
    .f-label { font-size: 13px; font-weight: 600; color: rgba(0, 0, 0, 1); }
    .f-hint { margin: 0; font-size: 12px; color: var(--color-muted); }
    .presets { display: flex; flex-wrap: wrap; gap: 8px; }
    .preset {
      display: inline-flex; align-items: center; gap: 4px;
      padding: 8px 14px; border-radius: var(--rounded-pill);
      background: rgba(255, 255, 255, 1); color: var(--color-ink);
      border: 1.5px solid transparent; cursor: pointer; font-size: 16px; font-weight: 500;
      transition: background var(--dur-quick) ease, border-color var(--dur-quick) ease, color var(--dur-quick) ease, transform var(--dur-quick) var(--ease-out);
    }
    .preset:active { transform: scale(.96); }
    .preset.on { border: 1.5px solid rgba(255, 186, 38, 1); background: rgba(250, 240, 218, 1); color: var(--color-ink); }
    .preset-ico { width: 20px; height: 20px; }
    @media (min-width: 1024px) { .preset { font-size: 20px; } }

    /* «К оплате» — оформлен как настоящий input.component.ts (то же
       значение border/padding/шрифта, что и у обычных полей формы). */
    .credit { display: flex; flex-direction: column; gap: 6px; }
    .credit__val {
      display: flex; align-items: center;
      min-height: 44px; padding: 20px;
      border: 1.5px solid rgba(211, 211, 211, 1);
      border-radius: var(--rounded-md);
      background: var(--color-surface);
      color: var(--color-ink);
      font-size: 18px; font-weight: 600;
    }
    @media (min-width: 1024px) { .credit__val { padding: 26px; font-size: 22px; } }

    .order {
      display: flex; flex-direction: column;
      padding: var(--space-md);
      background: var(--color-surface-card);
      border-radius: var(--rounded-lg);
    }
    .row {
      display: flex; justify-content: space-between; align-items: baseline;
      padding: var(--space-sm) 0;
      font-size: 15px; color: var(--color-body);
    }
    .row + .row { border-top: 1px solid color-mix(in srgb, var(--color-hairline) 60%, transparent); }
    .row.total { font-weight: 500; font-size: 16px; color: var(--color-ink); }
    .val { font-weight: 500; }
    .total-val { font-family: var(--font-display); font-size: 22px; color: var(--color-primary-ink); font-weight: 500; }

    .soon {
      padding: var(--space-lg) var(--space-md);
      border: 2px dashed color-mix(in srgb, var(--color-ink) 22%, transparent);
      border-radius: var(--rounded-lg);
      text-align: center;
      background: var(--color-surface);
    }
    .soon-sub { color: var(--color-muted); font-size: 13px; }
    .link-btn { align-self: center; color: var(--color-primary-ink); font-size: 14px; font-weight: 500; text-decoration: none; padding: var(--space-sm); }

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
      animation: sd-skel 1.6s ease-in-out infinite;
    }
    @keyframes sd-skel { to { transform: translateX(100%); } }
    @media (prefers-reduced-motion: reduce) { .skel::after { animation: none; } }
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
  /** Введённое пользователем число строкой (сумма оплаты либо количество). */
  protected readonly entered = signal('');
  protected readonly amountError = signal('');
  protected readonly checking = signal(false);
  private slug = '';

  protected readonly denominations = computed<ServiceDenomination[]>(() => visibleDenominations(this.product()));
  /** Продукт с выбором позиции: номиналы гифткарты либо планы подписки. */
  protected readonly hasPlans = computed(() => serviceHasDenominations(this.product()?.kind));
  /** Виду нужен логин аккаунта (подписка, пополнение). */
  protected readonly needsLogin = computed(() => serviceNeedsLogin(this.product()?.kind));
  /** Штучное пополнение — вводится КОЛИЧЕСТВО единиц, а не сумма денег. */
  protected readonly isUnit = computed(() => isUnitTopup(this.product()));
  /** Введённое число: у денежного пополнения — сумма оплаты, у штучного —
   *  количество единиц. */
  protected readonly num = computed(() => {
    const v = parseFloat(this.entered().replace(',', '.'));
    return isFinite(v) && v > 0 ? v : 0;
  });
  // credited — то, что уезжает в заказ как amount: количество единиц у
  // штучного пополнения, сумма зачисления у денежного. На нижней границе
  // лимита округление вниз может дать копейку недобора (бэк отбил бы заказ с
  // amount_below_min) — там подтягиваем ровно к минимуму продукта; на верхней
  // запас округления цены (см. topupCreditedFor) наоборот даёт перебор —
  // прижимаем к максимуму, иначе бэк отобьёт amount_above_max.
  protected readonly credited = computed(() => {
    const p = this.product();
    if (!p) return 0;
    if (this.isUnit()) return Math.floor(this.num());
    const c = topupCreditedFor(this.num(), p);
    if (p.min_amount > 0 && c < p.min_amount && this.num() >= this.minPay()) return p.min_amount;
    if (p.max_amount > 0 && c > p.max_amount) return p.max_amount;
    return c;
  });
  /** Итог к оплате в валюте прайса. */
  protected readonly payTotal = computed(() => {
    const p = this.product();
    if (!p) return 0;
    return this.isUnit() ? topupPayFor(this.credited(), p) : this.num();
  });
  // Витрина показывает оплату минус наш процент (см. topupCreditedDisplay);
  // this.credited() — расчётная сумма для заказа, она уходит на бэкенд.
  protected readonly creditedShown = computed(() =>
    topupCreditedDisplay(this.payTotal(), this.product()?.fee_pct ?? 0));
  // Лимиты продукта заданы в единицах ЗАЧИСЛЕНИЯ. У штучного пополнения
  // пользователь вводит их же, а у денежного — сумму оплаты, поэтому границы
  // переводятся в его систему координат.
  protected readonly minPay = computed(() => {
    const p = this.product();
    if (!p || p.min_amount <= 0) return 0;
    return this.isUnit() ? p.min_amount : topupPayFor(p.min_amount, p);
  });
  protected readonly maxPay = computed(() => {
    const p = this.product();
    if (!p || p.max_amount <= 0) return 0;
    return this.isUnit() ? p.max_amount : topupPayFor(p.max_amount, p);
  });
  // Пресеты — «круглые» значения ввода: суммы оплаты у денежного пополнения,
  // пакеты единиц у штучного. Те, что вне границ, не показываем — иначе
  // кнопка вела бы в ошибку.
  protected readonly presets = computed(() => {
    const list = this.product()?.amount_presets ?? [];
    return list.filter((v) => (this.minPay() <= 0 || v >= this.minPay()) && (this.maxPay() <= 0 || v <= this.maxPay()));
  });
  /** Подпись поля ввода: своя у продукта («Количество звёзд») либо дефолт. */
  protected readonly amountLabel = computed(() => {
    const p = this.product();
    if (!p) return '';
    return p.amount_label || (this.isUnit() ? 'Количество' : `Сумма к оплате, ${p.issue_currency}`);
  });
  protected readonly limitsNote = computed(() => {
    const p = this.product();
    if (!p) return '';
    const parts: string[] = [];
    if (this.minPay() > 0) parts.push(`от ${this.enteredLabel(this.minPay())}`);
    if (this.maxPay() > 0) parts.push(`до ${this.enteredLabel(this.maxPay())}`);
    if (!parts.length) return '';
    return `${this.isUnit() ? 'Количество' : 'Сумма'} ${parts.join(' ')}`;
  });
  /** Строка под формой: цена у штучного, оценка зачисления у денежного. */
  protected readonly creditLine = computed(() => {
    const p = this.product();
    if (!p) return '—';
    if (this.isUnit()) return this.credited() > 0 ? formatAmount(this.payTotal(), p.issue_currency) : '—';
    return this.credited() > 0 ? `~ ${formatAmount(this.creditedShown(), p.amount_currency)}` : '—';
  });

  ngOnInit(): void {
    this.slug = this.route.snapshot.paramMap.get('slug') ?? '';
    this.servicesApi.productBySlug(this.slug).subscribe({
      next: (r) => this.product.set(r.product),
      error: () => this.notFound.set(true),
    });
  }

  // loginValue — введённый логин без промежуточных состояний маски: одна
  // приставка («@») логином не является, иначе заказ уехал бы провайдеру с
  // заведомо чужим ником и упал бы уже после оплаты.
  private loginValue(): string {
    const v = this.login().trim();
    const prefix = this.product()?.login_prefix ?? '';
    return prefix && v === prefix ? '' : v;
  }

  protected onLoginChange(v: string): void {
    this.login.set(v);
    if (this.loginError()) this.loginError.set('');
  }
  protected onAmountChange(v: string): void {
    this.entered.set(v);
    if (this.amountError()) this.amountError.set('');
  }
  protected pickPreset(v: number): void {
    this.entered.set(String(v));
    this.amountError.set('');
  }
  /** Подпись пресета: пакет единиц («100 ⭐») либо сумма оплаты. */
  protected presetLabel(v: number): string {
    const p = this.product();
    if (!p) return String(v);
    return this.isUnit() ? `${v} ${p.amount_unit}` : formatAmount(v, p.issue_currency);
  }
  /** Значение в системе координат поля ввода — для подсказок и ошибок. */
  private enteredLabel(v: number): string {
    const p = this.product();
    if (!p) return String(v);
    return this.isUnit() ? `${v} ${p.amount_unit}` : formatAmount(v, p.issue_currency);
  }

  // goCheckoutPlan — переход на чекаут с выбранной позицией. У подписки к ней
  // добавляется логин (и проверяется так же, как у пополнения: явный invalid
  // блокирует, недоступный провайдер — нет).
  protected goCheckoutPlan(): void {
    const p = this.product();
    const d = this.selected();
    if (!p || !d || this.checking()) return;
    if (!this.needsLogin()) {
      void this.router.navigate(['/services', this.slug, 'checkout'], { queryParams: { denomination: d.id } });
      return;
    }
    const login = this.loginValue();
    if (!login) {
      this.loginError.set(`Укажите ${p.login_label || 'логин'}`);
      return;
    }
    const go = (): void => {
      void this.router.navigate(['/services', this.slug, 'checkout'], {
        queryParams: { login, denomination: d.id },
      });
    };
    this.checking.set(true);
    this.servicesApi.validateLogin(p.id, login).subscribe({
      next: (r) => {
        this.checking.set(false);
        if (r.checked && !r.valid) {
          this.loginError.set('Логин не найден — проверьте правильность');
          return;
        }
        go();
      },
      error: () => { this.checking.set(false); go(); },
    });
  }

  // goCheckoutTopup — валидация формы + логина (POST /services/validate-login,
  // публичный: провайдер без capability отвечает checked:false — пропускаем).
  protected goCheckoutTopup(): void {
    const p = this.product();
    if (!p || this.checking()) return;
    const login = this.loginValue();
    if (!login) {
      this.loginError.set(`Укажите ${p.login_label || 'логин'}`);
      return;
    }
    // Лимиты проверяем в системе координат ПОЛЯ ВВОДА (сумма к оплате либо
    // количество единиц) — сам заказ уезжает зачислением, его бэк сверит со
    // своими min/max.
    const entered = this.num();
    if (entered <= 0) {
      this.amountError.set(this.isUnit() ? 'Укажите количество' : 'Укажите сумму пополнения');
      return;
    }
    if (this.isUnit() && entered !== Math.floor(entered)) {
      this.amountError.set('Количество должно быть целым');
      return;
    }
    if (this.minPay() > 0 && entered < this.minPay()) {
      this.amountError.set(`Минимум — ${this.enteredLabel(this.minPay())}`);
      return;
    }
    if (this.maxPay() > 0 && entered > this.maxPay()) {
      this.amountError.set(`Максимум — ${this.enteredLabel(this.maxPay())}`);
      return;
    }
    const a = this.credited();
    this.checking.set(true);
    this.servicesApi.validateLogin(p.id, login).subscribe({
      next: (r) => {
        this.checking.set(false);
        if (r.checked && !r.valid) {
          this.loginError.set('Логин не найден — проверьте правильность');
          return;
        }
        void this.router.navigate(['/services', this.slug, 'checkout'], { queryParams: { login, amount: a } });
      },
      // Провайдер недоступен — не блокируем UX (бэк перепроверит на заказе).
      error: () => {
        this.checking.set(false);
        void this.router.navigate(['/services', this.slug, 'checkout'], { queryParams: { login, amount: a } });
      },
    });
  }

  protected money(v: number | string | null | undefined, c: string | null | undefined): string { return formatAmount(v, c); }

  /** Подпись номинала: имя товара от поставщика либо сумма с валютой. */
  protected denomLabel(d: ServiceDenomination, denomCurrency: string): string {
    return denominationLabel(d, denomCurrency, (v, c) => formatAmount(v, c));
  }
}