import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { AdminApi, ProviderCatalogItem, ProviderMeta, ProvidersMeta } from '../../core/api/admin.api';
import { CardProduct, CardProviderRef, productBins } from '../../core/api/cards.api';
import { ButtonComponent } from '../../ui/button.component';
import { InputComponent } from '../../ui/input.component';
import { DialogComponent } from '../../ui/dialog.component';
import { SearchableSelectComponent, SearchableSelectItem } from '../../ui/searchable-select.component';
import { ProviderTogglesComponent } from './provider-toggles.component';
import { ToastService } from '../../core/notifications/toast.service';
import { errorMessage } from '../../core/errors/api-error';
import { formatAmount } from '../../core/currency/currency-symbols';
import {
  SERVICE_ATTR_KEYS,
  SERVICE_ATTR_LABELS,
  ServiceAttr,
  serviceAttrIcon,
} from '../../core/constants/service-attrs';

/** Черновик провайдер-привязки выпуска (CardProduct.providers). Поля BIN
 *  остаются редактируемыми руками — fallback при недоступном каталоге. */
interface CardRefDraft {
  provider: string;
  bin_id: string;
  country: string;
  label: string;
}

@Component({
  selector: 'app-products-admin',
  standalone: true,
  imports: [ButtonComponent, InputComponent, DialogComponent, SearchableSelectComponent, ProviderTogglesComponent],
  template: `<h1>Карты-продукты</h1>
    <!-- Блок «Провайдеры» для card — read-only (единственный buvei, тумблер в
         этой итерации не показывается: секция каталога карт fail-open).
         Прячем, пока мета не загрузилась (старый бэк без /providers/meta). -->
    @if (cardProvidersMetaList().length) {
      <app-provider-toggles productType="card" [providers]="cardProvidersMetaList()" />
    }
    <div class="actions">
      <app-button variant="primary" (click)="openCreate()">+ Новая карта</app-button>
    </div>
    <table>
      <thead><tr><th>Название</th><th>Цена</th><th>Card cur</th><th>Статус</th><th>Sort</th><th></th></tr></thead>
      <tbody>
        @for (p of items(); track p.id) {
          <tr [class.disabled]="isAnyDisabled(p)">
            <td>{{ p.name }}</td>
            <td>{{ money(p.issue_price, p.issue_currency) }}</td>
            <td>{{ p.card_currency }}</td>
            <td>
              @if (isAnyDisabled(p)) {
                <span class="badge badge--warn">Ограничен ({{ disabledSummary(p) }})</span>
              } @else {
                <span class="active">Активен</span>
              }
              @if (!binsOf(p).length) {
                <span class="badge badge--warn">нет BIN</span>
              } @else {
                @if (binsOf(p).length > 1) {
                  <span class="badge">BIN × {{ binsOf(p).length }}</span>
                }
                @if (binsMissingCountry(p)) {
                  <span class="badge badge--warn">нет страны</span>
                }
              }
            </td>
            <td>{{ p.sort_order }}</td>
            <td>
              <button class="link" (click)="edit(p)">edit</button>
              <button class="link red" (click)="remove(p)">delete</button>
            </td>
          </tr>
        }
      </tbody>
    </table>

    @if (current(); as c) {
      <app-dialog [title]="c.id ? 'Изменить карту' : 'Новая карта'" (dismissed)="current.set(null)"
        (keydown.enter)="onEnterKey($event)">
        <app-input [(value)]="nameC" label="Название" />
        <app-input [(value)]="descC" label="Описание (Markdown)" />
        <app-input [(value)]="priceC" inputmode="decimal" label="Цена (включая 1-й год обслуживания)" />
        <app-input [(value)]="annualFeeC" inputmode="decimal" label="Годовое обслуживание (со 2-го года, 0 = бесплатно)" />
        <app-input [(value)]="validityYearsC" inputmode="numeric" label="Срок действия (лет, 0 = не показывать)" />
        <app-input [(value)]="issueCurC" label="Issue currency (USDT)" />
        <app-input [(value)]="cardCurC" label="Card currency (USD/EUR)" />
        <fieldset class="vis">
          <legend>Провайдер-привязки выпуска (провайдер + BIN)</legend>
          <p class="vis-hint">
            BIN — это cardBinId со стороны провайдера выпуска + ISO-код страны
            (HK / SG / GB; по нему пользователю показывается захардкоженная заглушка
            billing-адреса, пусто — адрес не показывается вовсе). BIN выбирается из каталога
            провайдер-сервиса; поля ниже остаются редактируемыми — ручной fallback, если
            каталог недоступен. <b>Первая привязка — по умолчанию</b>: под неё выпускаются
            все новые карты; остальные доступны только в админ-замене карты.
            Пустой список — выпуск карт по продукту невозможен (card.failed).
          </p>
          @for (b of provsC(); track $index; let i = $index) {
            <div class="bin-ref">
              <div class="bin-row">
                <span class="bin-row__badge" [class.bin-row__badge--default]="i === 0">{{ i === 0 ? 'по умолч.' : '#' + (i + 1) }}</span>
                <select class="bin-row__provider" [value]="b.provider" (change)="setProv(i, 'provider', $any($event.target).value)">
                  @for (p of cardProviders(); track p.code) {
                    <option [value]="p.code" [selected]="p.code === b.provider">{{ p.title }}</option>
                  }
                </select>
                <div class="bin-row__select">
                  <app-searchable-select
                    [items]="binCatalogItems(b.provider)"
                    [value]="b.bin_id"
                    [serverMode]="true"
                    [loading]="binCatalogLoading(b.provider)"
                    [limitNote]="catalogLimit"
                    [selectedLabel]="b.label || b.bin_id"
                    placeholder="— BIN из каталога провайдера —"
                    searchPlaceholder="Поиск BIN…"
                    (queryChanged)="searchBinCatalog(b.provider, $event)"
                    (valueChange)="pickBin(i, $event)" />
                </div>
                <button type="button" class="bin-row__btn" [disabled]="i === 0" (click)="moveBin(i, -1)" title="Выше">↑</button>
                <button type="button" class="bin-row__btn" [disabled]="i === provsC().length - 1" (click)="moveBin(i, 1)" title="Ниже">↓</button>
                <button type="button" class="bin-row__btn bin-row__btn--del" (click)="removeBin(i)" title="Удалить">×</button>
              </div>
              @if (binCatalogError(b.provider)) {
                <p class="bin-err">{{ binCatalogError(b.provider) }}</p>
              }
              <div class="bin-row bin-row--manual">
                <span class="bin-row__badge bin-row__badge--ghost">вручную</span>
                <input class="bin-row__input bin-row__input--id" type="text" placeholder="v_... (BIN ID)"
                  [value]="b.bin_id" (input)="setProv(i, 'bin_id', $any($event.target).value)" />
                <input class="bin-row__input bin-row__input--country" type="text" placeholder="HK"
                  [value]="b.country" (input)="setProv(i, 'country', $any($event.target).value)" />
                <input class="bin-row__input" type="text" placeholder="метка для админки (опц.)"
                  [value]="b.label" (input)="setProv(i, 'label', $any($event.target).value)" />
              </div>
            </div>
          }
          <app-button variant="ghost" (click)="addBin()">+ Добавить привязку</app-button>
        </fieldset>
        <app-input [(value)]="depositFeeC" inputmode="decimal" label="Deposit fee % (0.05)" />
        <app-input [(value)]="sortC" inputmode="numeric" label="Sort order" />

        <fieldset class="vis">
          <legend>Лимиты и комиссии транзакций ({{ cardCurC() || 'card_currency' }})</legend>
          <p class="vis-hint">Все суммы — в валюте карты. Поле 0 = без ограничения / без комиссии. Проценты задаются десятичной дробью: 0.02 = 2%.</p>
          <app-input [(value)]="minTopupAmountC" inputmode="decimal" label="Минимальный депозит" placeholder="50" />
          <app-input [(value)]="monthlyPurchaseLimitC" inputmode="decimal" label="Лимит покупок в месяц" placeholder="5000" />
          <app-input [(value)]="txFeeFixedC" inputmode="decimal" label="Стоимость транзакции в валюте" placeholder="0.30" />
          <app-input [(value)]="txFeePctC" inputmode="decimal" label="Стоимость транзакции в процентах (0.02 = 2%)" placeholder="0.02" />
          <app-input [(value)]="refundFeeFixedC" inputmode="decimal" label="Стоимость транзакции отмены в валюте" placeholder="0.50" />
          <app-input [(value)]="refundFeePctC" inputmode="decimal" label="Стоимость транзакции отмены в процентах" placeholder="0.03" />
        </fieldset>

        <fieldset class="vis">
          <legend>Карта-визуал</legend>
          <app-input [(value)]="imageUrlC" label="URL картинки карты" placeholder="https://… или /assets/cards/travel.png" />
          <app-input [(value)]="gradientC" label="CSS-фон карты (пресет blue/dark/gold, hex или gradient)" placeholder="linear-gradient(135deg, #2563eb, #0c1e5d)" />
        </fieldset>

        <fieldset class="vis">
          <legend>Фон страницы продукта</legend>
          <app-input [(value)]="bgImageUrlC" label="URL фона страницы" placeholder="https://…" />
          <app-input [(value)]="bgGradientC" label="CSS-фон страницы (опционально)" placeholder="linear-gradient(180deg, #fff8e1, #f8f9fa)" />
        </fieldset>

        <fieldset class="vis">
          <legend>Цвета шрифтов на странице карты</legend>
          <div class="colors">
            <label class="col-pick">
              <span class="col-pick__lbl">Заголовок (H)</span>
              <span class="col-pick__row">
                <input type="color" [value]="headingColorC() || '#2D1B14'" (input)="headingColorC.set($any($event.target).value)" />
                <input class="col-pick__hex" type="text" [value]="headingColorC()" (input)="headingColorC.set($any($event.target).value)" placeholder="#2D1B14" />
              </span>
            </label>
            <label class="col-pick">
              <span class="col-pick__lbl">Основной текст (Body)</span>
              <span class="col-pick__row">
                <input type="color" [value]="bodyColorC() || '#5C4538'" (input)="bodyColorC.set($any($event.target).value)" />
                <input class="col-pick__hex" type="text" [value]="bodyColorC()" (input)="bodyColorC.set($any($event.target).value)" placeholder="#5C4538" />
              </span>
            </label>
            <label class="col-pick">
              <span class="col-pick__lbl">CTA-кнопка</span>
              <span class="col-pick__row">
                <input type="color" [value]="ctaColorC() || '#D4823C'" (input)="ctaColorC.set($any($event.target).value)" />
                <input class="col-pick__hex" type="text" [value]="ctaColorC()" (input)="ctaColorC.set($any($event.target).value)" placeholder="#D4823C" />
              </span>
            </label>
          </div>
          <div class="col-pick__hint">Пусто = тема по умолчанию. CSS-color, обычно hex.</div>
        </fieldset>

        <label class="ta">
          <span class="ta-label">Преимущества (каждая строка — «Заголовок | Описание»)</span>
          <textarea rows="5" [value]="perksC()" (input)="perksC.set($any($event.target).value)" placeholder="Бронирование отелей | Booking, AirBnb, Trip.com"></textarea>
        </label>
        <label class="ta">
          <span class="ta-label">Списки (блоки разделены пустой строкой, первая строка блока — заголовок)</span>
          <textarea rows="6" [value]="listsC()" (input)="listsC.set($any($event.target).value)" placeholder="Условия выпуска&#10;Карта выдаётся моментально&#10;Лимит $5000 / месяц"></textarea>
        </label>
        <label class="ta">
          <span class="ta-label">Запрещено (каждая строка — отдельное правило)</span>
          <textarea rows="4" [value]="forbiddenC()" (input)="forbiddenC.set($any($event.target).value)" placeholder="Запрещены операции на санкционных территориях"></textarea>
        </label>

        <fieldset class="vis">
          <legend>Иконки сервисов</legend>
          <div class="attr-section">
            <div class="attr-title">Уровень 1 (мелкие plate-бейджи — платёжные системы)</div>
            <div class="attr-grid">
              @for (k of allKeys; track k) {
                <label class="attr-chip" [class.attr-chip--on]="tier1().has(k)">
                  <input type="checkbox" [checked]="tier1().has(k)" (change)="toggle(1, k)" />
                  <img [src]="iconFor(k)" [alt]="labelFor(k)" />
                  <span>{{ labelFor(k) }}</span>
                </label>
              }
            </div>
          </div>
          <div class="attr-section">
            <div class="attr-title">Уровень 2 (большие круглые — сервисы)</div>
            <div class="attr-grid">
              @for (k of allKeys; track k) {
                <label class="attr-chip" [class.attr-chip--on]="tier2().has(k)">
                  <input type="checkbox" [checked]="tier2().has(k)" (change)="toggle(2, k)" />
                  <img [src]="iconFor(k)" [alt]="labelFor(k)" />
                  <span>{{ labelFor(k) }}</span>
                </label>
              }
            </div>
          </div>
        </fieldset>

        <fieldset class="vis">
          <legend>Статус и доступность</legend>
          <ul class="status-checks">
            <li class="status-checks__row--warn">
              <label>
                <input type="checkbox" [checked]="disablePurchaseC()" (change)="disablePurchaseC.set($any($event.target).checked)" />
                <span><b>Отключить покупку</b> — продукт пропадает из каталога и карусели; на странице продукта (по прямой ссылке) кнопка «Выпустить карту» становится недоступной. Backend режет POST /orders/issue с кодом PURCHASE_DISABLED.</span>
              </label>
            </li>
            <li class="status-checks__row--warn">
              <label>
                <input type="checkbox" [checked]="disableTopupC()" (change)="disableTopupC.set($any($event.target).checked)" />
                <span><b>Отключить пополнение</b> — у пользователя кнопка «Пополнить» неактивна, под картой на home — плашка «Ограниченное использование». Backend режет POST /cards/:id/topup с кодом TOPUP_DISABLED. Карты продолжают работать в пределах текущего баланса.</span>
              </label>
            </li>
          </ul>
        </fieldset>

        <app-button variant="primary" [full]="true" (click)="save()">Сохранить</app-button>
      </app-dialog>
    }`,
  styles: [`
    .actions { margin-bottom: var(--space-md); }
    table { width: 100%; border-collapse: collapse; }
    th, td { padding: 10px 12px; text-align: left; border-bottom: 1px solid var(--color-hairline); }
    tr.disabled { background: color-mix(in srgb, var(--color-danger, #dc3545) 5%, transparent); }
    .link { color: var(--color-primary-ink); margin-right: 8px; }
    .link.red { color: var(--color-error); }
    .check { display: flex; gap: 8px; align-items: center; margin: var(--space-sm) 0; }

    /* Бейдж статуса — повторяем стиль users-admin: warn = ограничения
       (disable_*), off = скрыт (Active=false), активен = зелёный текст. */
    .badge {
      display: inline-block; padding: 3px 8px; border-radius: 999px;
      font-size: 12px; font-weight: 500;
    }
    .badge--warn {
      background: color-mix(in srgb, var(--color-warning, #f59e0b) 14%, transparent);
      color: var(--color-warning, #b45309);
    }
    .badge + .badge, .active + .badge { margin-left: 6px; }
    .active { color: var(--color-success, #198754); font-size: 13px; }

    /* Чекбоксы статуса в диалоге — паттерн users-admin: каждый чекбокс в
       рамке-карточке, при включении подсвечивается варн-цветом для disable_*. */
    .status-checks { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: var(--space-sm); }
    .status-checks label { display: flex; gap: var(--space-sm); align-items: flex-start; cursor: pointer; padding: 10px; border: 1px solid var(--color-hairline); border-radius: var(--rounded-sm); }
    .status-checks label:has(input:checked) { border-color: var(--color-primary); background: color-mix(in srgb, var(--color-primary) 4%, transparent); }
    .status-checks__row--warn label:has(input:checked) {
      border-color: var(--color-warning, #f59e0b);
      background: color-mix(in srgb, var(--color-warning, #f59e0b) 5%, transparent);
    }
    .status-checks input { margin-top: 2px; }
    .status-checks__row--warn input { accent-color: var(--color-warning, #f59e0b); }
    .status-checks span { font-size: 13px; line-height: 1.4; }
    .ta { display: flex; flex-direction: column; gap: 6px; margin: var(--space-sm) 0; }
    .ta-label { font-size: 13px; color: var(--color-muted); font-weight: 500; }
    .ta textarea {
      padding: 10px 14px;
      border-radius: var(--rounded-md);
      background: var(--color-canvas);
      color: var(--color-ink);
      font-size: 14px;
      font-family: inherit;
      line-height: 1.4;
      border: 1px solid var(--color-hairline);
      resize: vertical;
      min-height: 80px;
    }
    .ta textarea:focus { outline: none; border-color: var(--color-primary); box-shadow: 0 0 0 3px color-mix(in srgb, var(--color-primary) 25%, transparent); }

    .vis {
      border: 1px solid var(--color-hairline);
      border-radius: var(--rounded-md);
      padding: var(--space-sm) var(--space-md);
      margin: var(--space-sm) 0;
    }
    .vis legend { font-size: 12px; color: var(--color-muted); padding: 0 6px; font-weight: 600; }
    .vis-hint { margin: 0 0 var(--space-sm); font-size: 12px; color: var(--color-muted); line-height: 1.45; }

    /* Редактор провайдер-привязок: карточка = строка «провайдер + BIN из
       каталога + порядок/удаление» и строка ручного ввода (fallback при
       недоступном каталог-прокси). Первая привязка подсвечена — дефолт. */
    .bin-ref { border: 1px dashed var(--color-hairline); border-radius: var(--rounded-md); padding: 8px; margin-bottom: 10px; }
    .bin-ref .bin-row { margin-bottom: 0; }
    .bin-ref .bin-row--manual { margin-top: 6px; }
    .bin-row__provider {
      flex: 0 0 130px; height: 36px; padding: 0 8px;
      border: 1px solid var(--color-hairline); border-radius: var(--rounded-sm, 6px);
      background: var(--color-canvas); color: var(--color-ink); font: inherit; font-size: 13px;
    }
    .bin-row__select { flex: 1; min-width: 0; }
    .bin-row__badge--ghost { border-style: dotted; opacity: .8; }
    .bin-err { margin: 6px 0 0; font-size: 12px; color: var(--color-error); }
    .bin-row { display: flex; gap: 6px; align-items: center; margin-bottom: 8px; }
    .bin-row__badge {
      flex: 0 0 72px; text-align: center;
      font-size: 11px; color: var(--color-muted);
      padding: 4px 0; border: 1px dashed var(--color-hairline); border-radius: 999px;
    }
    .bin-row__badge--default {
      color: var(--color-primary-ink); border-color: var(--color-primary); border-style: solid;
      font-weight: 600;
    }
    .bin-row__input {
      flex: 1; min-width: 0;
      padding: 8px 10px;
      border: 1px solid var(--color-hairline);
      border-radius: var(--rounded-sm, 6px);
      background: var(--color-canvas); color: var(--color-ink);
      font-size: 13px;
    }
    .bin-row__input--id { flex: 2; font-family: var(--font-mono, monospace); }
    .bin-row__input--country { flex: 0 0 64px; text-transform: uppercase; }
    .bin-row__input:focus { outline: none; border-color: var(--color-primary); }
    .bin-row__btn {
      flex: 0 0 28px; height: 28px;
      border: 1px solid var(--color-hairline); border-radius: var(--rounded-sm, 6px);
      background: var(--color-canvas); color: var(--color-muted); cursor: pointer;
      font-size: 13px; line-height: 1;
    }
    .bin-row__btn:disabled { opacity: .35; cursor: default; }
    .bin-row__btn--del { color: var(--color-error); }

    .attr-section + .attr-section { margin-top: var(--space-md); }
    .attr-title { font-size: 12px; color: var(--color-muted); margin-bottom: 8px; font-weight: 600; }
    .attr-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(110px, 1fr));
      gap: 8px;
    }
    .attr-chip {
      display: flex; align-items: center; gap: 8px;
      padding: 8px 10px;
      border: 1px solid var(--color-hairline);
      border-radius: var(--rounded-md);
      background: var(--color-canvas);
      cursor: pointer;
      transition: border-color .12s ease, background .12s ease;
    }
    .attr-chip:hover { border-color: var(--color-primary); }
    .attr-chip--on {
      border-color: var(--color-primary);
      background: color-mix(in srgb, var(--color-primary) 8%, var(--color-canvas));
    }
    .attr-chip input { margin: 0; }
    .attr-chip img { width: 20px; height: 20px; object-fit: contain; }
    .attr-chip span { font-size: 12px; }

    .colors {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
      gap: var(--space-sm);
    }
    .col-pick { display: flex; flex-direction: column; gap: 6px; }
    .col-pick__lbl { font-size: 12px; color: var(--color-muted); font-weight: 600; }
    .col-pick__row { display: flex; gap: 8px; align-items: center; }
    .col-pick__row input[type="color"] {
      width: 44px; height: 36px;
      padding: 0; border: 1px solid var(--color-hairline);
      border-radius: var(--rounded-sm, 6px);
      background: var(--color-canvas);
      cursor: pointer;
    }
    .col-pick__hex {
      flex: 1; min-width: 0;
      padding: 8px 10px;
      border: 1px solid var(--color-hairline);
      border-radius: var(--rounded-sm, 6px);
      font-family: var(--font-mono, inherit);
      font-size: 13px;
      background: var(--color-canvas);
      color: var(--color-ink);
    }
    .col-pick__hex:focus { outline: none; border-color: var(--color-primary); }
    .col-pick__hint { font-size: 12px; color: var(--color-muted); margin-top: 8px; }
  `],
})
export class ProductsAdminPage implements OnInit {
  private readonly api = inject(AdminApi);
  private readonly toast = inject(ToastService);

