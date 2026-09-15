import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { AdminApi, PartnerConfig } from '../../core/api/admin.api';
import { ButtonComponent } from '../../ui/button.component';
import { InputComponent } from '../../ui/input.component';
import { DialogComponent } from '../../ui/dialog.component';
import { ToastService } from '../../core/notifications/toast.service';
import { errorMessage } from '../../core/errors/api-error';

@Component({
  selector: 'app-partners-admin',
  standalone: true,
  imports: [ButtonComponent, InputComponent, DialogComponent],
  template: `<h1>Партнёры</h1>
    <div class="actions">
      <app-button variant="primary" (click)="openCreate()">+ Новый партнёр</app-button>
      <div class="search-wrap">
        <input
          type="search"
          class="search"
          [value]="query()"
          (input)="onQueryInput($event)"
          (keydown.enter)="searchNow()"
          placeholder="Поиск по email / имени / коду / комментарию…" />
        @if (query()) { <button class="clear" type="button" (click)="clearQuery()">×</button> }
      </div>
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
        <th>Пользователь</th>
        <th>Amount</th>
        <th>Currency</th>
        <th>Level</th>
        <th>Comment</th>
        <th>Реф-программа</th>
        <th></th>
      </tr></thead>
      <tbody>
        @for (p of items(); track p.id) {
          <tr>
            <td>
              <div class="user">
                <b>{{ name(p) }}</b>
                <span class="muted">{{ sub(p) }}</span>
              </div>
            </td>
            <td>{{ p.amount }}</td>
            <td>{{ p.currency }}</td>
            <td>{{ p.level }}</td>
            <td>{{ p.comment }}</td>
            <td>
              <label class="toggle">
                <input type="checkbox"
                  [checked]="!p.user_blocked_referral"
                  (change)="toggleReferralBlock(p, $event)" />
                <span>{{ p.user_blocked_referral ? 'Заблокировано' : 'Активна' }}</span>
              </label>
            </td>
            <td class="row-actions">
              <button class="edit" type="button" (click)="openEdit(p)">Изменить</button>
            </td>
          </tr>
        }
        @if (items().length === 0) {
          <tr><td colspan="7" class="muted">
            @if (query()) { Ничего не найдено по запросу «{{ query() }}». }
            @else { Партнёров пока нет. }
          </td></tr>
        }
      </tbody>
    </table>

    <div class="pager">
      <app-button variant="ghost" (click)="prev()" [disabled]="page() <= 1">‹ Назад</app-button>
      <span>Страница {{ page() }} из {{ totalPages() }}</span>
      <app-button variant="ghost" (click)="next()" [disabled]="page() >= totalPages()">Вперёд ›</app-button>
    </div>

    @if (opened()) {
      <app-dialog [title]="dialogTitle()" (dismissed)="cancelDialog()"
        (keydown.enter)="onEnterKey($event)">
        @if (!editing()) {
          <app-input [(value)]="email" label="Email пользователя" />
        } @else {
          <p class="muted edit-sub">{{ editingSubtitle() }}</p>
        }
        <app-input [(value)]="amount" inputmode="decimal" label="Amount" />
        <app-input [(value)]="currency" label="Currency" />
        <app-input [(value)]="level" inputmode="numeric" label="Level" />
        <app-input [(value)]="comment" label="Comment" />
        <app-button variant="primary" [full]="true" [loading]="saving()" (click)="save()">
          {{ editing() ? 'Сохранить' : 'Создать' }}
        </app-button>
      </app-dialog>
    }`,
  styles: [`
    .actions {
      display: flex; align-items: center; gap: var(--space-md);
      margin: var(--space-sm) 0 var(--space-md);
    }
    .search-wrap { position: relative; flex: 1; max-width: 420px; }
    .search {
      width: 100%; padding: 8px 32px 8px 12px; border: 1px solid var(--color-hairline);
      border-radius: var(--rounded-sm); background: var(--color-canvas); font-size: 14px;
    }
    .search:focus { outline: none; border-color: var(--color-primary); }
    .clear {
      position: absolute; right: 8px; top: 50%; transform: translateY(-50%);
      background: transparent; border: 0; cursor: pointer; font-size: 18px; line-height: 1; color: var(--color-muted);
    }
    .clear:hover { color: var(--color-ink); }
    .select { display: flex; flex-direction: column; gap: 6px; font-size: 13px; color: var(--color-muted); }
    .select select {
      height: 44px; padding: 10px 14px;
      border: 1px solid var(--color-hairline);
      border-radius: var(--rounded-md);
      background: var(--color-canvas); color: var(--color-ink);
      font: inherit; min-width: 120px;
    }
    .select select:focus { outline: none; border-color: var(--color-primary); }
    .meta { color: var(--color-muted); font-size: 13px; margin-bottom: 8px; }
    .pager { display: flex; align-items: center; gap: 12px; margin-top: var(--space-md); justify-content: center; }
    table { width: 100%; border-collapse: collapse; margin-top: var(--space-md); }
    th, td { padding: 10px; text-align: left; border-bottom: 1px solid var(--color-hairline); font-size: 14px; vertical-align: middle; }
    .user { display: flex; flex-direction: column; gap: 2px; }
    .user b { font-weight: 500; }
    .muted { color: var(--color-muted); font-size: 13px; }
    .row-actions { display: flex; gap: var(--space-sm); }
    .edit {
      background: transparent; border: 1px solid var(--color-hairline);
      padding: 4px 10px; border-radius: var(--rounded-sm); cursor: pointer; font-size: 13px;
    }
    .edit:hover { border-color: var(--color-primary); color: var(--color-primary-ink); }
    .toggle { display: inline-flex; align-items: center; gap: 6px; cursor: pointer; font-size: 13px; }
    .toggle input { accent-color: var(--color-primary); }
    .edit-sub { margin: 0 0 var(--space-sm); }
  `],
})
export class PartnersAdminPage implements OnInit {
  private readonly api = inject(AdminApi);
  private readonly toast = inject(ToastService);

