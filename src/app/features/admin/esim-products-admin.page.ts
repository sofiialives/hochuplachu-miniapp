import { Component, OnDestroy, OnInit, computed, inject, signal } from '@angular/core';
import {
  AdminApi, AdminEsimProduct, EsimProviderRef, PricingMode, ProviderCatalogItem, ProviderMeta, ProvidersMeta,
} from '../../core/api/admin.api';
import { ButtonComponent } from '../../ui/button.component';
import { InputComponent } from '../../ui/input.component';
import { DialogComponent } from '../../ui/dialog.component';
import { SearchableSelectComponent, SearchableSelectItem } from '../../ui/searchable-select.component';
import { ProviderTogglesComponent } from './provider-toggles.component';
import { ProductImportComponent } from './product-import.component';
import { BulkProductsComponent } from './bulk-products.component';
import { ToastService } from '../../core/notifications/toast.service';
import { errorMessage } from '../../core/errors/api-error';
import { formatAmount } from '../../core/currency/currency-symbols';
import { formatDataMb } from '../../core/api/esim.api';

/** Сколько строк каталога показываем в селекте (buvei plans ~1500 —
 *  целиком в дропдаун не кладём, q уходит серверу провайдера). */
const CATALOG_LIMIT = 50;

/** Черновик провайдер-привязки в форме (порядок строк = приоритет). */
interface RefDraft {
  provider: string;
  plan_id: string;
  label: string;
  price_usd_snapshot: number;
  /** Ручной ввод plan_id (fallback при недоступном провайдер-сервисе). */
  manual: boolean;
  items: ProviderCatalogItem[];
  loading: boolean;
  /** Каталог-прокси недоступен (SERVICE_URL не задан / провайдер лежит). */
  error: string;
}

