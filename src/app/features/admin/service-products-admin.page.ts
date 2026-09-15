import { Component, OnDestroy, OnInit, computed, inject, signal } from '@angular/core';
import {
  AdminApi, AdminServiceDenomination, AdminServiceProduct, PricingMode,
  ProviderCatalogItem, ProviderMeta, ProvidersMeta, ServiceProviderRef,
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

/** Сколько строк каталога показываем в селекте (fzr — тысячи SKU; q уходит
 *  серверу провайдера). */
const CATALOG_LIMIT = 50;

/** Состояние каталога одного провайдера (общее для всех селектов формы —
 *  и продуктовых привязок, и номиналов: каталог один и тот же). */
interface CatalogState {
  items: ProviderCatalogItem[];
  loading: boolean;
  error: string;
}

/** Черновик провайдер-привязки продукта (порядок = приоритет). */
interface RefDraft {
  provider: string;
  /** ext-снапшот идентификаторов провайдера, JSON-строкой (ручной fallback). */
  extJson: string;
  /** Выбранный элемент каталога (подпись для селекта). */
  pickedId: string;
  pickedLabel: string;
  manual: boolean;
}

/** Черновик номинала гифткарты. */
interface DenomDraft {
  id: string;
  /** Имя позиции у поставщика («1 Year …», «12 месяцев»); пусто = число+валюта. */
  label: string;
  value: string;
  price: string;
  disabled: boolean;
  /** provider → ext JSON-строкой (ручной fallback при недоступном каталоге). */
  ext: Record<string, string>;
  /** provider → выбранный элемент каталога (подпись селекта). */
  picked: Record<string, { id: string; label: string }>;
  /** provider → ручной режим ввода ext. */
  manual: Record<string, boolean>;
}

// Сервис-продукты (Steam-пополнение, гифткарты): блок «Провайдеры», таблица
// и kind-зависимая форма. account_topup — валюта/лимиты/комиссия/пресеты/
// логин-подписи + провайдер-привязки (ext из каталог-прокси); gift_card —
// валюта номиналов + редактор номиналов (value, price, disabled, per-провайдер
// ext; референс xbox.png: «50 TRY — цена RUB», показ сортируется численно).
@Component({
  selector: 'app-service-products-admin',
  standalone: true,
  imports: [
    ButtonComponent, InputComponent, DialogComponent, SearchableSelectComponent,
    ProviderTogglesComponent, ProductImportComponent, BulkProductsComponent,
  ],
  template: `<h1>Сервисы-продукты</h1>

    <app-provider-toggles productType="service" [providers]="serviceProviders()"
      (enabledChange)="onProviderToggled($event)" />

    <div class="actions">
      <app-button variant="primary" (clicked)="openCreate()">+ Новый сервис</app-button>
      <app-button variant="ghost" (clicked)="importOpen.set(true)">Импорт из каталога</app-button>
      <app-button variant="ghost" (clicked)="bulkOpen.set(true)">Массовые операции</app-button>
      <app-button variant="ghost" [loading]="repricing()" (clicked)="repriceNow()">Пересчитать цены</app-button>
    </div>

    @if (importOpen()) {
      <app-dialog title="Импорт из каталога провайдера" (dismissed)="importOpen.set(false)">
        <app-product-import productType="service" [providers]="serviceProviders()" (finished)="refresh()" />
      </app-dialog>
    }

    @if (bulkOpen()) {
      <app-dialog title="Массовые операции по регулярке" [wide]="true" (dismissed)="bulkOpen.set(false)">
        <app-bulk-products productType="service" (changed)="refresh()" />
      </app-dialog>
    }

    <div class="search">
      <app-input [value]="query()" (valueChange)="onQuery($event)"
        placeholder="Поиск по названию или slug — «play station pl»" />
      @if (query()) { <span class="found">{{ items().length }}</span> }
    </div>

    <table>
      <thead><tr>
        <th>Название</th><th>Slug</th><th>Вид</th><th>Валюта цен</th>
        <th>Провайдеры</th><th>Featured</th><th>Sort</th><th>Статус</th><th></th>
      </tr></thead>
      <tbody>
        @for (p of items(); track p.id) {
          <tr [class.disabled]="p.disable_purchase">
            <td>{{ p.name }}</td>
            <td><code>{{ p.slug }}</code></td>
            <td>{{ kindLabel(p.kind) }}<div class="sub">{{ kindSummary(p) }}</div></td>
            <td>{{ p.issue_currency }}</td>
            <td class="prov-cell">{{ providersSummary(p) }}</td>
            <td>{{ p.featured ? 'Да' : '—' }}</td>
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
            @if (query()) { Ничего не найдено по «{{ query() }}» } @else { Сервис-продуктов пока нет }
          </td></tr>
        }
      </tbody>
    </table>

    @if (current(); as c) {
      <app-dialog [title]="c.id ? 'Изменить сервис' : 'Новый сервис'" (dismissed)="current.set(null)">
        <label class="field">
          <span>Вид сервиса</span>
          <select [value]="kindC()" (change)="setKind($any($event.target).value)">
            <option value="account_topup" [selected]="kindC() === 'account_topup'">account_topup — логин + произвольная сумма (Steam)</option>
            <option value="gift_card" [selected]="kindC() === 'gift_card'">gift_card — номиналы → код активации</option>
            <option value="subscription" [selected]="kindC() === 'subscription'">subscription — логин + план (Telegram Premium)</option>
          </select>
        </label>
        <app-input [(value)]="nameC" label="Название" placeholder="Steam" />
        <app-input [(value)]="slugC" label="Slug (латиница, уникален)" placeholder="сгенерируется из названия" />
        <p class="hint">Пусто — бэкенд сгенерирует slug из названия (уникальность добьёт суффиксом).
          Менять после создания нельзя: сломаются адрес /services/:slug и внешние ссылки на него —
          поэтому при переименовании продукта slug остаётся прежним.</p>
        <app-input [(value)]="descC" label="Описание (Markdown)" />
        <app-input [(value)]="iconUrlC" label="URL иконки" placeholder="https://… или /assets/services/steam.png" />
        <p class="hint">Если пусто — подставится обложка из каталога провайдера: адрес на нашем домене,
          картинка подтянется при первом открытии. Вписанный вручную адрес автоматика не трогает.</p>
        @if (iconPreview(); as src) {
          <img class="icon-preview" [src]="src" alt="" />
        }
        <div class="two">
          @if (modeC() === 'dynamic') {
            <app-input [value]="'RUB'" [disabled]="true" label="Валюта цен (динамика — всегда RUB)" />
          } @else {
            <app-input [(value)]="issueCurC" label="Валюта цен (RUB | USDT)" />
          }
          <app-input [(value)]="sortC" inputmode="numeric" label="Sort order" />
        </div>

        <fieldset class="vis">
          <legend>{{ kindC() === 'account_topup' ? 'Цена пополнения' : (kindC() === 'subscription' ? 'Цена планов' : 'Цена номиналов') }}</legend>
          <div class="two">
            <label class="fld">
              <span class="lbl">Режим</span>
              <select [value]="modeC()" (change)="modeC.set($any($event.target).value)" [disabled]="moneyTopup()">
                <option value="static">{{ kindC() === 'account_topup' ? 'Сумма + комиссия (ниже)' : 'Ручная цена у каждой позиции' }}</option>
                @if (!moneyTopup()) {
                  <option value="dynamic">Динамическая (от цены провайдера)</option>
                }
              </select>
            </label>
            @if (modeC() === 'dynamic') {
              <app-input [(value)]="markupC" inputmode="decimal" label="Наценка, %" />
            }
          </div>
          @if (moneyTopup()) {
            <p class="vis-hint">
              Цена ДЕНЕЖНОГО пополнения = сумма зачисления + надбавка «Комиссия, %» ниже.
              Курсы в неё не входят: рубль на счёт сервиса стоит покупателю рубль, при
              комиссии 0% он платит ровно столько, сколько зачислится. Динамика тут не
              применяется — она нужна ШТУЧНОМУ товару (заполнена «Единица зачисления»),
              где цену количества иначе не получить.
            </p>
          }
          @if (modeC() === 'dynamic') {
            @if (kindC() !== 'account_topup') {
              <p class="vis-hint">
                Цена каждой позиции считается сама: себестоимость SKU у провайдера (в долларах)
                × курс его источника × наценка, вниз до ближайшей «девятки». Поля цены ниже
                заполнять не нужно — их перезапишет пересчёт.
              </p>
            } @else {
              <p class="vis-hint">
                Считается цена ОДНОЙ единицы зачисления: себестоимость единицы у провайдера
                (в долларах) × курс его источника × наценка; итог заявки = количество × эта цена.
                «Девятки» тут нет — округляется итог, а не множитель. Себестоимость единицы
                приносит импорт каталога: пополнению, заведённому руками, считать цену не из чего,
                и его маржа живёт в поле «Комиссия, %».
              </p>
            }
          }
        </fieldset>

        <fieldset class="vis">
          <legend>Провайдер-привязки (порядок = приоритет)</legend>
          <p class="vis-hint">
            Активный провайдер = первый включённый в блоке «Провайдеры». ext — снапшот
            идентификаторов продукта у провайдера: выбирается из каталога провайдер-сервиса
            (или вводится JSON'ом вручную, если сервис недоступен).
            @if (kindC() !== 'account_topup') {
              У гифткарт и подписок ext обязателен у КАЖДОЙ позиции (ниже); привязка здесь
              задаёт приоритет провайдеров.
            }
          </p>
          @for (r of refsC(); track $index; let i = $index) {
            <div class="ref-row">
              <div class="ref-head">
                <span class="ref-badge" [class.ref-badge--first]="i === 0">{{ i === 0 ? 'приоритет' : '#' + (i + 1) }}</span>
                <select class="ref-provider" [value]="r.provider" (change)="setRefProvider(i, $any($event.target).value)">
                  @for (p of serviceProviders(); track p.code) {
                    <option [value]="p.code" [selected]="p.code === r.provider">{{ p.title }}</option>
                  }
                </select>
                <button type="button" class="ref-btn" [disabled]="i === 0" (click)="moveRef(i, -1)" title="Выше">↑</button>
                <button type="button" class="ref-btn" [disabled]="i === refsC().length - 1" (click)="moveRef(i, 1)" title="Ниже">↓</button>
                <button type="button" class="ref-btn ref-btn--del" (click)="removeRef(i)" title="Удалить">×</button>
              </div>
              @if (!r.manual) {
                <app-searchable-select
                  [items]="catalogSelectItems(r.provider)"
                  [value]="r.pickedId"
                  [serverMode]="true"
                  [loading]="catalogLoading(r.provider)"
                  [limitNote]="catalogLimit"
                  [selectedLabel]="r.pickedLabel || extSummary(r.extJson)"
                  placeholder="— выберите продукт провайдера —"
                  searchPlaceholder="Поиск по каталогу…"
                  (queryChanged)="searchCatalog(r.provider, $event)"
                  (valueChange)="pickRefExt(i, $event)" />
                @if (catalogError(r.provider)) {
                  <p class="ref-err">{{ catalogError(r.provider) }}</p>
                }
                <button type="button" class="manual-link" (click)="setRefManual(i, true)">ввести ext вручную</button>
              } @else {
                <input class="ref-input mono" type="text" placeholder='ext JSON, напр. {"endpoint":"steam-topup"}'
                  [value]="r.extJson" (input)="setRefExtJson(i, $any($event.target).value)" />
                <button type="button" class="manual-link" (click)="setRefManual(i, false)">выбрать из каталога</button>
              }
              @if (r.extJson) {
                <p class="ref-picked">ext: <code>{{ r.extJson }}</code></p>
              }
            </div>
          }
          <app-button variant="ghost" (clicked)="addRef()">+ Добавить провайдера</app-button>
        </fieldset>

        @if (kindC() === 'subscription') {
          <fieldset class="vis">
            <legend>Подписка по логину</legend>
            <p class="vis-hint">
              Подписка включается на АККАУНТ и кода не выдаёт: у продукта есть поле логина и
              список планов (ниже, как номиналы). Цена каждого плана своя — 12 месяцев не стоят
              вчетверо дороже трёх, поэтому это отдельные позиции, а не количество.
            </p>
            <div class="two">
              <app-input [(value)]="loginLabelC" label="Подпись поля логина" placeholder="Имя пользователя Telegram" />
              <app-input [(value)]="loginHintC" label="Подсказка под логином" placeholder="@username" />
            </div>
            <app-input [(value)]="loginPrefixC" [maxLength]="8" label="Приставка логина (витрина подставит её сама)" placeholder="@" />
          </fieldset>
        }
        @if (kindC() === 'account_topup') {
          <fieldset class="vis">
            <legend>Пополнение аккаунта</legend>
            <div class="two">
              <app-input [(value)]="amountCurC" label="Валюта зачисления (RUB для Steam RU)" />
              <app-input [(value)]="feePctC" inputmode="decimal" label="Комиссия, % (5 = 5%)" />
            </div>
            <div class="two">
              <app-input [(value)]="minAmountC" inputmode="decimal" label="Мин. сумма зачисления" />
              <app-input [(value)]="maxAmountC" inputmode="decimal" label="Макс. сумма зачисления" />
            </div>
            <!-- Пресеты — кнопки под полем ввода, а вводит пользователь сумму
                 К ОПЛАТЕ (лимиты выше — в зачислении, их проверяет бэк). -->
            <app-input [(value)]="presetsC" label="Пресеты суммы к оплате (через запятую)" placeholder="500, 1000, 2000, 5000" />
            <div class="two">
              <app-input [(value)]="loginLabelC" label="Подпись поля логина" placeholder="Логин Steam" />
              <app-input [(value)]="loginHintC" label="Подсказка под логином" placeholder="Логин аккаунта, не почта" />
            </div>
            <!-- Приставка: витрина подставит её сама, как только покупатель
                 введёт первый символ, и выбросит лишние вхождения. У логина
                 Steam приставки нет — поле остаётся пустым. -->
            <app-input [(value)]="loginPrefixC" [maxLength]="8" label="Приставка логина («@» у ника Telegram)" placeholder="@" />
            <!-- Единица зачисления: пусто = зачисляются деньги в валюте выше и
                 покупатель вводит СУММУ; заполнено = товар считается штуками
                 (звёзды), и покупатель вводит КОЛИЧЕСТВО. -->
            <div class="two">
              <app-input [(value)]="amountUnitC" label="Единица зачисления (пусто = деньги)" placeholder="⭐" />
              <app-input [(value)]="amountLabelC" label="Подпись поля суммы" placeholder="Количество звёзд" />
            </div>
          </fieldset>
        }
        @if (kindC() !== 'account_topup') {
          <fieldset class="vis">
            <legend>{{ kindC() === 'subscription' ? 'Планы («12 месяцев — цена ' + (issueCurC() || 'RUB') + '»)' : 'Номиналы («50 TRY — цена ' + (issueCurC() || 'RUB') + '»)' }}</legend>
            <app-input [(value)]="denomCurC" label="Валюта номиналов" placeholder="TRY" />
            <p class="vis-hint">
              Показ номиналов везде сортируется ЧИСЛЕННО по значению. ext номинала — из
              каталога провайдера (у fzr пара category_id+card_id уникальна на номинал).
            </p>
            @for (d of denomsC(); track d.id; let di = $index) {
              <div class="denom-row" [class.denom-row--off]="d.disabled">
                <div class="denom-head">
                  <!-- Имя позиции у поставщика: у гифткарты им бывает сам товар
                       («1 Year Adobe Acrobat AI Assistant»), у плана подписки это
                       единственная подпись («12 месяцев»). Пусто = витрина
                       покажет число с валютой номиналов. -->
                  <input class="ref-input denom-label" type="text"
                    [placeholder]="kindC() === 'subscription' ? '12 месяцев' : 'имя (необязательно)'"
                    [value]="d.label" (input)="setDenomField(di, 'label', $any($event.target).value)" />
                  <input class="ref-input ref-input--num" type="text" inputmode="decimal"
                    [placeholder]="kindC() === 'subscription' ? 'мес.' : '50'"
                    [value]="d.value" (input)="setDenomField(di, 'value', $any($event.target).value)" />
                  <span class="denom-cur">{{ kindC() === 'subscription' ? 'мес.' : (denomCurC() || 'ном.') }}</span>
                  <span class="denom-dash">—</span>
                  <input class="ref-input ref-input--num" type="text" inputmode="decimal" placeholder="1490"
                    [value]="d.price" (input)="setDenomField(di, 'price', $any($event.target).value)" />
                  <span class="denom-cur">{{ issueCurC() || 'цена' }}</span>
                  <label class="denom-off">
                    <input type="checkbox" [checked]="d.disabled" (change)="setDenomDisabled(di, $any($event.target).checked)" />
                    выкл
                  </label>
                  <button type="button" class="ref-btn ref-btn--del" (click)="removeDenom(di)" title="Удалить номинал">×</button>
                </div>
                @for (p of refProviders(); track p) {
                  <div class="denom-prov">
                    <span class="denom-prov-name">{{ p }}</span>
                    @if (!d.manual[p]) {
                      <div class="denom-prov-select">
                        <app-searchable-select
                          [items]="catalogSelectItems(p)"
                          [value]="d.picked[p]?.id || stableExtId(d.ext[p])"
                          [serverMode]="true"
                          [loading]="catalogLoading(p)"
                          [limitNote]="catalogLimit"
                          [selectedLabel]="d.picked[p]?.label || extSummary(d.ext[p])"
                          placeholder="— выберите номинал у провайдера —"
                          searchPlaceholder="Поиск по каталогу…"
                          (queryChanged)="searchCatalog(p, $event)"
                          (valueChange)="pickDenomExt(di, p, $event)" />
                      </div>
                      <button type="button" class="manual-link" (click)="setDenomManual(di, p, true)">вручную</button>
                    } @else {
                      <input class="ref-input mono" type="text" placeholder='ext JSON, напр. {"category_id":"…","card_id":"…"}'
                        [value]="d.ext[p] || ''" (input)="setDenomExtJson(di, p, $any($event.target).value)" />
                      <button type="button" class="manual-link" (click)="setDenomManual(di, p, false)">каталог</button>
                    }
                  </div>
                } @empty {
                  <p class="ref-err">Добавьте провайдер-привязку выше — ext номинала задаётся per-провайдер.</p>
                }
              </div>
            }
            <app-button variant="ghost" (clicked)="addDenom()">+ Добавить номинал</app-button>
          </fieldset>
        }

        <label class="check">
          <input type="checkbox" [checked]="featuredC()" (change)="featuredC.set($any($event.target).checked)" />
          <span><b>Featured</b> — большой блок на витрине (Steam).</span>
        </label>
        <label class="check">
          <input type="checkbox" [checked]="disablePurchaseC()" (change)="disablePurchaseC.set($any($event.target).checked)" />
          <span><b>Отключить покупку</b> — продукт пропадает из каталога; backend режет создание заказов.</span>
        </label>

        <app-button variant="primary" [full]="true" [loading]="saving()" (clicked)="save()">Сохранить</app-button>
      </app-dialog>
    }`,
  styles: [`
    .actions { display: flex; flex-wrap: wrap; gap: 12px; margin-bottom: var(--space-md); }
    /* Поиск — над таблицей: он единственный способ добраться до нужного из
       сотен импортированных продуктов. */
    .search { display: flex; align-items: center; gap: 12px; margin-bottom: var(--space-sm); }
    .search app-input { flex: 1; min-width: 0; }
    .found { color: var(--color-muted); font-size: 13px; white-space: nowrap; }
    table { width: 100%; border-collapse: collapse; }
    th, td { padding: 10px 12px; text-align: left; border-bottom: 1px solid var(--color-hairline); font-size: 14px; }
    th { color: var(--color-muted); font-weight: 500; font-size: 12px; text-transform: uppercase; letter-spacing: 0.04em; }
    tr.disabled { background: color-mix(in srgb, var(--color-danger, #dc3545) 5%, transparent); }
    .sub { color: var(--color-muted); font-size: 12px; }
    .empty { text-align: center; color: var(--color-muted); padding: 24px; }
    .prov-cell { font-size: 13px; color: var(--color-muted); max-width: 240px; }
    .link { color: var(--color-primary-ink); margin-right: 8px; background: none; border: none; cursor: pointer; padding: 0; font: inherit; }
    .link.red { color: var(--color-error); }
    .badge { display: inline-block; padding: 3px 8px; border-radius: 999px; font-size: 12px; font-weight: 500; }
    .badge--warn { background: color-mix(in srgb, var(--color-warning, #f59e0b) 14%, transparent); color: var(--color-warning, #b45309); }
    .active { color: var(--color-success, #198754); font-size: 13px; }
    .two { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
    @media (max-width: 560px) { .two { grid-template-columns: 1fr; } }
    .field { display: flex; flex-direction: column; gap: 6px; margin: var(--space-sm) 0; font-size: 13px; color: var(--color-muted); }
    .field select {
      height: 44px; padding: 10px 14px; border: 1px solid var(--color-hairline);
      border-radius: var(--rounded-md); background: var(--color-canvas); color: var(--color-ink); font: inherit;
    }
    .field select:focus { outline: none; border-color: var(--color-primary); }
    .vis { border: 1px solid var(--color-hairline); border-radius: var(--rounded-md); padding: var(--space-sm) var(--space-md); margin: var(--space-sm) 0; }
    .vis legend { font-size: 12px; color: var(--color-muted); padding: 0 6px; font-weight: 600; }
    .vis-hint { margin: 0 0 var(--space-sm); font-size: 12px; color: var(--color-muted); line-height: 1.45; }
    .hint { margin: 6px 0 0; font-size: 12px; color: var(--color-muted); line-height: 1.45; }
    /* Превью иконки — контроль того, что по адресу лежит картинка (в т.ч. после
       автоподстановки бэкендом): битая ссылка видна сразу, а не на витрине. */
    .icon-preview {
      display: block; margin-top: 8px; width: 56px; height: 56px; object-fit: contain;
      border: 1px solid var(--color-hairline); border-radius: var(--rounded-sm, 6px);
      padding: 4px; background: var(--color-canvas);
    }
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
    .ref-picked { margin: 6px 0 0; font-size: 12px; color: var(--color-muted); overflow-wrap: anywhere; }
    .manual-link { margin-top: 6px; padding: 0; border: none; background: none; color: var(--color-primary-ink); font-size: 12px; cursor: pointer; }
    .ref-input {
      width: 100%; box-sizing: border-box; padding: 8px 10px;
      border: 1px solid var(--color-hairline); border-radius: var(--rounded-sm, 6px);
      background: var(--color-canvas); color: var(--color-ink); font-size: 13px;
    }
    .ref-input.mono { font-family: var(--font-mono, monospace); }
    .ref-input--num { width: 90px; flex: 0 0 90px; }
    .ref-input:focus { outline: none; border-color: var(--color-primary); }
    .check { display: flex; gap: 8px; align-items: flex-start; margin: var(--space-sm) 0; font-size: 13px; line-height: 1.4; }
    .denom-row { border: 1px dashed var(--color-hairline); border-radius: var(--rounded-md); padding: 10px; margin-bottom: 10px; }
    .denom-row--off { opacity: .6; }
    .denom-head { display: flex; gap: 6px; align-items: center; flex-wrap: wrap; }
    .denom-label { flex: 1 1 160px; min-width: 120px; }
    .denom-cur { font-size: 12px; color: var(--color-muted); }
    .denom-dash { color: var(--color-muted); }
    .denom-off { display: flex; gap: 4px; align-items: center; font-size: 12px; color: var(--color-muted); margin-left: auto; }
    .denom-prov { display: flex; gap: 8px; align-items: center; margin-top: 8px; }
    .denom-prov-name { flex: 0 0 84px; font-family: var(--font-mono, monospace); font-size: 12px; color: var(--color-muted); }
    .denom-prov-select { flex: 1; min-width: 0; }
    .denom-prov .ref-input { flex: 1; }
    .denom-prov .manual-link { margin-top: 0; flex: 0 0 auto; }
  `],
})
export class ServiceProductsAdminPage implements OnInit, OnDestroy {
  private readonly api = inject(AdminApi);
  private readonly toast = inject(ToastService);

  protected readonly catalogLimit = CATALOG_LIMIT;

  protected readonly items = signal<AdminServiceProduct[]>([]);
  protected readonly providersMeta = signal<ProvidersMeta | null>(null);
  protected readonly serviceProviders = computed<ProviderMeta[]>(() =>
    this.providersMeta()?.product_types?.['service'] ?? []);

  protected readonly current = signal<AdminServiceProduct | Partial<AdminServiceProduct> | null>(null);
  protected readonly saving = signal(false);

  // Общие поля.
  protected readonly kindC = signal<AdminServiceProduct['kind']>('account_topup');
  protected readonly nameC = signal('');
  protected readonly slugC = signal('');
  protected readonly descC = signal('');
  protected readonly iconUrlC = signal('');
  protected readonly featuredC = signal(false);
  protected readonly sortC = signal('0');
  protected readonly disablePurchaseC = signal(false);
  protected readonly issueCurC = signal('RUB');
  protected readonly amountUnitC = signal('');
  protected readonly amountLabelC = signal('');
  protected readonly modeC = signal<PricingMode>('static');
  protected readonly markupC = signal('30');
  protected readonly repricing = signal(false);
  // Импорт и массовые операции живут в диалогах: на странице они занимали
  // больше места, чем сам список продуктов.
  protected readonly importOpen = signal(false);
  protected readonly bulkOpen = signal(false);
  protected readonly refsC = signal<RefDraft[]>([]);
  // account_topup.
  protected readonly amountCurC = signal('RUB');
  protected readonly minAmountC = signal('0');
  protected readonly maxAmountC = signal('0');
  protected readonly feePctC = signal('0');
  protected readonly presetsC = signal('');
  protected readonly loginLabelC = signal('');
  protected readonly loginHintC = signal('');
  protected readonly loginPrefixC = signal('');
  // gift_card.
  protected readonly denomCurC = signal('');
  protected readonly denomsC = signal<DenomDraft[]>([]);

  /** Адрес иконки для превью: пустая строка = превью не рисуем (иконку подставит
   *  бэкенд из каталога провайдера уже после сохранения). */
  protected readonly iconPreview = computed(() => this.iconUrlC().trim());

  /** Каталоги провайдер-сервисов, общий кеш формы: provider → состояние. */
  protected readonly catalogs = signal<Record<string, CatalogState>>({});

  /** Провайдеры текущих привязок — колонки ext в редакторе номиналов. */
  protected readonly refProviders = computed(() => {
    const seen: string[] = [];
    for (const r of this.refsC()) {
      if (r.provider && !seen.includes(r.provider)) seen.push(r.provider);
    }
    return seen;
  });

  ngOnInit(): void {
    this.api.providersMeta().subscribe({
      next: (m) => this.providersMeta.set(m),
      error: (e: unknown) => this.toast.error(errorMessage(e, 'Не удалось загрузить провайдеров')),
    });
    this.refresh();
  }

  protected onProviderToggled(ev: { code: string; enabled: boolean }): void {
    this.providersMeta.update((m) => {
      if (!m) return m;
      const next = { ...m, product_types: { ...m.product_types } };
      next.product_types['service'] = (next.product_types['service'] ?? [])
        .map((p) => (p.code === ev.code ? { ...p, enabled: ev.enabled } : p));
      return next;
    });
  }

  /** Пауза перед запросом поиска: без неё каждое нажатие клавиши тянуло бы
   *  список продуктов целиком. */
  private static readonly SEARCH_DEBOUNCE_MS = 300;
  protected readonly query = signal('');
  private searchTimer: ReturnType<typeof setTimeout> | null = null;

  /** Ввод в поиске — фильтрует НА БЭКЕНДЕ: импортированный каталог это сотни
   *  продуктов, и до нужного (чтобы его отредактировать или снять с продажи)
   *  иначе не добраться. */
  protected onQuery(v: string): void {
    this.query.set(v);
    if (this.searchTimer) clearTimeout(this.searchTimer);
    this.searchTimer = setTimeout(() => this.refresh(), ServiceProductsAdminPage.SEARCH_DEBOUNCE_MS);
  }

  ngOnDestroy(): void {
    if (this.searchTimer) clearTimeout(this.searchTimer);
  }

  refresh(): void {
    this.api.listServiceProducts(this.query()).subscribe({
      next: (r) => this.items.set(r.products ?? []),
      error: (e: unknown) => this.toast.error(errorMessage(e, 'Не удалось загрузить сервис-продукты')),
    });
  }

  protected kindLabel(kind: string): string {
    switch (kind) {
      case 'gift_card': return 'Гифткарта';
      case 'subscription': return 'Подписка по логину';
      default: return 'Пополнение аккаунта';
    }
  }

  protected kindSummary(p: AdminServiceProduct): string {
    if (p.kind !== 'account_topup') {
      const denoms = (p.denominations ?? []).filter((d) => !d.disabled);
      const noun = p.kind === 'subscription' ? 'планов' : 'номиналов';
      if (!denoms.length) return `${noun} нет`;
      // Показ позиций — численная сортировка (лексикографика донора — баг). У
      // плана подпись у поставщика («12 месяцев»), у номинала — число с валютой.
      const sorted = [...denoms].sort((a, b) => a.value - b.value);
      const short = p.kind === 'subscription' ? 'план.' : 'ном.';
      return `${sorted.length} ${short}: ${sorted.map((d) => d.label || `${d.value} ${p.denom_currency}`).join(', ')}`;
    }
    const unit = p.amount_unit || p.amount_currency;
    const parts = [`${p.min_amount}–${p.max_amount} ${unit}`];
    // У штучного пополнения комиссии нет — маржа сидит в цене единицы.
    if (p.unit_price) parts.push(`${formatAmount(p.unit_price, p.issue_currency)} за 1 ${unit}`);
    else if (p.fee_pct) parts.push(`комиссия ${p.fee_pct}%`);
    return parts.join(' · ');
  }

  protected providersSummary(p: AdminServiceProduct): string {
    const refs = p.providers ?? [];
    if (!refs.length) return '—';
    return refs.map((r) => r.provider).join(' → ');
  }

  protected money(v: number, c: string): string { return formatAmount(v, c); }

  // ----- Каталоги провайдеров (общий кеш формы) -----

  protected catalogSelectItems(provider: string): SearchableSelectItem[] {
    const st = this.catalogs()[provider];
    return (st?.items ?? []).slice(0, CATALOG_LIMIT).map((it) => ({ id: it.id, label: it.label }));
  }
  protected catalogLoading(provider: string): boolean { return !!this.catalogs()[provider]?.loading; }
  protected catalogError(provider: string): string { return this.catalogs()[provider]?.error ?? ''; }

  searchCatalog(provider: string, q: string): void {
    if (!provider) return;
    this.catalogs.update((m) => ({ ...m, [provider]: { items: m[provider]?.items ?? [], loading: true, error: '' } }));
    this.api.providerCatalog('service', provider, q).subscribe({
      next: (r) => this.catalogs.update((m) => ({ ...m, [provider]: { items: r.items ?? [], loading: false, error: '' } })),
      error: (e: unknown) => this.catalogs.update((m) => ({
        ...m,
        [provider]: { items: [], loading: false, error: errorMessage(e, 'Каталог провайдера недоступен — введите ext вручную') },
      })),
    });
  }

  /** id каталога → ext-map: составной JSON-ext (fzr) парсится как есть;
   *  playbot — serviceId → {service_id}; иначе generic {id}. */
  private extFromCatalogId(provider: string, id: string): Record<string, string> {
    try {
      const v = JSON.parse(id) as unknown;
      if (v && typeof v === 'object' && !Array.isArray(v)) {
        const ext: Record<string, string> = {};
        for (const [k, val] of Object.entries(v as Record<string, unknown>)) ext[k] = String(val);
        return ext;
      }
    } catch { /* не JSON — одиночный id */ }
    return provider === 'playbot' ? { service_id: id } : { id };
  }

  /** Человекочитаемая сводка ext для подписи селекта. */
  protected extSummary(extJson: string | undefined): string {
    if (!extJson) return '';
    try {
      const v = JSON.parse(extJson) as Record<string, unknown>;
      return Object.entries(v).map(([k, val]) => `${k}=${val}`).join(', ');
    } catch {
      return extJson;
    }
  }

  /** Стабильный value для селекта из сохранённого ext (когда pickedId нет —
   *  редактирование существующего продукта): непустая строка, чтобы toggle
   *  показывал selectedLabel, а не плейсхолдер. */
  protected stableExtId(extJson: string | undefined): string { return extJson ?? ''; }

  // ----- Провайдер-привязки продукта -----

  private newRef(): RefDraft {
    const first = this.serviceProviders()[0]?.code ?? 'playbot';
    return { provider: first, extJson: '', pickedId: '', pickedLabel: '', manual: false };
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
    // Смена провайдера сбрасывает ext — идентификаторы чужого невалидны.
    this.refsC.update((l) => l.map((r, idx) => idx === i
      ? { ...r, provider, extJson: '', pickedId: '', pickedLabel: '' }
      : r));
  }
  setRefManual(i: number, manual: boolean): void {
    this.refsC.update((l) => l.map((r, idx) => (idx === i ? { ...r, manual } : r)));
  }
  setRefExtJson(i: number, extJson: string): void {
    this.refsC.update((l) => l.map((r, idx) => (idx === i ? { ...r, extJson, pickedId: '', pickedLabel: '' } : r)));
  }
  pickRefExt(i: number, catalogId: string): void {
    const r = this.refsC()[i];
    if (!r) return;
    const item = this.catalogs()[r.provider]?.items.find((it) => it.id === catalogId);
    const ext = this.extFromCatalogId(r.provider, catalogId);
    this.refsC.update((l) => l.map((x, idx) => (idx === i
      ? { ...x, extJson: JSON.stringify(ext), pickedId: catalogId, pickedLabel: item?.label ?? '' }
      : x)));
  }

  // ----- Номиналы -----

  private newDenom(): DenomDraft {
    return {
      id: 'd' + Math.random().toString(36).slice(2, 10),
      label: '',
      value: '',
      price: '',
      disabled: false,
      ext: {},
      picked: {},
      manual: {},
    };
  }

  addDenom(): void { this.denomsC.update((l) => [...l, this.newDenom()]); }
  removeDenom(i: number): void { this.denomsC.update((l) => l.filter((_, idx) => idx !== i)); }
  setDenomField(i: number, key: 'label' | 'value' | 'price', v: string): void {
    this.denomsC.update((l) => l.map((d, idx) => (idx === i ? { ...d, [key]: v } : d)));
  }
  setDenomDisabled(i: number, disabled: boolean): void {
    this.denomsC.update((l) => l.map((d, idx) => (idx === i ? { ...d, disabled } : d)));
  }
  setDenomManual(i: number, provider: string, manual: boolean): void {
    this.denomsC.update((l) => l.map((d, idx) => (idx === i
      ? { ...d, manual: { ...d.manual, [provider]: manual } }
      : d)));
  }
  setDenomExtJson(i: number, provider: string, extJson: string): void {
    this.denomsC.update((l) => l.map((d, idx) => {
      if (idx !== i) return d;
      const picked = { ...d.picked };
      delete picked[provider];
      return { ...d, ext: { ...d.ext, [provider]: extJson }, picked };
    }));
  }
  pickDenomExt(i: number, provider: string, catalogId: string): void {
    const item = this.catalogs()[provider]?.items.find((it) => it.id === catalogId);
    const ext = this.extFromCatalogId(provider, catalogId);
    this.denomsC.update((l) => l.map((d, idx) => (idx === i
      ? {
          ...d,
          ext: { ...d.ext, [provider]: JSON.stringify(ext) },
          picked: { ...d.picked, [provider]: { id: catalogId, label: item?.label ?? '' } },
        }
      : d)));
    // Подсказка из меты каталога: подставляем цену/номинал в пустые поля.
    const meta = item?.meta ?? {};
    const denomValue = Number(meta['value'] ?? meta['denomination']);
    this.denomsC.update((l) => l.map((d, idx) => {
      if (idx !== i) return d;
      const next = { ...d };
      if (!next.value.trim() && Number.isFinite(denomValue) && denomValue > 0) next.value = String(denomValue);
      return next;
    }));
  }

  // ----- CRUD -----

  openCreate(): void {
    this.current.set({});
    this.kindC.set('account_topup');
    this.nameC.set(''); this.slugC.set(''); this.descC.set(''); this.iconUrlC.set('');
    this.featuredC.set(false); this.sortC.set('0'); this.disablePurchaseC.set(false);
    this.issueCurC.set('RUB');
    this.refsC.set([this.newRef()]);
    this.amountCurC.set('RUB'); this.minAmountC.set('0'); this.maxAmountC.set('0');
    this.feePctC.set('0'); this.presetsC.set('');
    this.loginLabelC.set(''); this.loginHintC.set(''); this.loginPrefixC.set('');
    this.amountUnitC.set(''); this.amountLabelC.set('');
    this.denomCurC.set(''); this.denomsC.set([]);
    this.modeC.set('static'); this.markupC.set('30');
  }

  edit(p: AdminServiceProduct): void {
    this.current.set(p);
    this.kindC.set(p.kind);
    this.nameC.set(p.name); this.slugC.set(p.slug); this.descC.set(p.description ?? '');
    this.iconUrlC.set(p.icon_url ?? '');
    this.featuredC.set(!!p.featured); this.sortC.set(String(p.sort_order ?? 0));
    this.disablePurchaseC.set(!!p.disable_purchase);
    this.issueCurC.set(p.issue_currency || 'RUB');
    this.modeC.set(p.pricing_mode === 'dynamic' ? 'dynamic' : 'static');
    this.markupC.set(String(p.markup_pct ?? 30));
    this.refsC.set((p.providers ?? []).map((r: ServiceProviderRef) => ({
      provider: r.provider,
      extJson: r.ext && Object.keys(r.ext).length ? JSON.stringify(r.ext) : '',
      pickedId: '',
      pickedLabel: '',
      manual: false,
    })));
    this.amountCurC.set(p.amount_currency || 'RUB');
    this.minAmountC.set(String(p.min_amount ?? 0));
    this.maxAmountC.set(String(p.max_amount ?? 0));
    this.feePctC.set(String(p.fee_pct ?? 0));
    this.presetsC.set((p.amount_presets ?? []).join(', '));
    this.amountUnitC.set(p.amount_unit ?? '');
    this.amountLabelC.set(p.amount_label ?? '');
    this.loginLabelC.set(p.login_label ?? '');
    this.loginHintC.set(p.login_hint ?? '');
    this.loginPrefixC.set(p.login_prefix ?? '');
    this.denomCurC.set(p.denom_currency ?? '');
    // Редактор показывает номиналы в численном порядке (референс xbox.png).
    const denoms = [...(p.denominations ?? [])].sort((a, b) => a.value - b.value);
    this.denomsC.set(denoms.map((d) => ({
      id: d.id,
      label: d.label ?? '',
      value: String(d.value),
      price: String(d.price),
      disabled: !!d.disabled,
      ext: Object.fromEntries(Object.entries(d.providers ?? {}).map(([prov, ext]) => [prov, JSON.stringify(ext)])),
      picked: {},
      manual: {},
    })));
  }

  /** Пересчитать цены немедленно, не дожидаясь тика. */
  protected repriceNow(): void {
    this.repricing.set(true);
    this.api.refreshPricing().subscribe({
      next: (st) => {
        this.repricing.set(false);
        this.toast.success(`Пересчитано: ${st.updated} из ${st.scanned}`);
        this.refresh();
      },
      error: (e: unknown) => {
        this.repricing.set(false);
        this.toast.error(errorMessage(e, 'Не удалось пересчитать цены'));
      },
    });
  }

  /** Денежное пополнение: единица зачисления не задана ⇒ цена = сумма +
   *  «Комиссия, %», и динамический режим ему недоступен (бэкенд его отбивает). */
  protected readonly moneyTopup = computed(() => this.kindC() === 'account_topup' && !this.amountUnitC().trim());

  protected setKind(kind: AdminServiceProduct['kind']): void {
    this.kindC.set(kind);
    // Вид сменился на денежное пополнение — режим обязан стать статическим:
    // динамики у него нет, и форма не должна отправлять её на отказ.
    if (kind === 'account_topup' && !this.amountUnitC().trim()) this.modeC.set('static');
  }

  remove(p: AdminServiceProduct): void {
    if (!confirm(`Удалить «${p.name}»?`)) return;
    this.api.deleteServiceProduct(p.id!).subscribe({
      next: () => { this.toast.success('Удалено'); this.refresh(); },
      error: (e: unknown) => this.toast.error(errorMessage(e, 'Не удалось удалить')),
    });
  }

  /** Ext JSON черновика → map (null = невалидный JSON, блокирует сохранение). */
  private parseExt(extJson: string): Record<string, string> | null | undefined {
    const raw = extJson.trim();
    if (!raw) return undefined;
    try {
      const v = JSON.parse(raw) as unknown;
      if (!v || typeof v !== 'object' || Array.isArray(v)) return null;
      const ext: Record<string, string> = {};
      for (const [k, val] of Object.entries(v as Record<string, unknown>)) ext[k] = String(val);
      return ext;
    } catch {
      return null;
    }
  }

  save(): void {
    const cur = this.current();
    if (!cur) return;
    const kind = this.kindC();
    const name = this.nameC().trim();
    const slug = this.slugC().trim();
    // Slug не обязателен: пустой — бэкенд сгенерирует его из названия при создании.
    if (!name) { this.toast.error('Название обязательно'); return; }
    if (!this.issueCurC().trim()) { this.toast.error('Укажите валюту цен'); return; }

    const providers: ServiceProviderRef[] = [];
    for (const r of this.refsC()) {
      if (!r.provider) continue;
      const ext = this.parseExt(r.extJson);
      if (ext === null) { this.toast.error(`Невалидный ext JSON у провайдера ${r.provider}`); return; }
      providers.push(ext ? { provider: r.provider, ext } : { provider: r.provider });
    }

    const presets = this.presetsC()
      .split(',')
      .map((s) => parseFloat(s.trim()))
      .filter((n) => Number.isFinite(n) && n > 0);

    const denominations: AdminServiceDenomination[] = [];
    // Позиции есть у гифткарты (номиналы) и у подписки (планы) — форма у них
    // общая, различаются только подписи.
    if (kind !== 'account_topup') {
      for (const d of this.denomsC()) {
        const value = parseFloat(d.value);
        const price = parseFloat(d.price);
        const label = d.label.trim();
        const title = label || String(value);
        if (!(value > 0)) continue; // недозаполненная строка
        if (!(price >= 0)) { this.toast.error(`Позиция ${title}: укажите цену`); return; }
        const provs: Record<string, Record<string, string>> = {};
        for (const [prov, extJson] of Object.entries(d.ext)) {
          const ext = this.parseExt(extJson);
          if (ext === null) { this.toast.error(`Позиция ${title}: невалидный ext JSON (${prov})`); return; }
          if (ext) provs[prov] = ext;
        }
        denominations.push({
          id: d.id,
          // Пустое имя НЕ шлём: бэкенд тогда сохранит прежнее (импортированное),
          // а не затрёт его — то же правило, что у себестоимости.
          ...(label ? { label } : {}),
          value,
          price,
          ...(Object.keys(provs).length ? { providers: provs } : {}),
          ...(d.disabled ? { disabled: true } : {}),
        });
      }
      // Хранение — тоже в численном порядке (показ и так сортируется числом).
      denominations.sort((a, b) => a.value - b.value);
    }

    // Динамика доступна обоим видам: у гифткарты считается цена номинала, у
    // пополнения — цена единицы зачисления (себестоимость единицы приносит
    // импорт каталога).
    const dynamic = this.modeC() === 'dynamic';
    const markup = parseFloat(this.markupC());
    if (dynamic && !(markup >= 0)) { this.toast.error('Укажите наценку в процентах'); return; }

    // PATCH шлёт ПОЛНЫЙ набор whitelisted-полей (serviceProductPatch бэка):
    // kind/name/slug/description/icon_url/featured/sort_order/disable_purchase/
    // issue_currency/providers/amount_currency/min_amount/max_amount/fee_pct/
    // amount_presets/login_label/login_hint/denom_currency/denominations.
    // Исключение — пустой slug: его не шлём вовсе, иначе на UPDATE это выглядело бы
    // как явное «сделать slug пустым» (бэкенд меняет slug только по присланному значению).
    const body: Partial<AdminServiceProduct> = {
      kind,
      name,
      ...(slug ? { slug } : {}),
      description: this.descC(),
      icon_url: this.iconUrlC().trim(),
      featured: this.featuredC(),
      sort_order: parseInt(this.sortC(), 10) || 0,
      disable_purchase: this.disablePurchaseC(),
      // Динамика считается в рублях — валюту прайса бэкенд всё равно поставит
      // рублёвой, отправляем её же, чтобы форма и ответ не расходились.
      issue_currency: dynamic ? 'RUB' : this.issueCurC().trim(),
      providers,
      // Денежному пополнению режим всегда статический: единицу зачисления могли
      // очистить уже после выбора динамики, и бэкенд отбил бы сохранение.
      pricing_mode: this.moneyTopup() ? 'static' : this.modeC(),
      ...(dynamic ? { markup_pct: markup } : {}),
      // account_topup: валюта зачисления обязана совпадать с валютой прайса.
      amount_currency: this.amountCurC().trim(),
      min_amount: parseFloat(this.minAmountC()) || 0,
      max_amount: parseFloat(this.maxAmountC()) || 0,
      fee_pct: parseFloat(this.feePctC()) || 0,
      amount_presets: presets,
      login_label: this.loginLabelC().trim(),
      login_hint: this.loginHintC().trim(),
      login_prefix: this.loginPrefixC().trim(),
      amount_unit: this.amountUnitC().trim(),
      amount_label: this.amountLabelC().trim(),
      denom_currency: this.denomCurC().trim(),
      denominations,
    };
    this.saving.set(true);
    const obs = cur.id ? this.api.updateServiceProduct(cur.id, body) : this.api.createServiceProduct(body);
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