  protected readonly items = signal<PartnerConfig[]>([]);

  // Пагинация — единый стиль с cards/orders/transactions (page/page_size).
  protected readonly total = signal(0);
  protected readonly page = signal(1);
  protected readonly pageSize = signal(25);
  protected readonly totalPages = computed(() => {
    const t = this.total();
    const ps = this.pageSize();
    if (t === 0 || ps === 0) return 1;
    return Math.ceil(t / ps);
  });

  protected readonly opened = signal(false);
  // editing — null в create-режиме, объект — режим редактирования. При создании
  // показываем поле email; при редактировании — нет (нельзя сменить юзера у
  // существующей записи, иначе это просто другой партнёр).
  protected readonly editing = signal<PartnerConfig | null>(null);
  protected readonly saving = signal(false);

  protected readonly email = signal('');
  protected readonly amount = signal('');
  protected readonly currency = signal('USD');
  protected readonly level = signal('1');
  protected readonly comment = signal('');

  // Поиск по тем же полям, что и лидерборд (email/имя/username/код), плюс
  // комментарий партнёра — это самый частый способ найти конкретный контракт.
  protected readonly query = signal('');
  private debounceHandle: ReturnType<typeof setTimeout> | null = null;

  ngOnInit(): void { this.refresh(); }

  protected dialogTitle(): string {
    return this.editing() ? 'Изменить партнёра' : 'Новый партнёр';
  }

  protected editingSubtitle(): string {
    const p = this.editing();
    if (!p) return '';
    return this.name(p) + (p.user_email && p.user_email !== this.name(p) ? ' · ' + p.user_email : '');
  }

  openCreate(): void {
    this.editing.set(null);
    this.email.set('');
    this.amount.set('');
    this.currency.set('USD');
    this.level.set('1');
    this.comment.set('');
    this.opened.set(true);
  }