// eSIM-продукты: блок «Провайдеры» (тумблеры provider_states), таблица
// тарифов и форма. Каждый тариф заводится вручную (страна/дни/объём, цена),
// план провайдера выбирается из каталог-прокси (серверный поиск ?q=).
@Component({
  selector: 'app-esim-products-admin',
  standalone: true,
  imports: [
    ButtonComponent, InputComponent, DialogComponent, SearchableSelectComponent,
    ProviderTogglesComponent, ProductImportComponent, BulkProductsComponent,
  ],
  template: `<h1>eSIM-продукты</h1>

    <app-provider-toggles productType="esim" [providers]="esimProviders()"
      (enabledChange)="onProviderToggled($event)" />

    <div class="actions">
      <app-button variant="primary" (clicked)="openCreate()">+ Новый тариф</app-button>
      <app-button variant="ghost" (clicked)="importOpen.set(true)">Импорт из каталога</app-button>
      <app-button variant="ghost" (clicked)="bulkOpen.set(true)">Массовые операции</app-button>
      <app-button variant="ghost" [loading]="repricing()" (clicked)="repriceNow()">Пересчитать цены</app-button>
    </div>

    @if (importOpen()) {
      <app-dialog title="Импорт из каталога провайдера" (dismissed)="importOpen.set(false)">
        <app-product-import productType="esim" [providers]="esimProviders()" (finished)="refresh()" />
      </app-dialog>
    }

    @if (bulkOpen()) {
      <app-dialog title="Массовые операции по регулярке" [wide]="true" (dismissed)="bulkOpen.set(false)">
        <app-bulk-products productType="esim" (changed)="refresh()" />
      </app-dialog>
    }

    <div class="search">
      <app-input [value]="query()" (valueChange)="onQuery($event)"
        placeholder="Поиск по названию или стране — «turkey 5 gb»" />
      @if (query()) { <span class="found">{{ items().length }}</span> }
    </div>

    <table>
      <thead><tr>
        <th>Название</th><th>Страна</th><th>Дни</th><th>Объём</th><th>Цена</th>
        <th>Провайдеры</th><th>Sort</th><th>Статус</th><th></th>
      </tr></thead>
      <tbody>
        @for (p of items(); track p.id) {
          <tr [class.disabled]="p.disable_purchase">
            <td>{{ p.name }}</td>
            <td>
              @if (p.country_code) { {{ p.country_name || p.country_code }} <span class="dim">({{ p.country_code }})</span> }
              @else { <span class="dim">глобальный</span> }
            </td>
            <td>{{ p.days }}</td>
            <td>{{ dataLabel(p.data_mb) }}</td>
            <td>
              {{ money(p.issue_price, p.issue_currency) }}
              @if (p.pricing_mode === 'dynamic') {
                <span class="badge badge--dyn" [title]="dynHint(p)">авто {{ p.markup_pct ?? 0 }}%</span>
              }
            </td>
            <td class="prov-cell">{{ providersSummary(p) }}</td>
            <td>{{ p.sort_order }}</td>
            <td>
              @if (p.disable_purchase) { <span class="badge badge--warn">покупка выкл</span> }
              @else if (!(p.providers?.length)) { <span class="badge badge--warn">нет провайдера</span> }
              @else { <span class="active">Активен</span> }
            </td>
            <td>
              <button class="link" (click)="edit(p)">edit</button>
              <button class="link red" (click)="remove(p)">delete</button>
            </td>
          </tr>
        } @empty {
          <tr><td colspan="9" class="empty">
            @if (query()) { Ничего не найдено по «{{ query() }}» } @else { Тарифов пока нет }
          </td></tr>
        }
      </tbody>
    </table>

    @if (current(); as c) {
      <app-dialog [title]="c.id ? 'Изменить тариф' : 'Новый тариф'" (dismissed)="current.set(null)">
        <app-input [(value)]="nameC" label="Название" placeholder="Turkey 1 ГБ / 7 дней" />
        <app-input [(value)]="descC" label="Описание (Markdown)" />
        <div class="two">
          <app-input [(value)]="countryCodeC" label="Код страны (ISO-2, пусто = глобальный)" placeholder="TR" />
          <app-input [(value)]="countryNameC" label="Название страны" placeholder="Турция" />
        </div>
        <div class="two">
          <app-input [(value)]="daysC" inputmode="numeric" label="Срок (дней)" />
          <app-input [(value)]="dataMbC" inputmode="numeric" label="Объём (МБ, 0 = безлимит)" />
        </div>
        <fieldset class="vis">
          <legend>Цена</legend>
          <div class="two">
            <label class="fld">
              <span class="lbl">Режим</span>
              <select [value]="modeC()" (change)="modeC.set($any($event.target).value)">
                <option value="static">Ручная цена</option>
                <option value="dynamic">Динамическая (от цены провайдера)</option>
              </select>
            </label>
            @if (modeC() === 'dynamic') {
              <app-input [(value)]="markupC" inputmode="decimal" label="Наценка, %" />
            }
          </div>
          @if (modeC() === 'dynamic') {
            <p class="vis-hint">
              Цена считается сама: себестоимость плана у провайдера (в долларах) × курс его
              источника × наценка, вниз до ближайшей «девятки». Валюта прайса — рубли.
              Пересчёт идёт по тикеру; вручную цену задавать не нужно.
              @if (currentDyn(); as d) { <br />Сейчас: <b>{{ d }}</b> }
            </p>
          } @else {
            <div class="two">
              <app-input [(value)]="priceC" inputmode="decimal" label="Цена" />
              <app-input [(value)]="curC" label="Валюта цены (RUB | USDT)" />
            </div>
          }
        </fieldset>
        <app-input [(value)]="sortC" inputmode="numeric" label="Sort order" />

        <fieldset class="vis">
          <legend>Провайдер-привязки (порядок = приоритет)</legend>
          <p class="vis-hint">
            Активный провайдер = первый включённый в блоке «Провайдеры». План выбирается из
            каталога провайдер-сервиса (поиск уходит серверу); цена плана снапшотится на
            привязке — защита от роста цены у провайдера. Пустой список — тариф недоступен
            и скрыт из каталога.
          </p>
          @for (r of refsC(); track $index; let i = $index) {
            <div class="ref-row">
              <div class="ref-head">
                <span class="ref-badge" [class.ref-badge--first]="i === 0">{{ i === 0 ? 'приоритет' : '#' + (i + 1) }}</span>
                <select class="ref-provider" [value]="r.provider" (change)="setRefProvider(i, $any($event.target).value)">
                  @for (p of esimProviders(); track p.code) {
                    <option [value]="p.code" [selected]="p.code === r.provider">{{ p.title }}</option>
                  }
                </select>
                <button type="button" class="ref-btn" [disabled]="i === 0" (click)="moveRef(i, -1)" title="Выше">↑</button>
                <button type="button" class="ref-btn" [disabled]="i === refsC().length - 1" (click)="moveRef(i, 1)" title="Ниже">↓</button>
                <button type="button" class="ref-btn ref-btn--del" (click)="removeRef(i)" title="Удалить">×</button>
              </div>
              @if (!r.manual) {
                <app-searchable-select
                  [items]="catalogItems(r)"
                  [value]="r.plan_id"
                  [serverMode]="true"
                  [loading]="r.loading"
                  [limitNote]="catalogLimit"
                  [selectedLabel]="r.label || r.plan_id"
                  placeholder="— выберите план провайдера —"
                  searchPlaceholder="Поиск плана (страна, объём)…"
                  (queryChanged)="searchCatalog(i, $event)"
                  (valueChange)="pickPlan(i, $event)" />
                @if (r.error) {
                  <p class="ref-err">{{ r.error }}</p>
                }
                <button type="button" class="manual-link" (click)="setManual(i, true)">ввести plan_id вручную</button>
              } @else {
                <div class="manual-row">
                  <input class="ref-input mono" type="text" placeholder="plan_id провайдера"
                    [value]="r.plan_id" (input)="setRefField(i, 'plan_id', $any($event.target).value)" />
                  <input class="ref-input" type="text" placeholder="подпись (опц.)"
                    [value]="r.label" (input)="setRefField(i, 'label', $any($event.target).value)" />
                  <input class="ref-input ref-input--price" type="text" inputmode="decimal" placeholder="цена $"
                    [value]="r.price_usd_snapshot || ''" (input)="setRefField(i, 'price_usd_snapshot', $any($event.target).value)" />
                </div>
                <button type="button" class="manual-link" (click)="setManual(i, false)">выбрать из каталога</button>
              }
              @if (r.plan_id && !r.manual) {
                <p class="ref-picked">План: <code>{{ r.plan_id }}</code>
                  @if (r.price_usd_snapshot) { · снапшот цены {{ '$' + r.price_usd_snapshot }} }
                </p>
              }
            </div>
          }
          <app-button variant="ghost" (clicked)="addRef()">+ Добавить провайдера</app-button>
        </fieldset>

        <label class="check">
          <input type="checkbox" [checked]="disablePurchaseC()" (change)="disablePurchaseC.set($any($event.target).checked)" />
          <span><b>Отключить покупку</b> — тариф пропадает из каталога; backend режет создание заявок.</span>
        </label>

        <app-button variant="primary" [full]="true" [loading]="saving()" (clicked)="save()">Сохранить</app-button>
      </app-dialog>
    }`,
  styles: [`
    .actions { display: flex; flex-wrap: wrap; gap: 12px; margin-bottom: var(--space-md); }
    /* Поиск — над таблицей: каталог тарифов это тысячи строк, и до нужной
       иначе не добраться. */
    .search { display: flex; align-items: center; gap: 12px; margin-bottom: var(--space-sm); }
    .search app-input { flex: 1; min-width: 0; }
    .found { color: var(--color-muted); font-size: 13px; white-space: nowrap; }
    table { width: 100%; border-collapse: collapse; }
    th, td { padding: 10px 12px; text-align: left; border-bottom: 1px solid var(--color-hairline); font-size: 14px; }
    th { color: var(--color-muted); font-weight: 500; font-size: 12px; text-transform: uppercase; letter-spacing: 0.04em; }
    tr.disabled { background: color-mix(in srgb, var(--color-danger, #dc3545) 5%, transparent); }
    .dim { color: var(--color-muted); }
    .empty { text-align: center; color: var(--color-muted); padding: 24px; }
    .prov-cell { font-size: 13px; color: var(--color-muted); max-width: 260px; }
    .link { color: var(--color-primary-ink); margin-right: 8px; background: none; border: none; cursor: pointer; padding: 0; font: inherit; }
    .link.red { color: var(--color-error); }
    .badge { display: inline-block; padding: 3px 8px; border-radius: 999px; font-size: 12px; font-weight: 500; }
    .badge--warn { background: color-mix(in srgb, var(--color-warning, #f59e0b) 14%, transparent); color: var(--color-warning, #b45309); }
    .active { color: var(--color-success, #198754); font-size: 13px; }
    .two { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
    @media (max-width: 560px) { .two { grid-template-columns: 1fr; } }
    .vis { border: 1px solid var(--color-hairline); border-radius: var(--rounded-md); padding: var(--space-sm) var(--space-md); margin: var(--space-sm) 0; }
    .vis legend { font-size: 12px; color: var(--color-muted); padding: 0 6px; font-weight: 600; }
    .vis-hint { margin: 0 0 var(--space-sm); font-size: 12px; color: var(--color-muted); line-height: 1.45; }
    .ref-row { border: 1px dashed var(--color-hairline); border-radius: var(--rounded-md); padding: 10px; margin-bottom: 10px; }
    .ref-head { display: flex; gap: 6px; align-items: center; margin-bottom: 8px; }
    .ref-badge {
      flex: 0 0 78px; text-align: center; font-size: 11px; color: var(--color-muted);
      padding: 4px 0; border: 1px dashed var(--color-hairline); border-radius: 999px;
    }
    .ref-badge--first { color: var(--color-primary-ink); border-color: var(--color-primary); border-style: solid; font-weight: 600; }
    .ref-provider {
      flex: 1; min-width: 0; height: 36px; padding: 0 10px;
      border: 1px solid var(--color-hairline); border-radius: var(--rounded-sm, 6px);
      background: var(--color-canvas); color: var(--color-ink); font: inherit; font-size: 13px;
    }
    .ref-btn {
      flex: 0 0 28px; height: 28px; border: 1px solid var(--color-hairline);
      border-radius: var(--rounded-sm, 6px); background: var(--color-canvas);
      color: var(--color-muted); cursor: pointer; font-size: 13px; line-height: 1;
    }
    .ref-btn:disabled { opacity: .35; cursor: default; }
    .ref-btn--del { color: var(--color-error); }
    .ref-err { margin: 6px 0 0; font-size: 12px; color: var(--color-error); }
    .ref-picked { margin: 6px 0 0; font-size: 12px; color: var(--color-muted); }
    .manual-link { margin-top: 6px; padding: 0; border: none; background: none; color: var(--color-primary-ink); font-size: 12px; cursor: pointer; }
    .manual-row { display: flex; gap: 6px; }
    .ref-input {
      flex: 1; min-width: 0; padding: 8px 10px;
      border: 1px solid var(--color-hairline); border-radius: var(--rounded-sm, 6px);
      background: var(--color-canvas); color: var(--color-ink); font-size: 13px;
    }
    .ref-input.mono { font-family: var(--font-mono, monospace); }
    .ref-input--price { flex: 0 0 90px; }
    .ref-input:focus { outline: none; border-color: var(--color-primary); }
    .check { display: flex; gap: 8px; align-items: flex-start; margin: var(--space-sm) 0; font-size: 13px; line-height: 1.4; }
    .badge--dyn { margin-left: 6px; background: color-mix(in srgb, var(--color-primary) 18%, transparent); color: var(--color-primary-ink); }
    .lbl { display: block; font-size: 12px; color: var(--color-muted); margin-bottom: 6px; }
    .fld select {
      width: 100%; height: 40px; padding: 0 10px;
      border: 1px solid var(--color-hairline); border-radius: var(--rounded-sm, 6px);
      background: var(--color-canvas); color: var(--color-ink); font: inherit; font-size: 14px;
    }
  `],
})
export class EsimProductsAdminPage implements OnInit, OnDestroy {
  private readonly api = inject(AdminApi);
  private readonly toast = inject(ToastService);

