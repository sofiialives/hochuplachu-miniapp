import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { AdminApi, AdminPaymentMethod, PaymentMethodsMeta } from '../../core/api/admin.api';
import { ButtonComponent } from '../../ui/button.component';
import { InputComponent } from '../../ui/input.component';
import { DialogComponent } from '../../ui/dialog.component';
import { ToggleComponent } from '../../ui/toggle.component';
import { ToastService } from '../../core/notifications/toast.service';
import { errorMessage } from '../../core/errors/api-error';
import { currencyLabel } from '../../core/currency/currency-symbols';

// Методы оплаты: какие валюты доступны для покупки карты и для
// пополнения/продления (вкладки = scope), каким провайдером обслуживаются
// (Coincat / Kassa.ai-СБП) и при каких условиях доступны пользователю.
// Условия (справочник с бэка, /admin/payment-methods/meta) объединяются
// по И; включённая, но недоступная юзеру валюта показывается в приложении
// отключённой с серой подписью (condition_note).
@Component({
  selector: 'app-payment-methods-admin',
  standalone: true,
  imports: [ButtonComponent, InputComponent, DialogComponent, ToggleComponent],
  template: `<h1>Методы оплаты</h1>
    <div class="tabs">
      @for (s of meta()?.scopes ?? defaultScopes; track s.id) {
        <button class="tab" [class.active]="scope() === s.id" (click)="scope.set(s.id)">{{ s.label }}</button>
      }
    </div>

    <!-- Селектор типа продукта: глобальные строки ('') действуют на все типы;
         card|esim|service — переопределения по валюте (override с
         enabled=false скрывает валюту для типа). -->
    <div class="segments">
      @for (t of productTypes(); track t.id) {
        <button class="seg" [class.active]="ptype() === t.id" (click)="ptype.set(t.id)">{{ t.label }}</button>
      }
    </div>

    <div class="toolbar">
      <app-button variant="primary" (clicked)="openCreate()">+ Добавить валюту</app-button>
      <p class="hint">Порядок строк = порядок валют на экране оплаты (per scope × тип).</p>
    </div>

    <table>
      <thead><tr>
        <th></th><th>Валюта</th><th>Провайдер</th><th>Условия доступности</th><th>Подпись условия</th><th>Вкл</th><th></th>
      </tr></thead>
      <tbody>
        @for (m of scoped(); track m.id; let i = $index) {
          <tr [class.row-off]="!m.enabled">
            <td class="order-cell">
              <button class="link" [disabled]="i === 0" (click)="move(m, -1)">↑</button>
              <button class="link" [disabled]="i === scoped().length - 1" (click)="move(m, 1)">↓</button>
            </td>
            <td><code>{{ m.currency_id }}</code> <span class="muted">{{ currencyName(m.currency_id) }}</span></td>
            <td>{{ providerLabel(m.provider) }}</td>
            <td>{{ conditionsSummary(m) }}</td>
            <td class="note-cell">{{ m.condition_note || '—' }}</td>
            <td><app-toggle [checked]="m.enabled" (toggled)="toggleEnabled(m, $event)" /></td>
            <td>
              <button class="link" (click)="edit(m)">edit</button>
              <button class="link red" (click)="remove(m)">delete</button>
            </td>
          </tr>
        } @empty {
          <tr><td colspan="7" class="empty">
            @if (ptype() === '') { Валют в этом списке нет — пользователю нечем платить }
            @else { Переопределений для типа нет — действуют глобальные строки ниже }
          </td></tr>
        }
      </tbody>
    </table>

    <!-- Read-only секция «Из глобальных» (только в типовых вкладках): строки
         product_type='', не накрытые переопределением по валюте. Reorder и
         правка — во вкладке «Глобальные»; порядок хранится per
         (scope, product_type), поэтому эти строки ВНЕ reorder-таблицы. -->
    @if (ptype() !== '' && inherited().length) {
      <div class="inherited">
        <h3>Из глобальных</h3>
        <p class="hint">Действуют для типа, пока не переопределены по валюте. Правка и порядок — во вкладке «Глобальные».</p>
        <table>
          <thead><tr>
            <th>Валюта</th><th>Провайдер</th><th>Условия доступности</th><th>Подпись условия</th><th>Вкл</th>
          </tr></thead>
          <tbody>
            @for (m of inherited(); track m.id) {
              <tr class="row-inherited" [class.row-off]="!m.enabled">
                <td><code>{{ m.currency_id }}</code> <span class="muted">{{ currencyName(m.currency_id) }}</span></td>
                <td>{{ providerLabel(m.provider) }}</td>
                <td>{{ conditionsSummary(m) }}</td>
                <td class="note-cell">{{ m.condition_note || '—' }}</td>
                <td>{{ m.enabled ? 'да' : 'нет' }}</td>
              </tr>
            }
          </tbody>
        </table>
      </div>
    }

    @if (current(); as c) {
      <app-dialog [title]="c.id ? 'Изменить метод оплаты' : 'Новая валюта'" (dismissed)="current.set(null)">
        <!-- Выбранное помечается на <option>: [value] селекта применяется ДО
             того, как @for создаст опции, и на открытии формы браузер
             сбрасывает выбор на первую строку списка. -->
        <label class="field">
          <span>Валюта</span>
          <select [value]="currencyC()" (change)="currencyC.set($any($event.target).value)">
            @for (cur of currencyOptions(); track cur.id) {
              <option [value]="cur.id" [selected]="cur.id === currencyC()">{{ cur.id }} — {{ cur.name }}</option>
            }
          </select>
        </label>
        <label class="field">
          <span>Провайдер приёма</span>
          <select [value]="providerC()" (change)="providerC.set($any($event.target).value)">
            @for (p of meta()?.providers ?? []; track p.id) {
              <option [value]="p.id" [selected]="p.id === providerC()">{{ p.label }}</option>
            }
          </select>
        </label>
        <div class="conds-field">
          <span>Условия доступности (все должны выполниться; пусто = доступна всем)</span>
          @for (t of meta()?.condition_types ?? []; track t.type) {
            <label class="check" [title]="t.description">
              <input type="checkbox" [checked]="condSelected(t.type)" (change)="toggleCond(t.type)" />
              {{ t.label }}
            </label>
          }
        </div>
        <app-input [(value)]="noteC" label="Подпись условия (видит пользователь на отключённой валюте)" />
        <label><input type="checkbox" [checked]="enabledC()" (change)="enabledC.set($any($event.target).checked)" /> Включена</label>
        <app-button variant="primary" [full]="true" [loading]="saving()" (clicked)="save()">Сохранить</app-button>
      </app-dialog>
    }`,
  styles: [`
    .tabs { display: flex; gap: 4px; border-bottom: 1px solid var(--color-hairline); margin-bottom: var(--space-md); }
    .tab {
      padding: 10px 16px; color: var(--color-muted); background: none; border: none; cursor: pointer;
      border-bottom: 2px solid transparent; font: inherit; font-weight: 500; font-size: 14px; margin-bottom: -1px;
    }
    .tab.active { color: var(--color-ink); border-bottom-color: var(--color-primary-ink); }
    .segments { display: flex; gap: 4px; margin: var(--space-sm) 0; flex-wrap: wrap; }
    .seg {
      padding: 6px 14px; border: 1px solid var(--color-hairline);
      border-radius: var(--rounded-pill); background: var(--color-canvas);
      color: var(--color-muted); font: inherit; font-size: 13px; cursor: pointer;
    }
    .seg.active {
      background: color-mix(in srgb, var(--color-primary) 14%, var(--color-canvas));
      border-color: var(--color-primary); color: var(--color-ink); font-weight: 500;
    }
    .inherited { margin-top: var(--space-lg); }
    .inherited h3 { margin: 0 0 4px; font-size: 15px; }
    .row-inherited td { color: var(--color-muted); }
    .toolbar { display: flex; flex-wrap: wrap; gap: 12px; align-items: center; margin: var(--space-sm) 0 var(--space-md); }
    .hint { font-size: 13px; color: var(--color-muted); margin: 0; }
    table { width: 100%; border-collapse: collapse; margin-top: var(--space-md); }
    th, td { padding: 10px; text-align: left; border-bottom: 1px solid var(--color-hairline); }
    .row-off td { opacity: .55; }
    .order-cell { white-space: nowrap; }
    .order-cell .link[disabled] { opacity: .3; cursor: default; }
    .muted { color: var(--color-muted); font-size: 12px; }
    .note-cell { max-width: 260px; font-size: 13px; color: var(--color-muted); }
    .empty { text-align: center; color: var(--color-muted); padding: 24px; }
    .link { color: var(--color-primary-ink); margin-right: 8px; background: none; border: none; cursor: pointer; padding: 0; font: inherit; }
    .link.red { color: var(--color-error); }
    .field { display: flex; flex-direction: column; gap: 6px; margin: var(--space-sm) 0; font-size: 13px; color: var(--color-muted); }
    .field select {
      height: 44px; padding: 10px 14px;
      border: 1px solid var(--color-hairline);
      border-radius: var(--rounded-md);
      background: var(--color-canvas); color: var(--color-ink);
      font: inherit;
    }
    .field select:focus { outline: none; border-color: var(--color-primary); }
    .conds-field { display: flex; flex-direction: column; gap: 8px; margin: var(--space-sm) 0; font-size: 13px; color: var(--color-muted); }
    .check { display: flex; align-items: center; gap: 8px; color: var(--color-ink); cursor: pointer; }
  `],
})
export class PaymentMethodsAdminPage implements OnInit {
  private readonly api = inject(AdminApi);
  private readonly toast = inject(ToastService);