  protected readonly items = signal<CardProduct[]>([]);
  protected readonly current = signal<Partial<CardProduct> | null>(null);
  protected readonly nameC = signal('');
  protected readonly descC = signal('');
  protected readonly priceC = signal('');
  protected readonly annualFeeC = signal('0');
  // validity_years — срок действия карты в годах, справочное поле каталога.
  // 0 = не задан: строка «Срок действия» на странице продукта и в лендингах
  // не показывается.
  protected readonly validityYearsC = signal('0');
  protected readonly issueCurC = signal('USDT');
  protected readonly cardCurC = signal('USD');
  // provsC — редактируемый список провайдер-привязок выпуска
  // (CardProduct.providers). Порядок значим: первая — привязка по умолчанию.
  // Пустой список = выпуск карт по продукту падает card.failed, таблица
  // подсвечивает «нет BIN». Обновляется заменой массива (zoneless).
  protected readonly provsC = signal<CardRefDraft[]>([]);
  // Провайдеры card из /admin/providers/meta (селект строки привязки).
  protected readonly providersMeta = signal<ProvidersMeta | null>(null);
  // Список для read-only блока «Провайдеры» (пусто, пока мета не пришла).
  protected readonly cardProvidersMetaList = computed<ProviderMeta[]>(() =>
    this.providersMeta()?.product_types?.['card'] ?? []);
  protected readonly cardProviders = computed<ProviderMeta[]>(() => {
    const list = this.providersMeta()?.product_types?.['card'] ?? [];
    // Мета ещё не загрузилась / бэк старый — единственный buvei как fallback,
    // чтобы селект провайдера не оказался пустым.
    return list.length ? list : [{ code: 'buvei', title: 'Buvei', enabled: true }];
  });
  // Каталог BIN'ов per provider (общий на все строки редактора).
  protected readonly binCatalogs = signal<Record<string, { items: ProviderCatalogItem[]; loading: boolean; error: string }>>({});
  protected readonly catalogLimit = 50;
  protected readonly imageUrlC = signal('');
  protected readonly gradientC = signal('blue');
  protected readonly bgImageUrlC = signal('');
  protected readonly bgGradientC = signal('');
  protected readonly headingColorC = signal('');
  protected readonly bodyColorC = signal('');
  protected readonly ctaColorC = signal('');
  protected readonly depositFeeC = signal('0.05');
  protected readonly sortC = signal('0');
  // Лимиты и комиссии транзакций — все в card_currency. 0 / пусто = не задано.
  // Проценты — десятичной дробью (0.02 = 2%).
  protected readonly minTopupAmountC = signal('0');
  protected readonly monthlyPurchaseLimitC = signal('0');
  protected readonly txFeeFixedC = signal('0');
  protected readonly txFeePctC = signal('0');
  protected readonly refundFeeFixedC = signal('0');
  protected readonly refundFeePctC = signal('0');
  // disablePurchaseC / disableTopupC — независимые тумблеры доступности
  // продукта. Снятие галочки одной не отменяет другую — комбинируются как у
  // User.Blocked* (см. users-admin). Дефолт false (доступно). Эффекты на UI
  // и backend описаны в подсказках самих чекбоксов и моделях (models.go).
  protected readonly disablePurchaseC = signal(false);
  protected readonly disableTopupC = signal(false);
  // perks/lists/forbidden — текстовое представление для textarea.
  // Парсятся в parsePerks/parseLists/parseForbidden при save().
  protected readonly perksC = signal('');
  protected readonly listsC = signal('');
  protected readonly forbiddenC = signal('');
  // tier1/tier2 — наборы выбранных ключей в signal, обновляем заменой Set'а
  // (в zoneless Angular читаем .has() через `tier1()` чтобы биндинги
  // пересчитывались при изменении).
  protected readonly tier1 = signal<Set<ServiceAttr>>(new Set());
  protected readonly tier2 = signal<Set<ServiceAttr>>(new Set());