  protected readonly catalogLimit = CATALOG_LIMIT;

  protected readonly items = signal<AdminEsimProduct[]>([]);
  protected readonly providersMeta = signal<ProvidersMeta | null>(null);
  protected readonly esimProviders = computed<ProviderMeta[]>(() =>
    this.providersMeta()?.product_types?.['esim'] ?? []);

  protected readonly current = signal<AdminEsimProduct | Partial<AdminEsimProduct> | null>(null);
  protected readonly saving = signal(false);

  // Поля формы.
  protected readonly nameC = signal('');
  protected readonly descC = signal('');
  protected readonly countryCodeC = signal('');
  protected readonly countryNameC = signal('');
  protected readonly daysC = signal('7');
  protected readonly dataMbC = signal('0');
  protected readonly priceC = signal('');
  protected readonly curC = signal('RUB');
  protected readonly sortC = signal('0');
  protected readonly disablePurchaseC = signal(false);
  protected readonly modeC = signal<PricingMode>('static');
  protected readonly markupC = signal('30');
  protected readonly repricing = signal(false);
  // Импорт и массовые операции живут в диалогах: на странице они занимали
  // больше места, чем сам список продуктов.
  protected readonly importOpen = signal(false);
  protected readonly bulkOpen = signal(false);
  protected readonly refsC = signal<RefDraft[]>([]);

