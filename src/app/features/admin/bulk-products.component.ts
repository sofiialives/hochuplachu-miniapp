import { Component, computed, inject, input, output, signal } from '@angular/core';
import { Observable } from 'rxjs';
import {
  AdminApi, AdminEsimProduct, AdminServiceProduct, BulkPreview, PricingMode,
} from '../../core/api/admin.api';
import { ButtonComponent } from '../../ui/button.component';
import { InputComponent } from '../../ui/input.component';
import { ToastService } from '../../core/notifications/toast.service';
import { errorMessage } from '../../core/errors/api-error';

const PAGE_SIZE = 20;

/** Строка предпросмотра — общий минимум обоих типов продуктов. */
interface PreviewRow {
  id?: string;
  name: string;
  pricing_mode?: PricingMode;
  markup_pct?: number;
  disable_purchase: boolean;
  imported_from?: string;
}

/**
 * Массовое редактирование и удаление продуктов по регулярному выражению.
 *
 * Ключевое свойство: наружу уходит ТОЛЬКО регулярка и изменённые поля — набор
 * продуктов бэкенд каждый раз строит сам. Поэтому предпросмотр листается
 * постранично (весь каталог по сети не гоняем), а применение работает ровно по
 * тому же правилу отбора.
 *
 * Защита от расхождения: вместе с применением уходит количество из
 * предпросмотра. Если набор успел измениться (кто-то правил каталог
 * параллельно), бэкенд отвечает 409 и не делает НИЧЕГО — оператор подтверждал
 * другой список.
 */