  protected readonly allKeys = SERVICE_ATTR_KEYS;

  ngOnInit(): void {
    this.refresh();
    this.api.providersMeta().subscribe({
      next: (m) => this.providersMeta.set(m),
      // Мета недоступна (старый бэк) — работает fallback [buvei] в computed.
      error: () => undefined,
    });
  }
  refresh(): void {
    this.api.listProducts().subscribe({
      next: (r) => this.items.set(r.products),
      error: (e) => this.toast.error(errorMessage(e, 'Не удалось загрузить продукты')),
    });
  }

  /** BIN'ы продукта для бейджей таблицы (источник правды — providers). */
  protected binsOf(p: CardProduct): { bin_id: string; country: string }[] {
    return productBins(p);
  }

  iconFor(k: ServiceAttr): string { return serviceAttrIcon(k); }
  labelFor(k: ServiceAttr): string { return SERVICE_ATTR_LABELS[k] ?? k; }

  // isAnyDisabled / disabledSummary — кратко описывают комбинацию ограничений
  // продукта в строке таблицы. Скрытый (Active=false) обрабатывается отдельно
  // — он перебивает любые disable_* (продукт не отдаётся в API вообще).
  protected isAnyDisabled(p: CardProduct): boolean {
    return !!p.disable_purchase || !!p.disable_topup;
  }
  protected disabledSummary(p: CardProduct): string {
    const parts: string[] = [];
    if (p.disable_purchase) parts.push('покупка');
    if (p.disable_topup) parts.push('пополнение');
    return parts.join(', ');
  }