  ngOnInit(): void {
    this.loadProviders();
    this.refresh();
  }

  private loadProviders(): void {
    this.api.providersMeta().subscribe({
      next: (m) => this.providersMeta.set(m),
      error: (e: unknown) => this.toast.error(errorMessage(e, 'Не удалось загрузить провайдеров')),
    });
  }

  protected onProviderToggled(ev: { code: string; enabled: boolean }): void {
    this.providersMeta.update((m) => {
      if (!m) return m;
      const next = { ...m, product_types: { ...m.product_types } };
      next.product_types['esim'] = (next.product_types['esim'] ?? [])
        .map((p) => (p.code === ev.code ? { ...p, enabled: ev.enabled } : p));
      return next;
    });
  }

  /** Пауза перед запросом поиска: без неё каждое нажатие тянуло бы каталог
   *  тарифов целиком. */
  private static readonly SEARCH_DEBOUNCE_MS = 300;
  protected readonly query = signal('');
  private searchTimer: ReturnType<typeof setTimeout> | null = null;

  /** Ввод в поиске — фильтрует НА БЭКЕНДЕ, тем же сжатием написания, что на
   *  витрине: «turkey 5 gb» и «turkey5gb» — один запрос. */
  protected onQuery(v: string): void {
    this.query.set(v);
    if (this.searchTimer) clearTimeout(this.searchTimer);
    this.searchTimer = setTimeout(() => this.refresh(), EsimProductsAdminPage.SEARCH_DEBOUNCE_MS);
  }

