import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { AdminApi, AdminTransactionRow, AdminUser, AdminUserTransactionsResponse } from '../../core/api/admin.api';
import { AuthService } from '../../core/auth/auth.service';
import { InputComponent } from '../../ui/input.component';
import { ButtonComponent } from '../../ui/button.component';
import { ToastService } from '../../core/notifications/toast.service';
import { errorMessage } from '../../core/errors/api-error';
import { formatAmount } from '../../core/currency/currency-symbols';

// Русские метки типов движений (совпадают с user-facing историей).
const KIND_LABELS: Record<string, string> = {
  charge: 'Покупка',
  topup: 'Пополнение',
  refund: 'Возврат',
};

// TransactionsAdminPage — движения по картам. Два режима одного компонента:
//   - /admin/transactions (пункт меню, только admin) — общий список по всем
//     пользователям: пагинация + фильтр «Пользователь» (живой поиск);
//   - /admin/transactions/:userId (deep-link «Транзакции» из «Пользователей»,
//     доступен и модератору) — для админа тот же общий режим с предзаполненным
//     фильтром, для модератора — прежний список одного пользователя до 500
//     строк: общий endpoint ему закрыт (RequireAdmin), а deep-link'овый сам
//     отбивает транзакции админов 404.
@Component({
  selector: 'app-transactions-admin',
  standalone: true,
  imports: [DatePipe, RouterLink, InputComponent, ButtonComponent],
  template: `@if (routeUserId()) {
      <a class="back" routerLink="/admin/users">‹ К пользователям</a>
    }
    <h1>{{ isAdmin() ? 'Транзакции карт' : 'Транзакции карт пользователя' }}</h1>

    @if (isAdmin()) {
      <div class="filters">
        @if (user(); as u) {
          <div class="user-chip">
            <span>Пользователь: <b>{{ userLabel() }}</b></span>
            @if (u.telegram_id) { <span class="dim">· TG {{ u.telegram_id }}</span> }
            <button type="button" class="chip-clear" (click)="clearUser()" aria-label="Сбросить фильтр по пользователю">×</button>
          </div>
        } @else {
          <div class="user-search">
            <app-input [value]="userQuery()" (valueChange)="onQueryChange($event)"
              placeholder="Все пользователи — фильтр: email, имя, username или TG id" />
            @if (suggestions().length) {
              <ul class="suggest">
                @for (s of suggestions(); track s.id) {
                  <li>
                    <button type="button" (click)="pickUser(s)">
                      <span>{{ suggestLabel(s) }}</span>
                      @if (s.telegram_id) { <span class="dim">TG {{ s.telegram_id }}</span> }
                    </button>
                  </li>
                }
              </ul>
            }
          </div>
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
    } @else {
      @if (user(); as u) {
        <div class="user-chip">
          <span><b>{{ userLabel() }}</b></span>
          @if (u.telegram_id) { <span class="dim">· TG {{ u.telegram_id }}</span> }
        </div>
      }
      <div class="meta">Найдено: {{ items().length }}{{ items().length >= 500 ? ' (показаны последние 500)' : '' }}</div>
    }

    <table>
      <thead>
        <tr>
          <th>Дата</th>
          <th>Тип</th>
          @if (isAdmin()) { <th>Пользователь</th> }
          <th>Описание</th>
          <th>Карта</th>
          <th>Сумма</th>
          <th>Статус</th>
        </tr>
      </thead>
      <tbody>
        @for (t of items(); track t.id) {
          <tr>
            <td><span class="dim">{{ t.happened_at | date:'dd.MM.yy HH:mm' }}</span></td>
            <td>{{ kindLabel(t.kind) }}</td>
            @if (isAdmin()) {
              <td>
                @if (t.user_id) {
                  <!-- Ссылка сужает список до этого пользователя (тот же роут,
                       что и deep-link из «Пользователей»). -->
                  <a class="user-link" [routerLink]="['/admin/transactions', t.user_id]">{{ rowUserLabel(t) }}</a>
                  @if (t.user_email && rowUserName(t)) {
                    <div class="sub">{{ rowUserName(t) }}</div>
                  }
                } @else { <span class="dim">—</span> }
              </td>
            }
            <td>
              {{ t.description || '—' }}
              @if (t.raw_currency_amount != null) {
                <div class="sub">{{ money(t.raw_currency_amount, t.raw_currency) }}</div>
              }
              @if (t.fee_amount) {
                <div class="sub">Комиссия {{ money(t.fee_amount, t.currency) }}</div>
              }
            </td>
            <td><code>•• {{ t.card_last4 || '----' }}</code></td>
            <td class="amount" [class.plus]="t.amount > 0" [class.minus]="t.amount < 0">
              {{ t.amount > 0 ? '+' : '' }}{{ money(t.amount, t.currency) }}
            </td>
            <td>
              <span class="badge" [class.ok]="t.status === 'success'" [class.bad]="t.status !== 'success'">
                {{ t.status === 'success' ? 'Успешно' : t.status }}
              </span>
            </td>
          </tr>
        } @empty {
          <tr><td [attr.colspan]="isAdmin() ? 7 : 6" class="empty">{{ loading() ? 'Загрузка…' : 'Транзакций нет' }}</td></tr>
        }
      </tbody>
    </table>

    @if (isAdmin()) {
      <div class="pager">
        <app-button variant="ghost" (click)="prev()" [disabled]="page() <= 1">‹ Назад</app-button>
        <span>Страница {{ page() }} из {{ totalPages() }}</span>
        <app-button variant="ghost" (click)="next()" [disabled]="page() >= totalPages()">Вперёд ›</app-button>
      </div>
    }`,
  styles: [`
    .back { display: inline-block; color: var(--color-muted); text-decoration: none; font-size: 14px; margin-bottom: var(--space-sm); }
    .back:hover { color: var(--color-primary-ink); }
    .filters { display: flex; flex-wrap: wrap; gap: 12px; align-items: center; margin-bottom: var(--space-md); }
    .user-search { position: relative; min-width: 340px; }
    .suggest {
      position: absolute; top: calc(100% + 4px); left: 0; right: 0; z-index: 10;
      margin: 0; padding: 4px; list-style: none;
      background: var(--color-surface-card); border: 1px solid var(--color-hairline);
      border-radius: var(--rounded-md); box-shadow: 0 8px 24px rgba(0,0,0,0.08);
      max-height: 320px; overflow: auto;
    }
    .suggest button {
      display: flex; justify-content: space-between; gap: 12px; width: 100%;
      padding: 8px 10px; border: 0; border-radius: var(--rounded-sm);
      background: none; color: var(--color-ink); font: inherit; font-size: 14px;
      text-align: left; cursor: pointer;
    }
    .suggest button:hover { background: var(--color-canvas); }
    .select { display: flex; flex-direction: column; gap: 6px; font-size: 13px; color: var(--color-muted); }
    .select select {
      height: 44px; padding: 10px 14px;
      border: 1px solid var(--color-hairline);
      border-radius: var(--rounded-md);
      background: var(--color-canvas); color: var(--color-ink);
      font: inherit; min-width: 120px;
    }
    .select select:focus { outline: none; border-color: var(--color-primary); }
    .user-chip {
      display: inline-flex; align-items: center; gap: 8px;
      padding: 6px 14px; margin-bottom: var(--space-md);
      background: var(--color-surface-card); border: 1px solid var(--color-hairline);
      border-radius: var(--rounded-pill); font-size: 13px;
    }
    .filters .user-chip { margin-bottom: 0; padding-right: 10px; }
    .chip-clear {
      width: 22px; height: 22px; border-radius: var(--rounded-pill);
      background: var(--color-canvas); color: var(--color-muted);
      font-size: 16px; line-height: 1; border: 1px solid var(--color-hairline);
      cursor: pointer;
    }
    .meta { color: var(--color-muted); font-size: 13px; margin-bottom: 8px; }
    table { width: 100%; border-collapse: collapse; }
    th, td { padding: 10px; text-align: left; border-bottom: 1px solid var(--color-hairline); font-size: 14px; vertical-align: top; }
    th { color: var(--color-muted); font-weight: 500; font-size: 12px; text-transform: uppercase; letter-spacing: 0.04em; }
    code { font-family: var(--font-mono, monospace); }
    .dim { color: var(--color-muted); }
    .sub { color: var(--color-muted); font-size: 12px; }
    .empty { text-align: center; color: var(--color-muted); padding: 24px; }
    .amount { white-space: nowrap; font-weight: 500; }
    .amount.plus { color: var(--color-success, #198754); }
    .amount.minus { color: var(--color-error, #dc3545); }
    .badge { display: inline-block; padding: 2px 8px; border-radius: var(--rounded-pill); font-size: 12px; background: var(--color-surface-card); }
    .badge.ok { background: rgba(16,185,129,0.15); color: #047857; }
    .badge.bad { background: rgba(239,68,68,0.15); color: #b91c1c; }
    .user-link { color: var(--color-ink); text-decoration: none; border-bottom: 1px dotted var(--color-muted); }
    .user-link:hover { color: var(--color-primary-ink); border-bottom-color: var(--color-primary-ink); }
    .pager { display: flex; align-items: center; gap: 12px; margin-top: var(--space-md); justify-content: center; }
  `],
})
export class TransactionsAdminPage implements OnInit {
  private readonly api = inject(AdminApi);
  private readonly auth = inject(AuthService);
  private readonly toast = inject(ToastService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);

