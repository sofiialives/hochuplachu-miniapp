import { Component, computed, inject, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { ActivatedRoute, Router } from '@angular/router';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { AdminApi, AdminEsimOrder, AdminEsimRecharge, AdminOrder, AdminServiceOrder, AdminTopup } from '../../core/api/admin.api';
import { InputComponent } from '../../ui/input.component';
import { ButtonComponent } from '../../ui/button.component';
import { ToastService } from '../../core/notifications/toast.service';
import { errorMessage } from '../../core/errors/api-error';
import { formatAmount } from '../../core/currency/currency-symbols';

type Tab = 'orders' | 'topups';
type PType = 'card' | 'esim' | 'service';

// OrdersAdminPage — заявки на выпуск (карты | eSIM) и пополнения
// (карты | eSIM-recharge | сервис-заказы) с пагинацией и фильтрами.
// Состояние вкладки И фильтра типа живёт в queryParams роута (?tab=&type=) —
// F5/deep-link сохраняют выбранный раздел.
// Кнопка «Повторить» (admin-only) перезапускает failed-заявку, по которой
// деньги уже приняты; retry строго per-type: карты — /admin/orders|topups/:id/
// retry, eSIM-выпуски — /admin/esim-orders/:id/retry, сервисы —
// /admin/service-orders/:id/retry (attempt+1 = новый ключ идемпотентности).
// У eSIM-recharge admin-retry нет (провайдер продлевает только текущий план;
// фейл разруливается вручную). Сортировка фиксированная: created_at DESC.
// Колонка «Промокод» есть у всех типов: признак «по промокоду» и размер
// скидки (в валюте прайса/пополнения) видит и модератор, САМ КОД — только
// админ. Гейт роли серверный: бэк не кладёт promo_code в ответ модератору,
// поэтому в шаблоне достаточно проверки на наличие поля.
@Component({
  selector: 'app-orders-admin',
  standalone: true,
  imports: [InputComponent, ButtonComponent, DatePipe],
  template: `<h1>Заявки</h1>
    <div class="tabs">
      <button class="tab" [class.active]="kind() === 'orders'" (click)="setKind('orders')">Выпуски</button>
      <button class="tab" [class.active]="kind() === 'topups'" (click)="setKind('topups')">Пополнения</button>
    </div>

    <!-- Сегмент-фильтр типа продукта: Выпуски — [Карты | eSIM],
         Пополнения — [Карты | eSIM | Сервисы]. -->
    <div class="segments">
      @for (t of typeOptions(); track t.id) {
        <button class="seg" [class.active]="ptype() === t.id" (click)="setType(t.id)">{{ t.label }}</button>
      }
    </div>

    <div class="filters">
      <app-input [(value)]="q" placeholder="Поиск (id, заявка coincat, email, имя)" (enterPressed)="apply()" />
      <label class="select">
        <span>Статус</span>
        <select [value]="status()" (change)="status.set($any($event.target).value)">
          <option value="">все</option>
          @for (s of statusOptions(); track s) {
            <option [value]="s" [selected]="s === status()">{{ s }}</option>
          }
        </select>
      </label>
      <label class="select">
        <span>На странице</span>
        <select [value]="pageSize()" (change)="setPageSize($any($event.target).value)">
          <option [value]="10">10</option>
          <option [value]="25">25</option>
          <option [value]="50">50</option>
          <option [value]="100">100</option>
        </select>
      </label>
      <app-button variant="primary" (click)="apply()">Применить</app-button>
      <app-button variant="ghost" (click)="reset()">Сбросить</app-button>
    </div>

    <div class="meta">Найдено: {{ total() }}</div>

    @if (kind() === 'orders' && ptype() === 'card') {
      <table>
        <thead>
          <tr>
            <th>Создана</th><th>ID</th><th>Email / TG</th><th>Продукт</th>
            <th>Сумма</th><th>Промокод</th><th>Статус</th><th>Причина ошибки</th><th></th>
          </tr>
        </thead>
        <tbody>
          @for (o of orders(); track o.id) {
            <tr>
              <td><span class="dim">{{ o.created_at | date:'dd.MM.yy HH:mm' }}</span></td>
              <td>
                <code class="id">{{ o.id }}</code>
                <div class="sub">{{ remoteRef(o.provider, o.coincat_order_id) }}</div>
              </td>
              <td>
                @if (o.user_email) { {{ o.user_email }} }
                @else { <span class="dim">— нет —</span> }
                <div class="sub">{{ o.user_first_name }} {{ o.user_last_name }}</div>
              </td>
              <td>{{ o.product_name || o.card_product_id }}</td>
              <td>{{ o.amount_payment }} {{ o.payment_currency }}</td>
              <td>
                @if (o.promo_applied) {
                  −{{ money(o.discount_amount ?? 0, o.discount_currency) }}
                  @if (o.promo_code) { <div class="sub"><code>{{ o.promo_code }}</code></div> }
                } @else { <span class="dim">—</span> }
              </td>
              <td><span class="badge" [class]="'st-' + o.status">{{ o.status }}</span></td>
              <td>
                @if (o.failure_reason) { <span class="reason">{{ o.failure_reason }}</span> }
                @else { <span class="dim">—</span> }
              </td>
              <td>
                @if (o.status === 'failed' && o.paid_at) {
                  <app-button variant="primary" [loading]="retrying() === o.id" [disabled]="retrying() !== ''" (click)="retryCardOrder(o)">Повторить</app-button>
                }
              </td>
            </tr>
          } @empty {
            <tr><td colspan="9" class="empty">Заявок не найдено</td></tr>
          }
        </tbody>
      </table>
    } @else if (kind() === 'orders' && ptype() === 'esim') {
      <table>
        <thead>
          <tr>
            <th>Создана</th><th>ID</th><th>Email / TG</th><th>Тариф</th>
            <th>Провайдер</th><th>Сумма</th><th>Промокод</th><th>Статус</th><th>Причина</th><th></th>
          </tr>
        </thead>
        <tbody>
          @for (o of esimOrders(); track o.id) {
            <tr>
              <td><span class="dim">{{ o.created_at | date:'dd.MM.yy HH:mm' }}</span></td>
              <td>
                <code class="id">{{ o.id }}</code>
                <div class="sub">{{ remoteRef(o.provider, o.coincat_order_id) }}</div>
              </td>
              <td>
                @if (o.user_email) { {{ o.user_email }} }
                @else { <span class="dim">— нет —</span> }
                <div class="sub">{{ o.user_first_name }} {{ o.user_last_name }}</div>
                @if (o.email && o.email !== o.user_email) {
                  <div class="sub" title="Адрес доставки письма с QR">QR → {{ o.email }}</div>
                }
              </td>
              <td>{{ o.product_name || o.esim_product_id }}</td>
              <td>{{ o.issuer_provider || '—' }}</td>
              <td>
                {{ o.amount_payment }} {{ o.payment_currency }}
                <div class="sub">{{ money(o.amount_issue, o.issue_currency) }}</div>
              </td>
              <td>
                @if (o.promo_applied) {
                  −{{ money(o.discount_amount ?? 0, o.discount_currency) }}
                  @if (o.promo_code) { <div class="sub"><code>{{ o.promo_code }}</code></div> }
                } @else { <span class="dim">—</span> }
              </td>
              <td><span class="badge" [class]="'st-' + o.status">{{ o.status }}</span></td>
              <td>
                @if (o.failure_reason) { <span class="reason">{{ o.failure_reason }}</span> }
                @else { <span class="dim">—</span> }
              </td>
              <td>
                @if (o.status === 'failed' && o.paid_at) {
                  <app-button variant="primary" [loading]="retrying() === o.id" [disabled]="retrying() !== ''" (click)="retryEsim(o)">Повторить</app-button>
                }
              </td>
            </tr>
          } @empty {
            <tr><td colspan="10" class="empty">Заявок не найдено</td></tr>
          }
        </tbody>
      </table>
    } @else if (kind() === 'topups' && ptype() === 'card') {
      <table>
        <thead>
          <tr>
            <th>Создано</th><th>ID</th><th>Email / TG</th><th>Карта</th>
            <th>Зачисление</th><th>Оплата</th><th>Промокод</th><th>Статус</th><th>Причина ошибки</th><th></th>
          </tr>
        </thead>
        <tbody>
          @for (t of topups(); track t.id) {
            <tr>
              <td><span class="dim">{{ t.created_at | date:'dd.MM.yy HH:mm' }}</span></td>
              <td>
                <code class="id">{{ t.id }}</code>
                <div class="sub">{{ remoteRef(t.provider, t.coincat_order_id) }}</div>
              </td>
              <td>
                @if (t.user_email) { {{ t.user_email }} }
                @else { <span class="dim">— нет —</span> }
                <div class="sub">{{ t.user_first_name }} {{ t.user_last_name }}</div>
              </td>
              <td><code>•• {{ t.card_last4 || '----' }}</code></td>
              <td>{{ money(t.amount, t.currency) }}</td>
              <td>{{ t.amount_payment }} {{ t.payment_currency }}</td>
              <td>
                @if (t.promo_applied) {
                  −{{ money(t.discount_amount ?? 0, t.discount_currency) }}
                  @if (t.promo_code) { <div class="sub"><code>{{ t.promo_code }}</code></div> }
                } @else { <span class="dim">—</span> }
              </td>
              <td><span class="badge" [class]="'st-' + t.status">{{ t.status }}</span></td>
              <td>
                @if (t.failure_reason) { <span class="reason">{{ t.failure_reason }}</span> }
                @else { <span class="dim">—</span> }
              </td>
              <td>
                @if (t.status === 'failed' && t.paid_at) {
                  <app-button variant="primary" [loading]="retrying() === t.id" [disabled]="retrying() !== ''" (click)="retryCardTopup(t)">Повторить</app-button>
                }
              </td>
            </tr>
          } @empty {
            <tr><td colspan="10" class="empty">Пополнений не найдено</td></tr>
          }
        </tbody>
      </table>
    } @else if (kind() === 'topups' && ptype() === 'esim') {
      <table>
        <thead>
          <tr>
            <th>Создано</th><th>ID</th><th>Email / TG</th><th>eSIM</th><th>Тариф</th>
            <th>Провайдер</th><th>Сумма</th><th>Промокод</th><th>Статус</th><th>Причина</th>
          </tr>
        </thead>
        <tbody>
          @for (r of esimRecharges(); track r.id) {
            <tr>
              <td><span class="dim">{{ r.created_at | date:'dd.MM.yy HH:mm' }}</span></td>
              <td>
                <code class="id">{{ r.id }}</code>
                <div class="sub">{{ remoteRef(r.provider, r.coincat_order_id) }}</div>
              </td>
              <td>
                @if (r.user_email) { {{ r.user_email }} }
                @else { <span class="dim">— нет —</span> }
                <div class="sub">{{ r.user_first_name }} {{ r.user_last_name }}</div>
              </td>
              <td><code class="id">{{ r.esim_id }}</code></td>
              <td>{{ esimProductName(r.esim_product_id) }}</td>
              <td>{{ r.issuer_provider || '—' }}</td>
              <td>
                {{ r.amount_payment }} {{ r.payment_currency }}
                <div class="sub">{{ money(r.amount, r.currency) }}</div>
              </td>
              <td>
                @if (r.promo_applied) {
                  −{{ money(r.discount_amount ?? 0, r.discount_currency) }}
                  @if (r.promo_code) { <div class="sub"><code>{{ r.promo_code }}</code></div> }
                } @else { <span class="dim">—</span> }
              </td>
              <td><span class="badge" [class]="'st-' + r.status">{{ r.status }}</span></td>
              <td>
                @if (r.failure_reason) { <span class="reason">{{ r.failure_reason }}</span> }
                @else { <span class="dim">—</span> }
              </td>
            </tr>
          } @empty {
            <tr><td colspan="10" class="empty">Пополнений не найдено</td></tr>
          }
        </tbody>
      </table>
    } @else {
      <table>
        <thead>
          <tr>
            <th>Создано</th><th>ID</th><th>Email / TG</th><th>Продукт / Номинал | Логин</th>
            <th>Провайдер</th><th>Сумма / Зачисление</th><th>Промокод</th><th>Статус</th><th>Причина</th><th></th>
          </tr>
        </thead>
        <tbody>
          @for (s of serviceOrders(); track s.id) {
            <tr>
              <td><span class="dim">{{ s.created_at | date:'dd.MM.yy HH:mm' }}</span></td>
              <td>
                <code class="id">{{ s.id }}</code>
                <div class="sub">{{ remoteRef(s.provider, s.coincat_order_id) }}</div>
              </td>
              <td>
                @if (s.user_email) { {{ s.user_email }} }
                @else { <span class="dim">— нет —</span> }
                <div class="sub">{{ s.user_first_name }} {{ s.user_last_name }}</div>
              </td>
              <td>
                {{ s.product_name || s.service_product_id }}
                @if (s.kind === 'gift_card') {
                  <div class="sub">Номинал: {{ money(s.denom_value ?? 0, s.denom_currency) }}
                    @if (s.codes_issued) { · <span class="ok">код выдан</span> }
                  </div>
                } @else {
                  <div class="sub">Логин: {{ s.login || '—' }}</div>
                }
              </td>
              <td>
                {{ s.issuer_provider || '—' }}
                @if (s.provider_order_id) { <div class="sub">{{ s.provider_order_id }}</div> }
              </td>
              <td>
                {{ money(s.price, s.price_currency) }}
                @if (s.kind === 'account_topup') {
                  <div class="sub">зачисление {{ money(s.amount ?? 0, s.amount_currency) }}</div>
                }
              </td>
              <td>
                @if (s.promo_applied) {
                  −{{ money(s.discount_amount ?? 0, s.discount_currency) }}
                  @if (s.promo_code) { <div class="sub"><code>{{ s.promo_code }}</code></div> }
                } @else { <span class="dim">—</span> }
              </td>
              <td><span class="badge" [class]="'st-' + s.status">{{ s.status }}</span></td>
              <td>
                @if (s.failure_reason) { <span class="reason">{{ s.failure_reason }}</span> }
                @else { <span class="dim">—</span> }
              </td>
              <td>
                @if (s.status === 'failed' && s.paid_at) {
                  <app-button variant="primary" [loading]="retrying() === s.id" [disabled]="retrying() !== ''" (click)="retryService(s)">Повторить</app-button>
                }
              </td>
            </tr>
          } @empty {
            <tr><td colspan="10" class="empty">Заказов не найдено</td></tr>
          }
        </tbody>
      </table>
    }

    <div class="pager">
      <app-button variant="ghost" (click)="prev()" [disabled]="page() <= 1">‹ Назад</app-button>
      <span>Страница {{ page() }} из {{ totalPages() }}</span>
      <app-button variant="ghost" (click)="next()" [disabled]="page() >= totalPages()">Вперёд ›</app-button>
    </div>`,
  styles: [`
    .tabs { display: flex; gap: 8px; margin-bottom: var(--space-sm); }
    .tab {
      padding: 8px 16px; border: 1px solid var(--color-hairline);
      border-radius: var(--rounded-pill); background: var(--color-canvas);
      color: var(--color-muted); font: inherit; cursor: pointer;
    }
    .tab.active { background: var(--color-primary); color: var(--color-on-primary); border-color: var(--color-primary); }
    .segments { display: flex; gap: 4px; margin-bottom: var(--space-md); }
    .seg {
      padding: 6px 14px; border: 1px solid var(--color-hairline);
      border-radius: var(--rounded-pill); background: var(--color-canvas);
      color: var(--color-muted); font: inherit; font-size: 13px; cursor: pointer;
    }
    .seg.active {
      background: color-mix(in srgb, var(--color-primary) 14%, var(--color-canvas));
      border-color: var(--color-primary); color: var(--color-ink); font-weight: 500;
    }
    .filters { display: flex; flex-wrap: wrap; gap: 12px; align-items: end; margin-bottom: var(--space-md); }
    .filters app-input { min-width: 240px; }
    .select { display: flex; flex-direction: column; gap: 6px; font-size: 13px; color: var(--color-muted); }
    .select select {
      height: 44px; padding: 10px 14px;
      border: 1px solid var(--color-hairline);
      border-radius: var(--rounded-md);
      background: var(--color-canvas); color: var(--color-ink);
      font: inherit; min-width: 160px;
    }
    .select select:focus { outline: none; border-color: var(--color-primary); }
    .meta { color: var(--color-muted); font-size: 13px; margin-bottom: 8px; }
    table { width: 100%; border-collapse: collapse; }
    th, td { padding: 10px; text-align: left; border-bottom: 1px solid var(--color-hairline); font-size: 14px; vertical-align: top; }
    th { color: var(--color-muted); font-weight: 500; font-size: 12px; text-transform: uppercase; letter-spacing: 0.04em; }
    code { font-family: var(--font-mono, monospace); }
    code.id { font-size: 12px; }
    .dim { color: var(--color-muted); }
    .sub { color: var(--color-muted); font-size: 12px; }
    .ok { color: #047857; }
    .reason { color: #b91c1c; font-size: 13px; }
    .empty { text-align: center; color: var(--color-muted); padding: 24px; }
    .badge { display: inline-block; padding: 2px 8px; border-radius: var(--rounded-pill); font-size: 12px; background: var(--color-surface-card); }
    .badge.st-issued, .badge.st-topped_up, .badge.st-completed, .badge.st-done { background: rgba(16,185,129,0.15); color: #047857; }
    .badge.st-paid { background: rgba(59,130,246,0.15); color: #1d4ed8; }
    .badge.st-processing { background: rgba(59,130,246,0.15); color: #1d4ed8; }
    .badge.st-failed { background: rgba(239,68,68,0.15); color: #b91c1c; }
    .badge.st-refunded { background: rgba(168,85,247,0.15); color: #7e22ce; }
    .badge.st-pending_kyc { background: rgba(245,158,11,0.15); color: #b45309; }
    .badge.st-cancelled, .badge.st-expired { background: rgba(245,158,11,0.15); color: #b45309; }
    .pager { display: flex; align-items: center; gap: 12px; margin-top: var(--space-md); justify-content: center; }
  `],
})
export class OrdersAdminPage {
  private readonly api = inject(AdminApi);
  private readonly toast = inject(ToastService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);

  protected readonly kind = signal<Tab>('orders');
  protected readonly ptype = signal<PType>('card');
  protected readonly orders = signal<AdminOrder[]>([]);
  protected readonly esimOrders = signal<AdminEsimOrder[]>([]);
  protected readonly topups = signal<AdminTopup[]>([]);
  protected readonly esimRecharges = signal<AdminEsimRecharge[]>([]);
  protected readonly serviceOrders = signal<AdminServiceOrder[]>([]);
  protected readonly total = signal(0);
  protected readonly page = signal(1);
  protected readonly pageSize = signal(25);
  protected readonly status = signal('');
  protected readonly q = signal('');
  /** id заявки, по которой идёт retry ('' — никакой). */
  protected readonly retrying = signal('');

  /** id тарифа → имя (колонка «Тариф» у eSIM-recharge: в строке только id).
   *  /admin/esim/products admin-only — модератору 403, остаётся id. */
  private readonly esimProductNames = signal<Record<string, string>>({});
  private esimNamesRequested = false;

  /** Ключ состояния роута — детектор смены (сброс страницы/статуса). */
  private lastRouteKey = '';

  protected readonly typeOptions = computed<{ id: PType; label: string }[]>(() =>
    this.kind() === 'orders'
      ? [{ id: 'card', label: 'Карты' }, { id: 'esim', label: 'eSIM' }]
      : [{ id: 'card', label: 'Карты' }, { id: 'esim', label: 'eSIM' }, { id: 'service', label: 'Сервисы' }]);

  /** Статусы фильтра per (вкладка, тип). */
  protected readonly statusOptions = computed<string[]>(() => {
    const kind = this.kind();
    const t = this.ptype();
    if (kind === 'orders') {
      return t === 'esim'
        ? ['pending_payment', 'pending_kyc', 'paid', 'issued', 'failed', 'refunded', 'cancelled']
        : ['pending_payment', 'pending_kyc', 'paid', 'issued', 'failed', 'cancelled'];
    }
    if (t === 'esim') return ['pending_payment', 'pending_kyc', 'paid', 'done', 'failed', 'refunded', 'cancelled'];
    if (t === 'service') return ['pending_payment', 'pending_kyc', 'paid', 'processing', 'completed', 'failed', 'refunded', 'cancelled'];
    return ['pending_payment', 'pending_kyc', 'paid', 'topped_up', 'failed', 'cancelled'];
  });

  protected readonly totalPages = computed(() => {
    const t = this.total();
    const ps = this.pageSize();
    if (t === 0 || ps === 0) return 1;
    return Math.ceil(t / ps);
  });

  constructor() {
    // Единственный источник состояния вкладки/типа — queryParams: клики по
    // вкладкам только навигируют, а сюда прилетает результат (в т.ч. F5,
    // deep-link и кнопка «Назад» браузера).
    this.route.queryParamMap
      .pipe(takeUntilDestroyed())
      .subscribe((pm) => {
        const tab: Tab = pm.get('tab') === 'topups' ? 'topups' : 'orders';
        const rawType = pm.get('type') ?? 'card';
        const allowed: string[] = tab === 'orders' ? ['card', 'esim'] : ['card', 'esim', 'service'];
        const type = (allowed.includes(rawType) ? rawType : 'card') as PType;
        const key = `${tab}:${type}`;
        if (key !== this.lastRouteKey) {
          // Смена раздела: страница и статус-фильтр от старого типа невалидны.
          this.lastRouteKey = key;
          this.kind.set(tab);
          this.ptype.set(type);
          this.page.set(1);
          this.status.set('');
        }
        if (type === 'esim') this.ensureEsimNames();
        this.refresh();
      });
  }

  /** Человекочитаемое имя провайдера оплаты по его коду. */
  providerLabel(provider: string): string {
    switch (provider) {
      case 'cc': return 'coincat';
      case 'kassaai': return 'Kassa.ai (СБП)';
      case 'platega': return 'Platega (СБП)';
      case 'enot': return 'Enot (СБП)';
      case 'free': return 'бесплатно';
      default: return provider;
    }
  }

  /**
   * Подпись под ID заявки: «<номер заявки провайдера> · <провайдер>».
   * Номер remote-заявки есть только у оплаченных через провайдера заявок
   * (для cc — номер заявки coincat); если его ещё нет — показываем один
   * провайдер.
   */
  remoteRef(provider: string, remoteId?: string | null): string {
    const p = this.providerLabel(provider);
    return remoteId ? `${remoteId} · ${p}` : p;
  }

  protected esimProductName(id: string): string {
    return this.esimProductNames()[id] || id;
  }

  // Имена eSIM-тарифов для колонки «Тариф» recharge-строк. Ошибка (403 у
  // модератора / старый бэк) не мешает работе — останутся id.
  private ensureEsimNames(): void {
    if (this.esimNamesRequested) return;
    this.esimNamesRequested = true;
    this.api.listEsimProducts().subscribe({
      next: (r) => {
        const map: Record<string, string> = {};
        for (const p of r.products ?? []) {
          if (p.id) map[p.id] = p.name;
        }
        this.esimProductNames.set(map);
      },
      error: () => undefined,
    });
  }

  refresh(): void {
    const query = {
      page: this.page(),
      page_size: this.pageSize(),
      status: this.status() || undefined,
      q: this.q().trim() || undefined,
    };
    const fail = (what: string) => (e: unknown) => this.toast.error(errorMessage(e, `Не удалось загрузить ${what}`));
    if (this.kind() === 'orders') {
      if (this.ptype() === 'esim') {
        this.api.listEsimOrders(query).subscribe({
          next: (r) => { this.esimOrders.set(r.items ?? []); this.total.set(r.total ?? 0); },
          error: fail('заявки'),
        });
      } else {
        this.api.listOrders(query).subscribe({
          next: (r) => { this.orders.set(r.items ?? []); this.total.set(r.total ?? 0); },
          error: fail('заявки'),
        });
      }
      return;
    }
    switch (this.ptype()) {
      case 'esim':
        this.api.listEsimRecharges(query).subscribe({
          next: (r) => { this.esimRecharges.set(r.items ?? []); this.total.set(r.total ?? 0); },
          error: fail('пополнения'),
        });
        break;
      case 'service':
        this.api.listServiceOrders(query).subscribe({
          next: (r) => { this.serviceOrders.set(r.items ?? []); this.total.set(r.total ?? 0); },
          error: fail('заказы'),
        });
        break;
      default:
        this.api.listTopups(query).subscribe({
          next: (r) => { this.topups.set(r.items ?? []); this.total.set(r.total ?? 0); },
          error: fail('пополнения'),
        });
    }
  }

  setKind(k: Tab): void {
    if (this.kind() === k) return;
    this.navigate(k, 'card');
  }

  setType(t: PType): void {
    if (this.ptype() === t) return;
    this.navigate(this.kind(), t);
  }

  private navigate(tab: Tab, type: PType): void {
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { tab, type },
    });
  }

  // ----- Retry per-type -----

  private runRetry(id: string, obs: { subscribe: (o: { next: () => void; error: (e: unknown) => void }) => unknown }, okMsg: string, failMsg: string): void {
    if (this.retrying()) return;
    this.retrying.set(id);
    obs.subscribe({
      next: () => {
        this.retrying.set('');
        this.toast.success(okMsg);
        this.refresh();
      },
      error: (e: unknown) => {
        this.retrying.set('');
        this.toast.error(errorMessage(e, failMsg));
      },
    });
  }

  retryCardOrder(o: AdminOrder): void {
    this.runRetry(o.id, this.api.retryOrder(o.id), 'Выпуск перезапущен', 'Не удалось повторить выпуск');
  }
  retryEsim(o: AdminEsimOrder): void {
    this.runRetry(o.id, this.api.retryEsimOrder(o.id), 'Выпуск eSIM перезапущен', 'Не удалось повторить выпуск');
  }
  retryCardTopup(t: AdminTopup): void {
    this.runRetry(t.id, this.api.retryTopup(t.id), 'Зачисление перезапущено', 'Не удалось повторить зачисление');
  }
  retryService(s: AdminServiceOrder): void {
    this.runRetry(s.id, this.api.retryServiceOrder(s.id), 'Заказ перезапущен', 'Не удалось повторить заказ');
  }

  apply(): void {
    this.page.set(1);
    this.refresh();
  }

  reset(): void {
    this.q.set('');
    this.status.set('');
    this.pageSize.set(25);
    this.page.set(1);
    this.refresh();
  }

  setPageSize(v: string): void {
    const n = parseInt(v, 10);
    if (!isNaN(n) && n > 0) {
      this.pageSize.set(n);
      this.page.set(1);
      this.refresh();
    }
  }

  prev(): void {
    if (this.page() > 1) {
      this.page.set(this.page() - 1);
      this.refresh();
    }
  }

  next(): void {
    if (this.page() < this.totalPages()) {
      this.page.set(this.page() + 1);
      this.refresh();
    }
  }

  protected money(v: number | string | null | undefined, c: string | null | undefined): string {
    return formatAmount(v, c);
  }
}