  ngOnDestroy(): void {
    if (this.searchTimer) clearTimeout(this.searchTimer);
  }

  refresh(): void {
    this.api.listEsimProducts(this.query()).subscribe({
      next: (r) => this.items.set(r.products ?? []),
      error: (e: unknown) => this.toast.error(errorMessage(e, 'Не удалось загрузить тарифы')),
    });
  }

  protected dataLabel(mb: number): string { return formatDataMb(mb); }

  /** Подсказка к бейджу авто-цены в таблице. */
  protected dynHint(p: AdminEsimProduct): string {
    const parts = [`себестоимость $${p.cost_usd ?? 0}`, `наценка ${p.markup_pct ?? 0}%`];
    if (p.price_updated_at) parts.push(`пересчитано ${new Date(p.price_updated_at).toLocaleString('ru')}`);
    return parts.join(' · ');
  }

  /** Текущая расчётная цена редактируемого тарифа — чтобы оператор видел, что
   *  получится, не закрывая форму. */
  protected currentDyn(): string {
    const cur = this.current() as AdminEsimProduct | null;
    if (!cur?.id || cur.pricing_mode !== 'dynamic') return '';
    const price = this.money(cur.issue_price ?? 0, cur.issue_currency || 'RUB');
    return `${price} (себестоимость $${cur.cost_usd ?? 0})`;
  }

  /** Пересчитать цены немедленно, не дожидаясь тика. */
  protected repriceNow(): void {
    this.repricing.set(true);
    this.api.refreshPricing().subscribe({
      next: (s) => {
        this.repricing.set(false);
        this.toast.success(`Пересчитано: ${s.updated} из ${s.scanned}`);
        this.refresh();
      },
      error: (e: unknown) => {
        this.repricing.set(false);
        this.toast.error(errorMessage(e, 'Не удалось пересчитать цены'));
      },
    });
  }
  protected money(v: number, c: string): string { return formatAmount(v, c); }

  protected providersSummary(p: AdminEsimProduct): string {
    const refs = p.providers ?? [];
    if (!refs.length) return '—';
    return refs.map((r) => `${r.provider}: ${r.label || r.plan_id}`).join('; ');
  }

  // ----- Редактор провайдер-привязок -----

  private newRef(): RefDraft {
    const first = this.esimProviders()[0]?.code ?? 'buvei';
    return { provider: first, plan_id: '', label: '', price_usd_snapshot: 0, manual: false, items: [], loading: false, error: '' };
  }