  // binsMissingCountry — есть BIN'ы без страны: у карт под ними пользователь
  // не увидит billing-заглушку (fail-closed) — подсвечиваем в таблице.
  protected binsMissingCountry(p: CardProduct): boolean {
    return productBins(p).some((b) => !b.country);
  }

  // ----- Редактор провайдер-привязок (провайдер + BIN) -----

  addBin(): void {
    const provider = this.cardProviders()[0]?.code ?? 'buvei';
    this.provsC.update((l) => [...l, { provider, bin_id: '', country: '', label: '' }]);
  }
  removeBin(i: number): void { this.provsC.update((l) => l.filter((_, idx) => idx !== i)); }
  moveBin(i: number, delta: -1 | 1): void {
    this.provsC.update((l) => {
      const j = i + delta;
      if (j < 0 || j >= l.length) return l;
      const next = [...l];
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });
  }
  setProv(i: number, key: keyof CardRefDraft, value: string): void {
    this.provsC.update((l) => l.map((b, idx) => {
      if (idx !== i) return b;
      // Смена провайдера сбрасывает BIN — идентификатор чужого невалиден.
      if (key === 'provider' && value !== b.provider) {
        return { ...b, provider: value, bin_id: '', country: '', label: '' };
      }
      return { ...b, [key]: value };
    }));
  }