  openEdit(p: PartnerConfig): void {
    this.editing.set(p);
    this.email.set(p.user_email ?? '');
    this.amount.set(String(p.amount));
    this.currency.set(p.currency);
    this.level.set(String(p.level));
    this.comment.set(p.comment ?? '');
    this.opened.set(true);
  }

  cancelDialog(): void {
    this.opened.set(false);
    this.editing.set(null);
  }

  protected name(p: PartnerConfig): string {
    const parts = [p.user_first_name, p.user_last_name].filter(Boolean);
    if (parts.length > 0) return parts.join(' ');
    if (p.user_email) return p.user_email;
    if (p.user_username) return '@' + p.user_username;
    if (p.telegram_id) return 'tg:' + p.telegram_id;
    return p.user_id;
  }

  protected sub(p: PartnerConfig): string {
    const primary = this.name(p);
    const bits: string[] = [];
    if (p.user_email && primary !== p.user_email) bits.push(p.user_email);
    if (p.user_username && primary !== '@' + p.user_username) bits.push('@' + p.user_username);
    if (p.telegram_id) bits.push('tg:' + p.telegram_id);
    return bits.join(' · ');
  }

  protected onQueryInput(event: Event): void {
    this.query.set((event.target as HTMLInputElement).value);
    if (this.debounceHandle) clearTimeout(this.debounceHandle);
    // Новый поисковый запрос — всегда с первой страницы.
    this.debounceHandle = setTimeout(() => { this.page.set(1); this.refresh(); }, 300);
  }

  protected clearQuery(): void {
    this.query.set('');
    this.page.set(1);
    this.refresh();
  }

  // searchNow — немедленный поиск по Enter: отменяет debounce и грузит сразу.
  protected searchNow(): void {
    if (this.debounceHandle) clearTimeout(this.debounceHandle);
    this.page.set(1);
    this.refresh();
  }

  refresh(): void {
    this.api.listPartners({ page: this.page(), page_size: this.pageSize(), q: this.query() }).subscribe({
      next: (r) => { this.total.set(r.total ?? 0); this.items.set(r.items ?? []); },
      error: (e) => this.toast.error(errorMessage(e, 'Не удалось загрузить партнёров')),
    });
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

  // toggleReferralBlock — флипа blocked_referral на User'е через
  // PATCH /admin/users/:id. Чек «активна» в UI отражает ОБРАТНОЕ значение,
  // поэтому новое значение блокировки = !checked.
  toggleReferralBlock(p: PartnerConfig, event: Event): void {
    const target = event.target as HTMLInputElement;
    const blocked = !target.checked;
    this.api.updateUser(p.user_id, { blocked_referral: blocked }).subscribe({
      next: () => {
        this.toast.success(blocked ? 'Реф-программа заблокирована' : 'Реф-программа включена');
        this.refresh();
      },
      error: (e) => {
        // Откатываем чек, чтобы UI не врал
        target.checked = !target.checked;
        this.toast.error(errorMessage(e, 'Не удалось изменить статус'));
      },
    });
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
    const amount = parseFloat(this.amount());
    const level = parseInt(this.level(), 10) || 1;
    if (!Number.isFinite(amount) || amount <= 0) {
      this.toast.error('Amount должен быть числом > 0');
      return;
    }
    const currency = this.currency().trim().toUpperCase();
    if (!currency) {
      this.toast.error('Укажите валюту');
      return;
    }

    this.saving.set(true);
    const editing = this.editing();
    const obs = editing
      ? this.api.updatePartner(editing.id!, {
          amount,
          currency,
          level,
          comment: this.comment(),
        })
      : this.api.createPartner({
          email: this.email().trim().toLowerCase(),
          amount,
          currency,
          level,
          comment: this.comment(),
        });
    obs.subscribe({
      next: () => {
        this.saving.set(false);
        this.toast.success(editing ? 'Сохранено' : 'Создано');
        this.cancelDialog();
        this.refresh();
      },
      error: (e) => {
        this.saving.set(false);
        this.toast.error(errorMessage(e, editing ? 'Не удалось сохранить' : 'Не удалось создать'));
      },
    });
  }
}