  addRef(): void { this.refsC.update((l) => [...l, this.newRef()]); }
  removeRef(i: number): void { this.refsC.update((l) => l.filter((_, idx) => idx !== i)); }
  moveRef(i: number, delta: -1 | 1): void {
    this.refsC.update((l) => {
      const j = i + delta;
      if (j < 0 || j >= l.length) return l;
      const next = [...l];
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });
  }

  setRefProvider(i: number, provider: string): void {
    // Смена провайдера обнуляет план — план другого провайдера невалиден.
    this.refsC.update((l) => l.map((r, idx) => idx === i
      ? { ...r, provider, plan_id: '', label: '', price_usd_snapshot: 0, items: [], error: '' }
      : r));
  }

  setRefField(i: number, key: 'plan_id' | 'label' | 'price_usd_snapshot', value: string): void {
    this.refsC.update((l) => l.map((r, idx) => {
      if (idx !== i) return r;
      if (key === 'price_usd_snapshot') return { ...r, price_usd_snapshot: parseFloat(value) || 0 };
      return { ...r, [key]: value };
    }));
  }

  setManual(i: number, manual: boolean): void {
    this.refsC.update((l) => l.map((r, idx) => (idx === i ? { ...r, manual } : r)));
  }

  /** Строки каталога для селекта: label вида «Turkey · 1GB · 7d · $4.50». */
  protected catalogItems(r: RefDraft): SearchableSelectItem[] {
    return r.items.slice(0, CATALOG_LIMIT).map((it) => ({ id: it.id, label: this.planLabel(it) }));
  }

  /** «Turkey · 1GB · 7d · $4.50» из label + meta каталога (price_usd/days/
   *  data_mb/country — нормализация buvei /esim/plans). */
  private planLabel(it: ProviderCatalogItem): string {
    const meta = it.meta ?? {};
    const parts: string[] = [it.label];
    const dataMb = Number(meta['data_mb']);
    if (Number.isFinite(dataMb) && dataMb > 0) {
      const gb = dataMb / 1024;
      parts.push(dataMb < 1024 ? `${dataMb}MB` : `${Number.isInteger(gb) ? gb : gb.toFixed(1)}GB`);
    }
    const days = Number(meta['days']);
    if (Number.isFinite(days) && days > 0) parts.push(`${days}d`);
    const price = Number(meta['price_usd']);
    if (Number.isFinite(price) && price > 0) parts.push(`$${price.toFixed(2)}`);
    return parts.join(' · ');
  }

  searchCatalog(i: number, q: string): void {
    const r = this.refsC()[i];
    if (!r) return;
    this.refsC.update((l) => l.map((x, idx) => (idx === i ? { ...x, loading: true, error: '' } : x)));
    // country в прокси не передаём: код страны формы может быть ещё не задан,
    // а q и так фильтрует по названию у провайдера.
    this.api.providerCatalog('esim', r.provider, q).subscribe({
      next: (res) => this.refsC.update((l) => l.map((x, idx) => (idx === i
        ? { ...x, items: res.items ?? [], loading: false, error: '' }
        : x))),
      error: (e: unknown) => this.refsC.update((l) => l.map((x, idx) => (idx === i
        ? { ...x, items: [], loading: false, error: errorMessage(e, 'Каталог провайдера недоступен — введите plan_id вручную') }
        : x))),
    });
  }

  pickPlan(i: number, planId: string): void {
    const r = this.refsC()[i];
    const item = r?.items.find((it) => it.id === planId);
    this.refsC.update((l) => l.map((x, idx) => {
      if (idx !== i) return x;
      const meta = item?.meta ?? {};
      const price = Number(meta['price_usd']);
      return {
        ...x,
        plan_id: planId,
        label: item ? this.planLabel(item) : x.label,
        price_usd_snapshot: Number.isFinite(price) && price > 0 ? price : 0,
      };
    }));
    // Автозаполнение страны тарифа из меты плана (только если поле пустое).
    const country = String(item?.meta?.['country'] ?? '');
    if (country && !this.countryCodeC().trim()) this.countryCodeC.set(country.toUpperCase());
  }

  // ----- CRUD -----