  protected readonly meta = signal<PaymentMethodsMeta | null>(null);
  protected readonly items = signal<AdminPaymentMethod[]>([]);
  protected readonly scope = signal<string>('issue');
  protected readonly current = signal<AdminPaymentMethod | Partial<AdminPaymentMethod> | null>(null);
  protected readonly saving = signal(false);

  // defaultScopes — вкладки до прихода меты (форма всё равно ждёт мету).
  protected readonly defaultScopes = [
    { id: 'issue', label: 'Покупка карты' },
    { id: 'topup', label: 'Пополнение и продление' },
  ];
  // Дефолтный список типов до прихода меты (id '' = глобальные строки).
  private readonly defaultProductTypes = [
    { id: '', label: 'Глобальные' },
    { id: 'card', label: 'Карты' },
    { id: 'esim', label: 'eSIM' },
    { id: 'service', label: 'Сервисы' },
  ];

  /** Активный тип продукта ('' = глобальные строки). */
  protected readonly ptype = signal<string>('');

  protected readonly productTypes = computed(() => {
    const fromMeta = this.meta()?.product_types ?? [];
    if (!fromMeta.length) return this.defaultProductTypes;
    // Подпись '' в мете — «Глобально (все типы)»; для вкладки короче.
    return fromMeta.map((t) => (t.id === '' ? { ...t, label: 'Глобальные' } : t));
  });