  protected readonly isAdmin = computed(() => this.auth.user()?.role === 'admin');

  // routeUserId — фильтр по пользователю целиком живёт в URL: пустой на
  // /admin/transactions, заполнен на /admin/transactions/:userId. Выбор в
  // фильтре и крестик chip'а просто навигируют между этими роутами.
  protected readonly routeUserId = signal('');
  protected readonly items = signal<AdminTransactionRow[]>([]);
  protected readonly user = signal<AdminUserTransactionsResponse['user'] | null>(null);
  protected readonly loading = signal(true);

  // Пагинация — только admin-режим (общий endpoint); модератор получает
  // фикс-выборку до 500 строк deep-link-endpoint'ом.
  protected readonly total = signal(0);
  protected readonly page = signal(1);
  protected readonly pageSize = signal(25);

  // totalPages — округление вверх; защита от деления на 0 (пустая выборка =
  // страница 1, иначе обе кнопки пейджера навсегда disabled).
  protected readonly totalPages = computed(() => {
    const t = this.total();
    const ps = this.pageSize();
    if (t === 0 || ps === 0) return 1;
    return Math.ceil(t / ps);
  });

  // Живой поиск пользователя для фильтра (admin без активного фильтра).
  protected readonly userQuery = signal('');
  protected readonly suggestions = signal<AdminUser[]>([]);
  private searchTimer: ReturnType<typeof setTimeout> | null = null;

