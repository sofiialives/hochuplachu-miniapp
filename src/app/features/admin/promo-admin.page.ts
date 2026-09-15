import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { AdminApi, AdminUserBrief, PRODUCT_TYPE_LABELS, PartnerConfig, ProductBrief, PromoCode } from '../../core/api/admin.api';
import { ButtonComponent } from '../../ui/button.component';
import { InputComponent } from '../../ui/input.component';
import { DialogComponent } from '../../ui/dialog.component';
import { SearchableSelectComponent, SearchableSelectItem } from '../../ui/searchable-select.component';
import { ToggleComponent } from '../../ui/toggle.component';
import { ToastService } from '../../core/notifications/toast.service';
import { errorMessage } from '../../core/errors/api-error';

// Промокоды: две вкладки — «Ручные» (создаются здесь) и «Автоматические»
// (генерируются шагами retention-планов; видно, для кого сгенерирован код).
// У кода может быть ограничение по карт-продуктам (пусто = все продукты).
/** Сколько строк рисует окно выбора продуктов: тысяча галочек в DOM подвешивает
 *  диалог, а искать в такой простыне всё равно нельзя — на то и регулярка. */
const PICKER_ROWS_LIMIT = 200;

/** Сколько имён продуктов перечисляет колонка «Продукты» в таблице кодов. */
const SUMMARY_NAMES = 3;

/** Валюта скидки в новом коде. */
const PROMO_DEFAULT_CURRENCY = 'RUB';

/** Алфавит и длина генератора кода (см. generateCode). */
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const CODE_LENGTH = 8;