@Component({
  selector: 'app-bulk-products',
  standalone: true,
  imports: [ButtonComponent, InputComponent],
  template: `
    <div class="panel">
      <p class="hint">
        Ищет по названию@if (productType() === 'service') { и slug'у }. Регистр не важен.
        <b>Пустое поле — все продукты.</b> Примеры: <code>^Turkey</code> — начинается с «Turkey»,
        <code>Xbox|PlayStation</code> — любое из двух. Изменятся только заполненные поля формы ниже.
      </p>

      <div class="row">
        <app-input class="grow" [(value)]="pattern" label="Регулярное выражение" placeholder="пусто — все продукты" />
        <app-button variant="secondary" [loading]="searching()" (clicked)="search(1)">Найти</app-button>
      </div>

      @if (preview(); as pv) {
        @if (stale()) {
          <p class="warn">Регулярка изменилась — нажмите «Найти», чтобы обновить список. Действия применяются к показанному набору.</p>
        }
        <div class="found">
          Найдено <b>{{ pv.total }}</b>
          @if (pv.total > pv.limit) { <span class="err"> — больше потолка {{ pv.limit }}, уточните регулярку</span> }
        </div>

        <table>
          <thead><tr><th>Название</th><th>Режим</th><th>Наценка</th><th>Источник</th><th>Статус</th></tr></thead>
          <tbody>
            @for (p of rows(); track p.id) {
              <tr>
                <td>{{ p.name }}</td>
                <td>{{ p.pricing_mode === 'dynamic' ? 'динамическая' : 'ручная' }}</td>
                <td>{{ p.pricing_mode === 'dynamic' ? (p.markup_pct ?? 0) + '%' : '—' }}</td>
                <td class="dim">{{ p.imported_from || 'вручную' }}</td>
                <td>
                  @if (p.disable_purchase) { <span class="dim">снят с продажи</span> }
                  @else { <span class="ok">в продаже</span> }
                </td>
              </tr>
            } @empty {
              <tr><td colspan="5" class="empty">Ничего не найдено</td></tr>
            }
          </tbody>
        </table>

        @if (pages() > 1) {
          <div class="pager">
            <button class="link" [disabled]="page() <= 1" (click)="search(page() - 1)">←</button>
            <span>{{ page() }} / {{ pages() }}</span>
            <button class="link" [disabled]="page() >= pages()" (click)="search(page() + 1)">→</button>
          </div>
        }

        @if (pv.total > 0) {
          <div class="edit">
            <p class="edit-title">Изменить у всех найденных <b>({{ pv.total }})</b></p>
            <div class="grid">
              <label class="fld">
                <span class="lbl">Режим цены</span>
                <select [value]="modeC()" (change)="modeC.set($any($event.target).value)">
                  <option value="">— не менять —</option>
                  <option value="static">ручная цена</option>
                  <option value="dynamic">динамическая</option>
                </select>
              </label>
              <app-input class="fld" [(value)]="markupC" inputmode="decimal" label="Наценка, %" placeholder="не менять" />
              <label class="fld">
                <span class="lbl">Продажа</span>
                <select [value]="saleC()" (change)="saleC.set($any($event.target).value)">
                  <option value="">— не менять —</option>
                  <option value="on">включить</option>
                  <option value="off">снять с продажи</option>
                </select>
              </label>
              <app-input class="fld" [(value)]="sortC" inputmode="numeric" label="Sort order" placeholder="не менять" />
            </div>
            @if (modeC() === 'dynamic') {
              <p class="warn">
                Динамическая цена считается в рублях, поэтому валюта прайса у всех найденных
                продуктов будет переставлена на RUB.
              </p>
            }
            <div class="actions">
              <app-button variant="primary" [loading]="applying()" (clicked)="apply()">
                Применить к {{ pv.total }}
              </app-button>
              <app-button variant="ghost" [loading]="deleting()" (clicked)="remove()">
                Удалить {{ pv.total }}
              </app-button>
            </div>
          </div>
        }
      }
    </div>
  `,
  styles: [`
    .hint { margin: 0 0 var(--space-sm); font-size: 12px; color: var(--color-muted); line-height: 1.5; }
    .hint code { background: var(--color-hairline); padding: 1px 5px; border-radius: 4px; font-size: 11px; }
    .row { display: flex; gap: 12px; align-items: flex-end; }
    .grow { flex: 1; }
    .found { margin: var(--space-sm) 0 6px; font-size: 13px; }
    table { width: 100%; border-collapse: collapse; }
    th, td { padding: 7px 10px; text-align: left; border-bottom: 1px solid var(--color-hairline); font-size: 13px; }
    th { color: var(--color-muted); font-weight: 500; font-size: 11px; text-transform: uppercase; letter-spacing: .04em; }
    .dim { color: var(--color-muted); }
    .ok { color: var(--color-success, #198754); }
    .err { color: var(--color-error); }
    .empty { text-align: center; color: var(--color-muted); padding: 16px; }
    .pager { display: flex; gap: 12px; align-items: center; justify-content: center; margin-top: 8px; font-size: 13px; }
    .link { background: none; border: none; color: var(--color-primary-ink); cursor: pointer; font: inherit; }
    .link:disabled { opacity: .35; cursor: default; }
    .edit { margin-top: var(--space-md); padding-top: var(--space-sm); border-top: 1px dashed var(--color-hairline); }
    .edit-title { margin: 0 0 var(--space-sm); font-size: 13px; }
    .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); gap: 12px; }
    .lbl { display: block; font-size: 12px; color: var(--color-muted); margin-bottom: 6px; }
    select {
      width: 100%; height: 40px; padding: 0 10px;
      border: 1px solid var(--color-hairline); border-radius: var(--rounded-sm, 6px);
      background: var(--color-canvas); color: var(--color-ink); font: inherit; font-size: 14px;
    }
    .warn { margin: var(--space-sm) 0 0; font-size: 12px; color: var(--color-warning, #b45309); }
    .actions { display: flex; gap: 12px; margin-top: var(--space-sm); }
  `],
})
export class BulkProductsComponent {
  private readonly api = inject(AdminApi);
  private readonly toast = inject(ToastService);

  readonly productType = input.required<'esim' | 'service'>();
  /** Набор изменился — странице пора перечитать список. */
  readonly changed = output<void>();

  protected readonly pattern = signal('');
  protected readonly page = signal(1);
  protected readonly searching = signal(false);
  protected readonly applying = signal(false);
  protected readonly deleting = signal(false);
  protected readonly preview = signal<BulkPreview<AdminEsimProduct | AdminServiceProduct> | null>(null);
  /** Регулярка, по которой построен ТЕКУЩИЙ предпросмотр. Применять надо
   *  именно её: оператор мог поправить поле после «Найти», и тогда правка
   *  ушла бы по другому набору, чем он видел на экране. */
  private readonly previewPattern = signal('');