  openCreate(): void {
    this.current.set({});
    this.nameC.set(''); this.descC.set('');
    this.countryCodeC.set(''); this.countryNameC.set('');
    this.daysC.set('7'); this.dataMbC.set('0');
    this.priceC.set(''); this.curC.set('RUB');
    this.sortC.set('0'); this.disablePurchaseC.set(false);
    this.modeC.set('static'); this.markupC.set('30');
    this.refsC.set([this.newRef()]);
  }

  edit(p: AdminEsimProduct): void {
    this.current.set(p);
    this.nameC.set(p.name); this.descC.set(p.description ?? '');
    this.countryCodeC.set(p.country_code ?? ''); this.countryNameC.set(p.country_name ?? '');
    this.daysC.set(String(p.days ?? 0)); this.dataMbC.set(String(p.data_mb ?? 0));
    this.priceC.set(String(p.issue_price ?? 0)); this.curC.set(p.issue_currency || 'RUB');
    this.sortC.set(String(p.sort_order ?? 0)); this.disablePurchaseC.set(!!p.disable_purchase);
    this.modeC.set(p.pricing_mode === 'dynamic' ? 'dynamic' : 'static');
    this.markupC.set(String(p.markup_pct ?? 30));
    this.refsC.set((p.providers ?? []).map((r: EsimProviderRef) => ({
      provider: r.provider,
      plan_id: r.plan_id,
      label: r.label ?? '',
      price_usd_snapshot: r.price_usd_snapshot ?? 0,
      manual: false,
      items: [],
      loading: false,
      error: '',
    })));
  }

  remove(p: AdminEsimProduct): void {
    if (!confirm(`Удалить тариф «${p.name}»?`)) return;
    this.api.deleteEsimProduct(p.id!).subscribe({
      next: () => { this.toast.success('Удалено'); this.refresh(); },
      error: (e: unknown) => this.toast.error(errorMessage(e, 'Не удалось удалить')),
    });
  }

  save(): void {
    const cur = this.current();
    if (!cur) return;
    const name = this.nameC().trim();
    const dynamic = this.modeC() === 'dynamic';
    const price = parseFloat(this.priceC());
    const markup = parseFloat(this.markupC());
    if (!name) { this.toast.error('Укажите название'); return; }
    // В динамическом режиме цену задаёт расчёт — руками её не вводят.
    if (!dynamic && (!(price >= 0) || this.priceC().trim() === '')) { this.toast.error('Укажите цену'); return; }
    if (dynamic && !(markup >= 0)) { this.toast.error('Укажите наценку в процентах'); return; }
    // Недозаполненные строки привязок (без plan_id) отбрасываем.
    const providers: EsimProviderRef[] = this.refsC()
      .filter((r) => r.plan_id.trim())
      .map((r) => ({
        provider: r.provider,
        plan_id: r.plan_id.trim(),
        ...(r.label.trim() ? { label: r.label.trim() } : {}),
        ...(r.price_usd_snapshot ? { price_usd_snapshot: r.price_usd_snapshot } : {}),
      }));
    // PATCH шлёт ПОЛНЫЙ набор whitelisted-полей формы (esimProductPatch бэка).
    const body: Partial<AdminEsimProduct> = {
      name,
      description: this.descC(),
      country_code: this.countryCodeC().trim().toUpperCase(),
      country_name: this.countryNameC().trim(),
      days: parseInt(this.daysC(), 10) || 0,
      data_mb: parseInt(this.dataMbC(), 10) || 0,
      issue_price: dynamic ? undefined : price,
      // В динамическом режиме валюту прайса бэкенд всё равно поставит рублёвой.
      issue_currency: dynamic ? 'RUB' : this.curC().trim(),
      providers,
      disable_purchase: this.disablePurchaseC(),
      sort_order: parseInt(this.sortC(), 10) || 0,
      pricing_mode: this.modeC(),
      markup_pct: dynamic ? markup : undefined,
    };
    this.saving.set(true);
    const obs = cur.id ? this.api.updateEsimProduct(cur.id, body) : this.api.createEsimProduct(body);
    obs.subscribe({
      next: () => {
        this.saving.set(false);
        this.toast.success('Сохранено');
        this.current.set(null);
        this.refresh();
      },
      error: (e: unknown) => {
        this.saving.set(false);
        this.toast.error(errorMessage(e, 'Не удалось сохранить'));
      },
    });
  }
}