  // Каталог BIN'ов провайдера (серверный поиск ?q= каталог-прокси). Ошибка
  // каталога не блокирует форму — поля ручного ввода всегда доступны.
  protected binCatalogItems(provider: string): SearchableSelectItem[] {
    const st = this.binCatalogs()[provider];
    return (st?.items ?? []).slice(0, this.catalogLimit).map((it) => ({
      id: it.id,
      label: it.label + (it.meta?.['country'] ? ` · ${it.meta['country']}` : ''),
    }));
  }
  protected binCatalogLoading(provider: string): boolean { return !!this.binCatalogs()[provider]?.loading; }
  protected binCatalogError(provider: string): string { return this.binCatalogs()[provider]?.error ?? ''; }

  searchBinCatalog(provider: string, q: string): void {
    if (!provider) return;
    this.binCatalogs.update((m) => ({ ...m, [provider]: { items: m[provider]?.items ?? [], loading: true, error: '' } }));
    this.api.providerCatalog('card', provider, q).subscribe({
      next: (r) => this.binCatalogs.update((m) => ({ ...m, [provider]: { items: r.items ?? [], loading: false, error: '' } })),
      error: (e: unknown) => this.binCatalogs.update((m) => ({
        ...m,
        [provider]: { items: [], loading: false, error: errorMessage(e, 'Каталог провайдера недоступен — заполните BIN вручную') },
      })),
    });
  }