  // Методы активной пары (scope, product_type) в порядке сортировки —
  // reorder действует только внутри этой пары.
  protected readonly scoped = computed(() =>
    this.items()
      .filter((m) => m.scope === this.scope() && (m.product_type ?? '') === this.ptype())
      .sort((a, b) => a.sort_order - b.sort_order));

  // Унаследованные глобальные строки для типовой вкладки: product_type='' и
  // валюта НЕ накрыта переопределением типа (merge-семантика бэка).
  protected readonly inherited = computed(() => {
    if (this.ptype() === '') return [] as AdminPaymentMethod[];
    const overridden = new Set(this.scoped().map((m) => m.currency_id));
    return this.items()
      .filter((m) => m.scope === this.scope() && (m.product_type ?? '') === '' && !overridden.has(m.currency_id))
      .sort((a, b) => a.sort_order - b.sort_order);
  });

  // Поля формы.
  protected readonly currencyC = signal('');
  // Валюты выпадашки = справочник меты + текущее значение, если его там уже
  // нет (направление coincat выключили) — иначе форма молча подменила бы
  // валюту метода первой строкой списка.
  protected readonly currencyOptions = computed(() => {
    const list = this.meta()?.currencies ?? [];
    const cur = this.currencyC();
    if (!cur || list.some((c) => c.id === cur)) return list;
    return [{ id: cur, name: this.currencyName(cur) }, ...list];
  });
  protected readonly providerC = signal('cc');
  protected readonly condsC = signal<string[]>([]);
  protected readonly noteC = signal('');
  protected readonly enabledC = signal(true);

  ngOnInit(): void {
    this.api.paymentMethodsMeta().subscribe({
      next: (m) => this.meta.set(m),
      error: (e) => this.toast.error(errorMessage(e, 'Не удалось загрузить справочник')),
    });
    this.reload();
  }

  private reload(): void {
    this.api.listPaymentMethods().subscribe({
      next: (r) => this.items.set(r.methods ?? []),
      error: (e) => this.toast.error(errorMessage(e, 'Не удалось загрузить методы оплаты')),
    });
  }

  protected currencyName(id: string): string {
    const found = this.meta()?.currencies.find((c) => c.id === id);
    return found && found.name !== id ? found.name : currencyLabel(id);
  }