@Component({
  selector: 'app-promo-admin',
  standalone: true,
  imports: [ButtonComponent, InputComponent, DialogComponent, SearchableSelectComponent, ToggleComponent],
  template: `<h1>Промокоды</h1>
    <div class="tabs">
      <button class="tab" [class.active]="origin() === 'manual'" (click)="setOrigin('manual')">Ручные</button>
      <button class="tab" [class.active]="origin() === 'auto'" (click)="setOrigin('auto')">Автоматические</button>
    </div>

    <div class="toolbar">
      @if (origin() === 'manual') {
        <app-button variant="primary" (clicked)="open()">+ Новый промокод</app-button>
      } @else {
        <p class="hint">Коды, сгенерированные шагами ретеншен-планов персонально для пользователей.</p>
      }
      <label class="select">
        <span>На странице</span>
        <select [value]="pageSize()" (change)="setPageSize($any($event.target).value)">
          <option [value]="10">10</option>
          <option [value]="25">25</option>
          <option [value]="50">50</option>
          <option [value]="100">100</option>
        </select>
      </label>
    </div>

    <div class="meta">Найдено: {{ total() }}</div>

    <table>
      <thead><tr>
        <th>Code</th><th>Discount</th><th>Cur</th><th>Scope</th><th>Тип</th><th>Продукты</th><th>Used / Max</th>
        @if (origin() === 'auto') { <th>Для кого</th> } @else { <th>Партнёр</th> }
        <th>Active</th><th></th>
      </tr></thead>
      <tbody>
        @for (p of items(); track p.id) {
          <tr>
            <td><code>{{ p.code }}</code></td>
            <td>{{ discountLabel(p) }}</td>
            <td>{{ p.discount_currency }}</td>
            <td>{{ p.scope }}</td>
            <td>{{ typeLabel(p) }}</td>
            <td>{{ productsSummary(p) }}</td>
            <td>{{ p.usage_count }} / {{ p.max_usages || '∞' }}</td>
            @if (origin() === 'auto') {
              <td>{{ generatedFor(p) }}</td>
            } @else {
              <!-- Реф-привязка: партнёр-получатель приглашённых по коду. -->
              <td>{{ referralFor(p) }}</td>
            }
            <td>{{ p.active ? 'Да' : 'Нет' }}</td>
            <td>
              <button class="link" (click)="edit(p)">edit</button>
              <button class="link red" (click)="remove(p)">delete</button>
            </td>
          </tr>
        } @empty {
          <tr><td colspan="10" class="empty">Промокодов нет</td></tr>
        }
      </tbody>
    </table>

    <div class="pager">
      <app-button variant="ghost" (clicked)="prev()" [disabled]="page() <= 1">‹ Назад</app-button>
      <span>Страница {{ page() }} из {{ totalPages() }}</span>
      <app-button variant="ghost" (clicked)="next()" [disabled]="page() >= totalPages()">Вперёд ›</app-button>
    </div>

    @if (current(); as c) {
      <app-dialog [title]="c.id ? 'Изменить промокод' : 'Новый промокод'" (dismissed)="current.set(null)"
        (keydown.enter)="onEnterKey($event)">
        <app-input [(value)]="codeC" label="Code" />
        <button type="button" class="clear" (click)="generateCode()">Сгенерировать 8 символов</button>
        <label class="scope-field">
          <span>Тип скидки</span>
          <select [value]="discountTypeC()" (change)="discountTypeC.set($any($event.target).value)">
            <option value="amount">Сумма — в валюте кода</option>
            <option value="percent">Процент от цены</option>
          </select>
        </label>
        <app-input [(value)]="amountC" inputmode="decimal"
          [label]="discountTypeC() === 'percent' ? 'Скидка, % от цены (до 100; при применении округляется до целых)' : 'Discount amount'" />
        <app-input [(value)]="curC" label="Discount currency" />
        <label class="scope-field">
          <span>Scope</span>
          <select [value]="scopeC()" (change)="scopeC.set($any($event.target).value)">
            <option value="issue">issue — выпуск / покупка</option>
            <option value="topup">topup — пополнение / продление</option>
            <option value="any">any — любая операция</option>
          </select>
        </label>
        <label class="scope-field">
          <span>Тип продукта{{ c.id ? ' (задаётся при создании, PATCH не меняет)' : '' }}</span>
          <!-- product_type принимается ТОЛЬКО при создании: PATCH-whitelist
               бэка это поле игнорирует — при правке селект заблокирован. -->
          <select [value]="productTypeC()" [disabled]="!!c.id" (change)="setProductType($any($event.target).value)">
            <option value="card" [selected]="productTypeC() === 'card'">card — карты</option>
            <option value="esim" [selected]="productTypeC() === 'esim'">esim — eSIM</option>
            <option value="service" [selected]="productTypeC() === 'service'">service — сервисы</option>
            <option value="any" [selected]="productTypeC() === 'any'">any — все типы</option>
          </select>
        </label>
        @if (productTypeC() !== 'any') {
          <!-- Показываем ТОЛЬКО выбранное: у eSIM и сервисов продуктов тысячи,
               и список галочек на всю выборку в форму не влезает. Набор
               набирается в отдельном окне по регулярке (ниже). -->
          <div class="products-field">
            <span>Для каких продуктов (пусто = все продукты типа)</span>
            @for (prod of selectedProducts(); track prod.id) {
              <label class="check">
                <input type="checkbox" checked (change)="toggleProduct(prod.id)" />
                {{ prod.name }}
              </label>
            } @empty {
              <span class="hint">Ничего не выбрано — код действует на все продукты типа</span>
            }
            <button type="button" class="clear" (click)="openPicker()">Выбрать продукты</button>
          </div>
        } @else {
          <p class="hint">Тип «any»: код действует на все продукты всех типов — ограничение по продуктам недоступно.</p>
        }
        <app-input [(value)]="maxC" inputmode="numeric" label="Max usages (0 = unlimited)" />
        <app-input [(value)]="minAmountC" inputmode="decimal" label="Действует от суммы (0 = любая), в валюте кода" />
        <label class="date-field">
          <span>Срок действия</span>
          <input type="datetime-local" [value]="expC()" (input)="expC.set($any($event.target).value)" />
          @if (expC()) {
            <button type="button" class="clear" (click)="expC.set('')">Бессрочный</button>
          }
        </label>
        <div class="ref-field">
          <app-toggle [checked]="refEnabledC()" (toggled)="setRefEnabled($event)" label="Привязать к реферальной системе" />
          @if (refEnabledC()) {
            <span class="hint">Применение кода привяжет юзера без пригласившего к партнёру (как заход
              по реф-ссылке); премия партнёру — с каждой оплаченной карты, по ставке его конфига.</span>
            <app-searchable-select
              [items]="refPartners()"
              [value]="refUserIdC()"
              [serverMode]="true"
              [loading]="refLoading()"
              [selectedLabel]="refSelectedLabel()"
              placeholder="— выберите партнёра —"
              searchPlaceholder="Email, имя, реф-код, комментарий…"
              (queryChanged)="searchRefPartners($event)"
              (valueChange)="pickRefPartner($event)" />
          }
        </div>
        <label><input type="checkbox" [checked]="activeC()" (change)="activeC.set($any($event.target).checked)" /> Активно</label>
        <app-button variant="primary" [full]="true" (clicked)="save()">Сохранить</app-button>
      </app-dialog>
    }

    @if (pickerOpen()) {
      <app-dialog title="Выбор продуктов" [wide]="true" (dismissed)="pickerOpen.set(false)">
        <p class="hint">
          Фильтр по названию, регистр не важен. <b>Пустое поле — все продукты типа.</b>
          Примеры: <code>^Turkey</code> — начинается с «Turkey», <code>Xbox|PlayStation</code> —
          любое из двух.
        </p>
        <app-input [(value)]="pickerPattern" label="Регулярное выражение" placeholder="пусто — все продукты" />
        @if (pickerError()) {
          <p class="warn">Регулярка не разбирается: {{ pickerError() }}</p>
        } @else {
          <p class="found">
            Найдено <b>{{ pickerMatched() }}</b>, выбрано <b>{{ productIdsC().length }}</b>
            @if (pickerMatched() > pickerRows().length) {
              <span class="warn-inline"> — показаны первые {{ pickerRows().length }}, уточните регулярку</span>
            }
          </p>
        }
        @if (!pickerError()) {
          <div class="picker-list">
            @for (prod of pickerRows(); track prod.id) {
              <label class="check">
                <input type="checkbox" [checked]="productSelected(prod.id)" (change)="toggleProduct(prod.id)" />
                {{ prod.name }}
              </label>
            } @empty {
              <span class="hint">Ничего не нашлось</span>
            }
          </div>
        }
        <app-button variant="primary" [full]="true" (clicked)="pickerOpen.set(false)">Готово</app-button>
      </app-dialog>
    }`,
  styles: [`
    .tabs { display: flex; gap: 4px; border-bottom: 1px solid var(--color-hairline); margin-bottom: var(--space-md); }
    .tab {
      padding: 10px 16px; color: var(--color-muted); background: none; border: none; cursor: pointer;
      border-bottom: 2px solid transparent; font: inherit; font-weight: 500; font-size: 14px; margin-bottom: -1px;
    }
    .tab.active { color: var(--color-ink); border-bottom-color: var(--color-primary-ink); }
    .toolbar { display: flex; flex-wrap: wrap; gap: 12px; align-items: end; margin: var(--space-sm) 0 var(--space-md); }
    .hint { font-size: 13px; color: var(--color-muted); margin: 0; align-self: center; }
    .select { display: flex; flex-direction: column; gap: 6px; font-size: 13px; color: var(--color-muted); margin-left: auto; }
    .select select {
      height: 44px; padding: 10px 14px;
      border: 1px solid var(--color-hairline);
      border-radius: var(--rounded-md);
      background: var(--color-canvas); color: var(--color-ink);
      font: inherit; min-width: 120px;
    }
    .select select:focus { outline: none; border-color: var(--color-primary); }
    .meta { color: var(--color-muted); font-size: 13px; margin-bottom: 8px; }
    .empty { text-align: center; color: var(--color-muted); padding: 24px; }
    .pager { display: flex; align-items: center; gap: 12px; margin-top: var(--space-md); justify-content: center; }
    table { width: 100%; border-collapse: collapse; margin-top: var(--space-md); }
    th, td { padding: 10px; text-align: left; border-bottom: 1px solid var(--color-hairline); }
    .link { color: var(--color-primary-ink); margin-right: 8px; background: none; border: none; cursor: pointer; padding: 0; font: inherit; }
    .link.red { color: var(--color-error); }
    .date-field { display: flex; flex-direction: column; gap: 6px; margin: var(--space-sm) 0; font-size: 13px; color: var(--color-muted); }
    .date-field input[type="datetime-local"] {
      padding: 10px 12px;
      border: 1px solid var(--color-hairline);
      border-radius: var(--rounded-md);
      background: var(--color-canvas);
      color: var(--color-ink);
      font: inherit;
    }
    .date-field input[type="datetime-local"]:focus { outline: none; border-color: var(--color-primary); }
    .scope-field { display: flex; flex-direction: column; gap: 6px; margin: var(--space-sm) 0; font-size: 13px; color: var(--color-muted); }
    .scope-field select {
      padding: 10px 12px;
      border: 1px solid var(--color-hairline);
      border-radius: var(--rounded-md);
      background: var(--color-canvas);
      color: var(--color-ink);
      font: inherit;
    }
    .scope-field select:focus { outline: none; border-color: var(--color-primary); }
    .products-field { display: flex; flex-direction: column; gap: 6px; margin: var(--space-sm) 0; font-size: 13px; color: var(--color-muted); }
    .ref-field { display: flex; flex-direction: column; gap: 8px; margin: var(--space-sm) 0; font-size: 13px; color: var(--color-muted); }
    .check { display: flex; gap: 8px; align-items: center; font-size: 14px; color: var(--color-ink); }
    .clear { align-self: flex-start; padding: 2px 0; color: var(--color-primary-ink); font-size: 12px; background: none; border: none; cursor: pointer; }
    .picker-list { display: flex; flex-direction: column; gap: 6px; max-height: 46vh; overflow: auto; margin: var(--space-sm) 0; }
    .found { font-size: 13px; color: var(--color-muted); margin: 8px 0; }
    .warn { font-size: 13px; color: var(--color-error); margin: 8px 0; }
    .warn-inline { color: var(--color-error); }
    code { background: var(--color-surface-card); padding: 1px 5px; border-radius: 4px; }
  `],
})
export class PromoAdminPage implements OnInit {
  private readonly api = inject(AdminApi);
  private readonly toast = inject(ToastService);
  protected readonly items = signal<PromoCode[]>([]);
  protected readonly users = signal<Record<string, AdminUserBrief>>({});
  /** Краткие списки продуктов per тип (GET /admin/products/brief) — для
   *  мультиселекта формы и резолва имён в колонке «Продукты». */
  protected readonly briefs = signal<Record<string, ProductBrief[]>>({});
  protected readonly current = signal<Partial<PromoCode> | null>(null);