  // Поля патча: пустая строка = «не менять».
  protected readonly modeC = signal<'' | PricingMode>('');
  protected readonly markupC = signal('');
  protected readonly saleC = signal<'' | 'on' | 'off'>('');
  protected readonly sortC = signal('');

  /** Поле разошлось с предпросмотром. */
  protected readonly stale = computed(() => this.pattern().trim() !== this.previewPattern());

  protected readonly rows = computed<PreviewRow[]>(() =>
    (this.preview()?.products ?? []).map((p) => ({
      id: p.id,
      name: p.name,
      pricing_mode: p.pricing_mode,
      markup_pct: p.markup_pct,
      disable_purchase: p.disable_purchase,
      imported_from: p.imported_from,
    })));

  protected readonly pages = computed(() => {
    const total = this.preview()?.total ?? 0;
    return Math.max(1, Math.ceil(total / PAGE_SIZE));
  });

  protected search(page: number): void {
    // Пустая регулярка = все продукты (решение оператора). От случайного
    // «снести всё» защищает подтверждение количества перед применением.
    const pattern = this.pattern().trim();
    this.searching.set(true);
    this.page.set(page);
    // Тип шире обоих ответов: дальше нас интересуют только общие поля строки.
    const req: Observable<BulkPreview<AdminEsimProduct | AdminServiceProduct>> =
      this.productType() === 'esim'
        ? this.api.bulkPreviewEsim(pattern, page, PAGE_SIZE)
        : this.api.bulkPreviewServices(pattern, page, PAGE_SIZE);
    req.subscribe({
      next: (r) => { this.searching.set(false); this.preview.set(r); this.previewPattern.set(pattern); },
      error: (e: unknown) => {
        this.searching.set(false);
        this.preview.set(null);
        this.toast.error(errorMessage(e, 'Не удалось выполнить поиск'));
      },
    });
  }

  /** Патч из заполненных полей формы. */
  private patch(): Record<string, unknown> {
    const patch: Record<string, unknown> = {};
    if (this.modeC()) patch['pricing_mode'] = this.modeC();
    const markup = parseFloat(this.markupC());
    if (this.markupC().trim() !== '' && Number.isFinite(markup)) patch['markup_pct'] = markup;
    if (this.saleC()) patch['disable_purchase'] = this.saleC() === 'off';
    const sort = parseInt(this.sortC(), 10);
    if (this.sortC().trim() !== '' && Number.isFinite(sort)) patch['sort_order'] = sort;
    return patch;
  }

  protected apply(): void {
    const pv = this.preview();
    if (!pv) return;
    const patch = this.patch();
    if (!Object.keys(patch).length) { this.toast.error('Заполните хотя бы одно поле для изменения'); return; }
    if (!confirm(`Изменить ${pv.total} продукт(ов)?`)) return;
    this.applying.set(true);
    const req = this.productType() === 'esim'
      ? this.api.bulkUpdateEsim(this.previewPattern(), patch, pv.total)
      : this.api.bulkUpdateServices(this.previewPattern(), patch, pv.total);
    req.subscribe({
      next: (r) => {
        this.applying.set(false);
        this.toast.success(`Изменено: ${r.updated ?? 0}`);
        this.changed.emit();
        this.search(this.page());
      },
      error: (e: unknown) => {
        this.applying.set(false);
        this.toast.error(errorMessage(e, 'Не удалось применить изменения'));
      },
    });
  }

  protected remove(): void {
    const pv = this.preview();
    if (!pv) return;
    // Удаление необратимо, поэтому подтверждаем количеством, а не «ок/отмена».
    if (!confirm(`Удалить ${pv.total} продукт(ов) без возможности восстановления?`)) return;
    this.deleting.set(true);
    const req = this.productType() === 'esim'
      ? this.api.bulkDeleteEsim(this.previewPattern(), pv.total)
      : this.api.bulkDeleteServices(this.previewPattern(), pv.total);
    req.subscribe({
      next: (r) => {
        this.deleting.set(false);
        this.toast.success(`Удалено: ${r.deleted ?? 0}`);
        this.preview.set(null);
        this.changed.emit();
      },
      error: (e: unknown) => {
        this.deleting.set(false);
        this.toast.error(errorMessage(e, 'Не удалось удалить'));
      },
    });
  }
}