  pickBin(i: number, binId: string): void {
    const row = this.provsC()[i];
    const item = this.binCatalogs()[row?.provider ?? '']?.items.find((it) => it.id === binId);
    this.provsC.update((l) => l.map((b, idx) => {
      if (idx !== i) return b;
      const country = String(item?.meta?.['country'] ?? '').toUpperCase();
      return {
        ...b,
        bin_id: binId,
        country: country || b.country,
        label: item?.label && item.label !== binId ? item.label : b.label,
      };
    }));
  }

  toggle(tier: 1 | 2, k: ServiceAttr): void {
    const target = tier === 1 ? this.tier1 : this.tier2;
    target.update((s) => {
      const next = new Set(s);
      if (next.has(k)) next.delete(k); else next.add(k);
      return next;
    });
  }

  openCreate(): void {
    this.current.set({});
    this.nameC.set(''); this.descC.set(''); this.priceC.set(''); this.annualFeeC.set('0');
    this.validityYearsC.set('0');
    this.issueCurC.set('USDT'); this.cardCurC.set('USD');
    this.provsC.set([]);
    this.imageUrlC.set(''); this.gradientC.set('blue');
    this.bgImageUrlC.set(''); this.bgGradientC.set('');
    this.headingColorC.set(''); this.bodyColorC.set(''); this.ctaColorC.set('');
    this.depositFeeC.set('0.05'); this.sortC.set('0');
    this.minTopupAmountC.set('0'); this.monthlyPurchaseLimitC.set('0');
    this.txFeeFixedC.set('0'); this.txFeePctC.set('0');
    this.refundFeeFixedC.set('0'); this.refundFeePctC.set('0');
    this.disablePurchaseC.set(false); this.disableTopupC.set(false);
    this.perksC.set(''); this.listsC.set(''); this.forbiddenC.set('');
    this.tier1.set(new Set()); this.tier2.set(new Set());
  }
  edit(p: CardProduct): void {
    this.current.set(p);
    this.nameC.set(p.name); this.descC.set(p.description); this.priceC.set(String(p.issue_price));
    this.annualFeeC.set(String(p.annual_service_fee ?? 0));
    this.validityYearsC.set(String(p.validity_years ?? 0));
    this.issueCurC.set(p.issue_currency); this.cardCurC.set(p.card_currency);
    // Источник правды — providers; legacy bins (старый бэк в окно деплоя)
    // конвертируется в привязки с provider='buvei' (зеркало миграции бэка).
    const refs: CardProviderRef[] = (p.providers ?? []).length
      ? p.providers!
      : (p.bins ?? []).map((b) => ({ provider: 'buvei', bin_id: b.bin_id, country: b.country, label: b.label }));
    this.provsC.set(refs.map((r) => ({
      provider: r.provider || 'buvei',
      bin_id: r.bin_id,
      country: r.country ?? '',
      label: r.label ?? '',
    })));
    this.imageUrlC.set(p.image_url ?? ''); this.gradientC.set(p.gradient);
    this.bgImageUrlC.set(p.bg_image_url ?? ''); this.bgGradientC.set(p.bg_gradient ?? '');
    this.headingColorC.set(p.heading_color ?? ''); this.bodyColorC.set(p.body_color ?? ''); this.ctaColorC.set(p.cta_color ?? '');
    this.depositFeeC.set(String(p.deposit_fee_pct)); this.sortC.set(String(p.sort_order));
    this.minTopupAmountC.set(String(p.min_topup_amount ?? 0));
    this.monthlyPurchaseLimitC.set(String(p.monthly_purchase_limit ?? 0));
    this.txFeeFixedC.set(String(p.tx_fee_fixed ?? 0));
    this.txFeePctC.set(String(p.tx_fee_pct ?? 0));
    this.refundFeeFixedC.set(String(p.refund_fee_fixed ?? 0));
    this.refundFeePctC.set(String(p.refund_fee_pct ?? 0));
    this.disablePurchaseC.set(!!p.disable_purchase); this.disableTopupC.set(!!p.disable_topup);
    this.perksC.set(this.formatPerks(p.perks));
    this.listsC.set(this.formatLists(p.lists));
    this.forbiddenC.set(this.formatForbidden(p.forbidden));
    const t1 = new Set<ServiceAttr>();
    for (const k of (p.tier1_attrs ?? [])) if (this.isKnownKey(k)) t1.add(k);
    this.tier1.set(t1);
    const t2 = new Set<ServiceAttr>();
    for (const k of (p.tier2_attrs ?? [])) if (this.isKnownKey(k)) t2.add(k);
    this.tier2.set(t2);
  }
  remove(p: CardProduct): void {
    if (!confirm(`Удалить «${p.name}»?`)) return;
    this.api.deleteProduct(p.id).subscribe({
      next: () => { this.toast.success('Удалено'); this.refresh(); },
      error: (e) => this.toast.error(errorMessage(e, 'Не удалось удалить')),
    });
  }
  // Enter в диалоге сохраняет форму — но не внутри textarea, где Enter должен
  // вставлять перевод строки. Важно возвращать void, а не false: Angular на
  // возврат false из обработчика зовёт preventDefault(), что съедало перевод
  // строки в многострочных полях (perks/lists/forbidden).
  protected onEnterKey(event: Event): void {
    if ((event.target as HTMLElement).tagName === 'TEXTAREA') return;
    this.save();
  }