  /** Тип продукта в форме (any | card | esim | service). */
  protected readonly productTypeC = signal('card');

  /** Продукты выбранного в форме типа (для 'any' мультиселект скрыт). */
  protected readonly formProducts = computed<ProductBrief[]>(() =>
    this.briefs()[this.productTypeC()] ?? []);

  /** Активная вкладка: manual | auto. */
  protected readonly origin = signal<'manual' | 'auto'>('manual');

  // Пагинация — единый стиль с cards/orders/transactions (page/page_size).
  protected readonly total = signal(0);
  protected readonly page = signal(1);
  protected readonly pageSize = signal(25);
  // totalPages — округление вверх; защита от деления на 0 (пустая выборка =
  // страница 1, иначе кнопки пейджера залипнут в disabled).
  protected readonly totalPages = computed(() => {
    const t = this.total();
    const ps = this.pageSize();
    if (t === 0 || ps === 0) return 1;
    return Math.ceil(t / ps);
  });

  protected readonly codeC = signal('');
  protected readonly amountC = signal('');
  /** Тип скидки в форме: amount — абсолютная, percent — процент от цены
   *  (размер скидки бэк округляет до целых при применении). */
  protected readonly discountTypeC = signal<'amount' | 'percent'>('amount');
  // Валюта скидки по умолчанию — RUB: прайс продуктов рублёвый (динамика
  // принудительно ставит RUB), и код в USDT к рублёвой цене не применится.
  protected readonly curC = signal(PROMO_DEFAULT_CURRENCY);
  protected readonly scopeC = signal('issue');
  protected readonly maxC = signal('0');
  protected readonly minAmountC = signal('0');
  protected readonly expC = signal('');
  protected readonly activeC = signal(true);
  protected readonly productIdsC = signal<string[]>([]);