  // userLabel — email или «Имя Фамилия»; fallback — TG id / ULID.
  protected readonly userLabel = computed(() => {
    const u = this.user();
    if (!u) return '';
    const name = `${u.first_name ?? ''} ${u.last_name ?? ''}`.trim();
    return u.email || name || (u.telegram_id ? `TG ${u.telegram_id}` : u.id);
  });

  ngOnInit(): void {
    // paramMap подпиской, а не snapshot: клик по пользователю в строке при
    // уже активном фильтре — навигация в тот же route config, компонент
    // переиспользуется без пересоздания. Router сам чистит подписку.
    this.route.paramMap.subscribe((pm) => {
      this.routeUserId.set(pm.get('userId') ?? '');
      this.page.set(1);
      this.userQuery.set('');
      this.suggestions.set([]);
      this.load();
    });
  }

  // load — единственный путь к API; ветка по роли (см. шапку файла).
  private load(): void {
    this.loading.set(true);
    if (this.isAdmin()) {
      this.api.listTransactions({
        page: this.page(),
        page_size: this.pageSize(),
        user_id: this.routeUserId() || undefined,
      }).subscribe({
        next: (r) => {
          this.items.set(r.items ?? []);
          this.total.set(r.total ?? 0);
          this.user.set(r.user ?? null);
          this.loading.set(false);
        },
        error: (e) => {
          this.loading.set(false);
          this.toast.error(errorMessage(e, 'Не удалось загрузить транзакции'));
        },
      });
      return;
    }
    const userId = this.routeUserId();
    if (!userId) { this.loading.set(false); return; }
    this.api.listUserTransactions(userId).subscribe({
      next: (r) => {
        // user_id дополняется из роута — общий тип строки требует его, а
        // deep-link-endpoint владельца в каждой строке не дублирует.
        this.items.set((r.items ?? []).map((t) => ({ ...t, user_id: userId })));
        this.user.set(r.user ?? null);
        this.loading.set(false);
      },
      error: (e) => {
        this.loading.set(false);
        this.toast.error(errorMessage(e, 'Не удалось загрузить транзакции'));
      },
    });
  }

  // ----- Фильтр по пользователю (admin) -----

  onQueryChange(v: string): void {
    this.userQuery.set(v);
    if (this.searchTimer) clearTimeout(this.searchTimer);
    const q = v.trim();
    if (q.length < 2) { this.suggestions.set([]); return; }
    this.searchTimer = setTimeout(() => {
      this.api.listUsers({ q }).subscribe({
        next: (r) => {
          // Ввод уже изменился — не перерисовываем выпадашку устаревшим ответом.
          if (this.userQuery().trim() !== q) return;
          this.suggestions.set((r.items ?? []).slice(0, 8));
        },
        error: () => this.suggestions.set([]),
      });
    }, 300);
  }

  pickUser(u: AdminUser): void { this.router.navigate(['/admin/transactions', u.id]); }
  clearUser(): void { this.router.navigate(['/admin/transactions']); }

  protected suggestLabel(u: AdminUser): string {
    const name = `${u.first_name ?? ''} ${u.last_name ?? ''}`.trim();
    return u.email || name || u.id;
  }

  // ----- Пагинация (admin) -----

  setPageSize(v: string): void {
    const n = parseInt(v, 10);
    if (!isNaN(n) && n > 0) {
      this.pageSize.set(n);
      this.page.set(1);
      this.load();
    }
  }

  prev(): void {
    if (this.page() > 1) {
      this.page.set(this.page() - 1);
      this.load();
    }
  }

  next(): void {
    if (this.page() < this.totalPages()) {
      this.page.set(this.page() + 1);
      this.load();
    }
  }

  // ----- Отображение -----

  protected rowUserName(t: AdminTransactionRow): string {
    return `${t.user_first_name ?? ''} ${t.user_last_name ?? ''}`.trim();
  }

  protected rowUserLabel(t: AdminTransactionRow): string {
    return t.user_email || this.rowUserName(t) || t.user_id;
  }

  protected kindLabel(k: string): string { return KIND_LABELS[k] ?? k; }
  protected money(v: number | null | undefined, c: string | null | undefined): string { return formatAmount(v, c); }
}