  save(): void {
    const body: Partial<CardProduct> = {
      name: this.nameC(),
      description: this.descC(),
      issue_price: parseFloat(this.priceC()),
      annual_service_fee: parseFloat(this.annualFeeC()) || 0,
      validity_years: parseInt(this.validityYearsC(), 10) || 0,
      issue_currency: this.issueCurC(),
      card_currency: this.cardCurC(),
      // Пустые bin_id отбрасываем (недозаполненные строки редактора);
      // страна нормализуется в upper-case, пустая метка не сохраняется.
      // Источник правды — providers; legacy `bins` больше не отправляем
      // (бэк деривирует BinList из providers).
      providers: this.provsC()
        .map((b) => ({
          provider: b.provider || 'buvei',
          bin_id: b.bin_id.trim(),
          country: b.country.trim().toUpperCase(),
          ...(b.label.trim() ? { label: b.label.trim() } : {}),
        }))
        .filter((b) => b.bin_id),
      image_url: this.imageUrlC(),
      gradient: this.gradientC(),
      bg_image_url: this.bgImageUrlC(),
      bg_gradient: this.bgGradientC(),
      heading_color: this.headingColorC(),
      body_color: this.bodyColorC(),
      cta_color: this.ctaColorC(),
      deposit_fee_pct: parseFloat(this.depositFeeC()),
      sort_order: parseInt(this.sortC(), 10) || 0,
      min_topup_amount: parseFloat(this.minTopupAmountC()) || 0,
      monthly_purchase_limit: parseFloat(this.monthlyPurchaseLimitC()) || 0,
      tx_fee_fixed: parseFloat(this.txFeeFixedC()) || 0,
      tx_fee_pct: parseFloat(this.txFeePctC()) || 0,
      refund_fee_fixed: parseFloat(this.refundFeeFixedC()) || 0,
      refund_fee_pct: parseFloat(this.refundFeePctC()) || 0,
      disable_purchase: this.disablePurchaseC(),
      disable_topup: this.disableTopupC(),
      perks: this.parsePerks(this.perksC()),
      lists: this.parseLists(this.listsC()),
      forbidden: this.parseForbidden(this.forbiddenC()),
      tier1_attrs: Array.from(this.tier1()),
      tier2_attrs: Array.from(this.tier2()),
    };
    const cur = this.current()!;
    const obs = cur.id ? this.api.updateProduct(cur.id, body) : this.api.createProduct(body);
    obs.subscribe({
      next: () => { this.toast.success('Сохранено'); this.current.set(null); this.refresh(); },
      error: (e) => this.toast.error(errorMessage(e, 'Не удалось сохранить')),
    });
  }