  // ----- Реф-привязка кода (тумблер + пикер партнёра) -----
  // Пикер — общий app-searchable-select в serverMode поверх listPartners:
  // получателем может быть только назначенный партнёр (гейт и на бэке).
  protected readonly refEnabledC = signal(false);
  protected readonly refUserIdC = signal('');
  /** Подпись выбранного партнёра — серверная выдача пикера могла сузиться. */
  protected readonly refSelectedLabel = signal('');
  protected readonly refPartners = signal<SearchableSelectItem[]>([]);
  protected readonly refLoading = signal(false);
  /** Последний запрос пикера — ответы отставших запросов отбрасываются. */
  private refQuery = '';

  // ----- Окно выбора продуктов -----
  // Список галочек на всю выборку в форме не работает: eSIM-тарифов и
  // сервис-продуктов тысячи. В форме остаётся только ВЫБРАННОЕ, а набор
  // набирается здесь — регулярка та же по смыслу, что в массовых операциях.
  protected readonly pickerOpen = signal(false);
  protected readonly pickerPattern = signal('');
  /** Разобранная регулярка; null = пустое поле (совпадает всё). */
  private readonly pickerRe = computed<{ re: RegExp | null; err: string }>(() => {
    const raw = this.pickerPattern().trim();
    if (!raw) return { re: null, err: '' };
    try {
      return { re: new RegExp(raw, 'i'), err: '' };
    } catch (e) {
      return { re: null, err: e instanceof Error ? e.message : String(e) };
    }
  });
  protected readonly pickerError = computed(() => this.pickerRe().err);
  /** Совпавшие продукты текущего типа (без потолка — для счётчика). */
  private readonly pickerMatches = computed<ProductBrief[]>(() => {
    if (this.pickerError()) return [];
    const { re } = this.pickerRe();
    const all = this.formProducts();
    return re ? all.filter((p) => re.test(p.name)) : all;
  });
  protected readonly pickerMatched = computed(() => this.pickerMatches().length);
  /** Рисуем не больше потолка: тысяча галочек в DOM подвешивает диалог. */
  protected readonly pickerRows = computed(() => this.pickerMatches().slice(0, PICKER_ROWS_LIMIT));
  /** Выбранное — в порядке выбора; продукт, удалённый из каталога, остаётся
   *  строкой с его id, иначе снять галочку было бы нечем. */
  protected readonly selectedProducts = computed<ProductBrief[]>(() => {
    const all = this.formProducts();
    return this.productIdsC().map((id) => all.find((p) => p.id === id) ?? { id, name: id });
  });