  protected providerLabel(id: string): string {
    return this.meta()?.providers.find((p) => p.id === id)?.label ?? id;
  }

  protected conditionsSummary(m: AdminPaymentMethod): string {
    const conds = m.conditions ?? [];
    if (conds.length === 0) return 'Без условий';
    const types = this.meta()?.condition_types ?? [];
    return conds
      .map((c) => types.find((t) => t.type === c.type)?.label ?? c.type)
      .join(' + ');
  }

  protected openCreate(): void {
    this.currencyC.set(this.meta()?.currencies[0]?.id ?? '');
    this.providerC.set('cc');
    this.condsC.set([]);
    this.noteC.set('');
    this.enabledC.set(true);
    this.current.set({});
  }

  protected edit(m: AdminPaymentMethod): void {
    this.currencyC.set(m.currency_id);
    this.providerC.set(m.provider);
    this.condsC.set((m.conditions ?? []).map((c) => c.type));
    this.noteC.set(m.condition_note || '');
    this.enabledC.set(m.enabled);
    this.current.set(m);
  }

  protected condSelected(t: string): boolean { return this.condsC().includes(t); }
  protected toggleCond(t: string): void {
    this.condsC.update((list) => (list.includes(t) ? list.filter((x) => x !== t) : [...list, t]));
  }

  protected save(): void {
    const c = this.current();
    if (!c) return;
    const body: Partial<AdminPaymentMethod> = {
      scope: this.scope() as AdminPaymentMethod['scope'],
      // Новая строка — в активную вкладку типа; правка сохраняет тип строки
      // (редактировать можно только строки своей вкладки).
      product_type: c.id ? (c.product_type ?? '') : this.ptype(),
      currency_id: this.currencyC(),
      provider: this.providerC() as AdminPaymentMethod['provider'],
      enabled: this.enabledC(),
      conditions: this.condsC().map((type) => ({ type })),
      condition_note: this.noteC().trim(),
    };
    if (!body.currency_id) {
      this.toast.error('Выберите валюту');
      return;
    }
    this.saving.set(true);
    const done = (): void => {
      this.saving.set(false);
      this.current.set(null);
      this.reload();
    };
    const fail = (e: unknown): void => {
      this.saving.set(false);
      this.toast.error(errorMessage(e, 'Не удалось сохранить'));
    };
    if (c.id) {
      this.api.updatePaymentMethod(c.id, body).subscribe({ next: done, error: fail });
    } else {
      // Новая валюта — в конец списка вкладки.
      body.sort_order = this.scoped().length;
      this.api.createPaymentMethod(body).subscribe({ next: done, error: fail });
    }
  }

  protected toggleEnabled(m: AdminPaymentMethod, on: boolean): void {
    this.api.updatePaymentMethod(m.id, { enabled: on }).subscribe({
      next: () => this.reload(),
      error: (e) => { this.toast.error(errorMessage(e, 'Не удалось сохранить')); this.reload(); },
    });
  }

  // move — обмен sort_order с соседом по вкладке (два PATCH подряд).
  protected move(m: AdminPaymentMethod, dir: 1 | -1): void {
    const list = this.scoped();
    const i = list.findIndex((x) => x.id === m.id);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= list.length) return;
    const other = list[j];
    // Совпадающие sort_order (легаси-seed) свапом не разведёшь — нормализуем
    // на позиции в текущем отображаемом порядке.
    const mOrder = j;
    const otherOrder = i;
    this.api.updatePaymentMethod(m.id, { sort_order: mOrder }).subscribe({
      next: () => this.api.updatePaymentMethod(other.id, { sort_order: otherOrder }).subscribe({
        next: () => this.reload(),
        error: (e) => { this.toast.error(errorMessage(e, 'Не удалось сохранить порядок')); this.reload(); },
      }),
      error: (e) => { this.toast.error(errorMessage(e, 'Не удалось сохранить порядок')); this.reload(); },
    });
  }

  protected remove(m: AdminPaymentMethod): void {
    if (!confirm(`Удалить ${m.currency_id} из списка «${this.scopeLabel(m.scope)}»?`)) return;
    this.api.deletePaymentMethod(m.id).subscribe({
      next: () => this.reload(),
      error: (e) => this.toast.error(errorMessage(e, 'Не удалось удалить')),
    });
  }

  private scopeLabel(scope: string): string {
    return (this.meta()?.scopes ?? this.defaultScopes).find((s) => s.id === scope)?.label ?? scope;
  }
}