  private isKnownKey(k: string): k is ServiceAttr {
    return (SERVICE_ATTR_KEYS as readonly string[]).includes(k);
  }

  // ===== perks/lists/forbidden — парсинг и форматирование =====

  // Формат perks: каждая непустая строка — «Заголовок | Описание».
  // Если разделителя нет — описание пустое.
  private parsePerks(s: string): [string, string][] {
    return s.split('\n').map((l) => l.trim()).filter(Boolean).map((line) => {
      const idx = line.indexOf('|');
      if (idx < 0) return [line, ''] as [string, string];
      return [line.slice(0, idx).trim(), line.slice(idx + 1).trim()] as [string, string];
    });
  }
  private formatPerks(p: [string, string][] | null | undefined): string {
    return (p ?? []).map((it) => `${it[0]} | ${it[1] ?? ''}`).join('\n');
  }

  // Формат lists: блоки разделены пустой строкой; первая строка блока —
  // заголовок, остальные строки блока — пункты. На выходе массив
  // [заголовок, item1, item2, ...].
  private parseLists(s: string): string[][] {
    return s.split(/\n\s*\n/).map((block) => block.split('\n').map((l) => l.trim()).filter(Boolean)).filter((b) => b.length > 0);
  }
  private formatLists(lists: string[][] | null | undefined): string {
    return (lists ?? []).map((block) => block.join('\n')).join('\n\n');
  }

  // Формат forbidden: каждая непустая строка — отдельный пункт.
  private parseForbidden(s: string): string[] {
    return s.split('\n').map((l) => l.trim()).filter(Boolean);
  }
  private formatForbidden(items: string[] | null | undefined): string {
    return (items ?? []).join('\n');
  }

  protected money(v: number | string | null | undefined, c: string | null | undefined): string {
    return formatAmount(v, c);
  }
}