  // generateCode — случайный код в поле. Алфавит БЕЗ 0/O/I/1 (как у
  // референс-кодов): код диктуют голосом и перебивают с картинки, и «0 или O»
  // стоит дороже, чем два лишних символа алфавита. Длина 32 — делитель 256,
  // поэтому байты раскладываются по алфавиту без перекоса.
  protected generateCode(): void {
    const bytes = new Uint8Array(CODE_LENGTH);
    crypto.getRandomValues(bytes);
    this.codeC.set(Array.from(bytes, (b) => CODE_ALPHABET[b % CODE_ALPHABET.length]).join(''));
  }

  protected openPicker(): void {
    this.pickerPattern.set('');
    this.pickerOpen.set(true);
  }

  ngOnInit(): void {
    // Краткие списки всех трёх типов: мультиселект формы + резолв имён в
    // колонке «Продукты» (коды могут ссылаться на продукты любого типа).
    for (const pt of ['card', 'esim', 'service']) this.loadBrief(pt);
    this.refresh();
  }

  private loadBrief(pt: string): void {
    this.api.productsBrief(pt).subscribe({
      next: (r) => this.briefs.update((m) => ({ ...m, [pt]: r.items ?? [] })),
      error: () => undefined,
    });
  }

  /** Смена типа в форме сбрасывает выбор продуктов — id чужого типа невалидны. */
  protected setProductType(pt: string): void {
    if (pt === this.productTypeC()) return;
    this.productTypeC.set(pt);
    this.productIdsC.set([]);
  }

  /** Колонка «Discount»: процентный код — «N%», абсолютный — число как было;
   *  порог min_amount дописывается в скобках у обоих. */
  protected discountLabel(p: PromoCode): string {
    const value = p.discount_type === 'percent' ? `${p.discount_amount}%` : String(p.discount_amount);
    return value + (p.min_amount ? ` (от ${p.min_amount})` : '');
  }

  /** Подпись типа в таблице (пусто у легаси-строк = card на бэке). */
  protected typeLabel(p: PromoCode): string {
    const pt = p.product_type || 'card';
    return PRODUCT_TYPE_LABELS[pt] ?? pt;
  }

  refresh(): void {
    this.api.listPromo({ page: this.page(), page_size: this.pageSize(), origin: this.origin() }).subscribe({
      next: (r) => {
        this.total.set(r.total ?? 0);
        // Удаление последней строки на странице > 1 оставило бы пустую
        // страницу — отступаем назад, пока не окажемся на странице с данными
        // (или на первой). Терминируется: page строго убывает до 1.
        if ((r.items ?? []).length === 0 && this.page() > 1) {
          this.page.set(this.page() - 1);
          this.refresh();
          return;
        }
        this.items.set(r.items ?? []);
        this.users.set(r.users ?? {});
      },
      error: (e) => this.toast.error(errorMessage(e, 'Не удалось загрузить промокоды')),
    });
  }

  setOrigin(origin: 'manual' | 'auto'): void {
    if (this.origin() === origin) return;
    this.origin.set(origin);
    this.page.set(1);
    this.refresh();
  }

  productsSummary(p: PromoCode): string {
    const ids = p.product_ids ?? [];
    if (!ids.length) return 'все';
    const all = Object.values(this.briefs()).flat();
    const names = ids.map((id) => all.find((prod) => prod.id === id)?.name ?? '…');
    // Набор бывает большим (окно выбора отмечает продукты десятками) —
    // перечисляем несколько, остальное числом: иначе ячейка растягивает таблицу.
    if (names.length <= SUMMARY_NAMES) return names.join(', ');
    return `${names.slice(0, SUMMARY_NAMES).join(', ')} и ещё ${names.length - SUMMARY_NAMES}`;
  }

  generatedFor(p: PromoCode): string {
    return p.generated_for_user_id ? this.userLabel(p.generated_for_user_id) : '—';
  }

  /** Колонка «Партнёр»: получатель реф-привязки кода. */
  protected referralFor(p: PromoCode): string {
    return p.referral_user_id ? this.userLabel(p.referral_user_id) : '—';
  }

  /** Подпись юзера из карты users ответа (email → имя → username → tg → id). */
  private userLabel(id: string): string {
    const u = this.users()[id];
    if (!u) return id;
    const name = [u.first_name, u.last_name].filter(Boolean).join(' ');
    return u.email || name || u.username || (u.telegram_id ? `tg:${u.telegram_id}` : id);
  }

  protected setRefEnabled(v: boolean): void {
    this.refEnabledC.set(v);
    if (!v) {
      this.refUserIdC.set('');
      this.refSelectedLabel.set('');
    }
  }

  /** Живой поиск партнёров для пикера (debounce уже внутри app-searchable-select). */
  protected searchRefPartners(q: string): void {
    this.refQuery = q;
    this.refLoading.set(true);
    this.api.listPartners({ q, page: 1, page_size: 20 }).subscribe({
      next: (r) => {
        if (this.refQuery !== q) return; // отставший ответ более раннего запроса
        this.refLoading.set(false);
        this.refPartners.set((r.items ?? []).map((p) => ({ id: p.user_id, label: this.partnerLabel(p) })));
      },
      error: () => {
        if (this.refQuery === q) this.refLoading.set(false);
      },
    });
  }

  protected pickRefPartner(userId: string): void {
    this.refUserIdC.set(userId);
    const item = this.refPartners().find((i) => i.id === userId);
    if (item) this.refSelectedLabel.set(item.label);
  }

  /** Подпись партнёра в пикере: кто это + комментарий конфига (если есть). */
  private partnerLabel(p: PartnerConfig): string {
    const name = [p.user_first_name, p.user_last_name].filter(Boolean).join(' ');
    const who = p.user_email || name || p.user_username || (p.telegram_id ? `tg:${p.telegram_id}` : p.user_id);
    return p.comment ? `${who} — ${p.comment}` : who;
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
  open(): void {
    this.current.set({});
    this.codeC.set(''); this.amountC.set(''); this.discountTypeC.set('amount'); this.curC.set(PROMO_DEFAULT_CURRENCY);
    this.scopeC.set('issue'); this.maxC.set('0'); this.minAmountC.set('0');
    this.expC.set(''); this.activeC.set(true);
    this.productTypeC.set('card');
    this.productIdsC.set([]);
    this.refEnabledC.set(false); this.refUserIdC.set(''); this.refSelectedLabel.set('');
  }
  edit(p: PromoCode): void {
    this.current.set(p);
    this.codeC.set(p.code); this.amountC.set(String(p.discount_amount)); this.curC.set(p.discount_currency);
    // Пустой тип у легаси-строк = amount (бэк трактует так же).
    this.discountTypeC.set(p.discount_type === 'percent' ? 'percent' : 'amount');
    this.scopeC.set(p.scope); this.maxC.set(String(p.max_usages));
    this.minAmountC.set(String(p.min_amount ?? 0));
    this.expC.set(this.isoToLocal(p.expires_at));
    this.activeC.set(p.active);
    // Пустой тип у легаси-строк = card (бэкфилл бэка).
    this.productTypeC.set(p.product_type || 'card');
    this.productIdsC.set([...(p.product_ids ?? [])]);
    // Реф-привязка: подпись выбранного — из карты users ответа списка (пикер
    // подгрузит свою выдачу только при открытии).
    this.refEnabledC.set(!!p.referral_user_id);
    this.refUserIdC.set(p.referral_user_id ?? '');
    this.refSelectedLabel.set(p.referral_user_id ? this.userLabel(p.referral_user_id) : '');
  }
  remove(p: PromoCode): void {
    if (!confirm('Удалить промокод?')) return;
    this.api.deletePromo(p.id!).subscribe({
      next: () => { this.toast.success('Удалено'); this.refresh(); },
      error: (e) => this.toast.error(errorMessage(e, 'Не удалось удалить')),
    });
  }
  protected productSelected(id: string): boolean { return this.productIdsC().includes(id); }
  protected toggleProduct(id: string): void {
    this.productIdsC.update((ids) => ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]);
  }
  // isoToLocal — бэк отдаёт ISO с timezone (2026-12-31T23:59:59Z), а нативный
  // datetime-local хочет «настенное» время без зоны (2026-12-31T23:59).
  // Конвертим через Date, чтобы пользователь увидел свой локальный TZ.
  private isoToLocal(iso?: string | null): string {
    if (!iso) return '';
    const d = new Date(iso);
    if (isNaN(d.getTime())) return '';
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }
  // localToISO — local время из инпута → ISO UTC для бэка. Пустое поле =
  // бессрочный промо (undefined, не пустая строка — бэк ждёт null).
  private localToISO(local: string): string | undefined {
    if (!local) return undefined;
    const d = new Date(local);
    if (isNaN(d.getTime())) return undefined;
    return d.toISOString();
  }
  // Enter в диалоге сохраняет форму — но не внутри textarea, где Enter должен
  // вставлять перевод строки. Важно возвращать void, а не false: Angular на
  // возврат false из обработчика зовёт preventDefault() (съел бы перевод
  // строки, если в форму добавят многострочное поле).
  protected onEnterKey(event: Event): void {
    if ((event.target as HTMLElement).tagName === 'TEXTAREA') return;
    this.save();
  }

  save(): void {
    if (this.refEnabledC() && !this.refUserIdC()) {
      this.toast.error('Выберите партнёра-получателя реф-привязки');
      return;
    }
    const amount = parseFloat(this.amountC());
    // Зеркало гейта бэка (PROMO_BAD_DISCOUNT): процент строго в (0, 100].
    if (this.discountTypeC() === 'percent' && !(amount > 0 && amount <= 100)) {
      this.toast.error('Процентная скидка — число от 0 до 100');
      return;
    }
    const body: Partial<PromoCode> = {
      code: this.codeC().toUpperCase(),
      discount_amount: amount,
      discount_type: this.discountTypeC(),
      discount_currency: this.curC(),
      scope: this.scopeC(),
      max_usages: parseInt(this.maxC(), 10) || 0,
      min_amount: parseFloat(this.minAmountC()) || 0,
      expires_at: this.localToISO(this.expC()),
      active: this.activeC(),
      // Для 'any' ограничение по продуктам не имеет смысла — не отправляем.
      product_ids: this.productTypeC() === 'any' ? [] : this.productIdsC(),
      // Пустая строка = без привязки (в PATCH снимает существующую).
      referral_user_id: this.refEnabledC() ? this.refUserIdC() : '',
    };
    const cur = this.current()!;
    // product_type принимается только при создании (PATCH-whitelist бэка).
    if (!cur.id) body.product_type = this.productTypeC();
    const obs = cur.id ? this.api.updatePromo(cur.id, body) : this.api.createPromo(body);
    obs.subscribe({
      next: () => { this.toast.success('Сохранено'); this.current.set(null); this.refresh(); },
      error: (e) => this.toast.error(errorMessage(e, 'Не удалось сохранить')),
    });
  }
}
