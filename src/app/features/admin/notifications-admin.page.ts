import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { AdminApi, AdminUser, AdminUserBrief, NotificationLogRow } from '../../core/api/admin.api';
import { ButtonComponent } from '../../ui/button.component';
import { InputComponent } from '../../ui/input.component';
import { DialogComponent } from '../../ui/dialog.component';
import { ToastService } from '../../core/notifications/toast.service';
import { errorMessage } from '../../core/errors/api-error';

// «Логирование» (admin-only): журнал ВСЕХ отправленных пользователям
// уведомлений — Telegram и email, включая системные письма (код входа) и
// сообщения retention-планов. Фильтр по пользователю (живой поиск), источнику
// (система / планы) и пагинация. Клик по строке — полный текст.
@Component({
  selector: 'app-notifications-admin',
  standalone: true,
  imports: [ButtonComponent, InputComponent, DialogComponent, DatePipe],
  template: `<h1>Логирование уведомлений</h1>
    <div class="toolbar">
      <div class="user-filter">
        @if (filterUser(); as fu) {
          <span class="chip">{{ userLabel(fu) }} <button class="x" (click)="clearUserFilter()">×</button></span>
        } @else {
          <app-input [(value)]="userQueryC" label="Пользователь" placeholder="email / имя / telegram id" />
          <app-button variant="secondary" (clicked)="searchUsers()">Найти</app-button>
        }
        @if (userResults().length && !filterUser()) {
          <div class="user-list">
            @for (u of userResults(); track u.id) {
              <button type="button" class="user-row" (click)="pickUser(u)">{{ userLabel2(u) }}</button>
            }
          </div>
        }
      </div>
      <label class="select">
        <span>Источник</span>
        <select [value]="source()" (change)="setSource($any($event.target).value)">
          <option value="">Все</option>
          <option value="system">Система</option>
          <option value="plan">Ретеншен-планы</option>
        </select>
      </label>
      <label class="select">
        <span>На странице</span>
        <select [value]="pageSize()" (change)="setPageSize($any($event.target).value)">
          <option [value]="25">25</option>
          <option [value]="50">50</option>
          <option [value]="100">100</option>
        </select>
      </label>
    </div>

    <div class="meta">Найдено: {{ total() }}</div>

    <table>
      <thead><tr><th>Когда</th><th>Пользователь</th><th>Канал</th><th>Тип</th><th>Источник</th><th>Текст</th><th>Статус</th></tr></thead>
      <tbody>
        @for (n of items(); track n.id) {
          <tr class="row" (click)="details.set(n)">
            <td class="nowrap">{{ n.created_at | date: 'dd.MM.yyyy HH:mm' }}</td>
            <td>{{ rowUserLabel(n) }}</td>
            <td>{{ n.channel === 'telegram' ? 'Telegram' : 'Email' }}</td>
            <td><code>{{ n.kind }}</code></td>
            <td>
              <span class="badge" [class.plan]="n.source === 'plan'">{{ n.source === 'plan' ? 'план' : 'система' }}</span>
            </td>
            <td class="body-cell">{{ preview(n) }}</td>
            <td>
              <span class="status" [class.fail]="!n.success">{{ n.success ? 'отправлено' : 'ошибка' }}</span>
            </td>
          </tr>
        } @empty {
          <tr><td colspan="7" class="empty">Записей нет</td></tr>
        }
      </tbody>
    </table>

    <div class="pager">
      <app-button variant="ghost" (clicked)="prev()" [disabled]="page() <= 1">‹ Назад</app-button>
      <span>Страница {{ page() }} из {{ totalPages() }}</span>
      <app-button variant="ghost" (clicked)="next()" [disabled]="page() >= totalPages()">Вперёд ›</app-button>
    </div>

    @if (details(); as d) {
      <app-dialog title="Уведомление" (dismissed)="details.set(null)">
        <div class="detail-grid">
          <span>Когда</span><b>{{ d.created_at | date: 'dd.MM.yyyy HH:mm:ss' }}</b>
          <span>Пользователь</span><b>{{ rowUserLabel(d) }}</b>
          <span>Получатель</span><b>{{ d.recipient }}</b>
          <span>Канал</span><b>{{ d.channel }}</b>
          <span>Тип</span><b><code>{{ d.kind }}</code></b>
          <span>Источник</span><b>{{ d.source === 'plan' ? 'ретеншен-план' : 'система' }}</b>
          @if (d.subject) { <span>Тема</span><b>{{ d.subject }}</b> }
          @if (!d.success) { <span>Ошибка</span><b class="err">{{ d.error }}</b> }
        </div>
        <pre class="full-body">{{ d.body }}</pre>
      </app-dialog>
    }`,
  styles: [`
    .toolbar { display: flex; flex-wrap: wrap; gap: 16px; align-items: end; margin: var(--space-sm) 0 var(--space-md); }
    .user-filter { position: relative; display: flex; gap: 8px; align-items: end; }
    .user-list {
      position: absolute; top: 100%; left: 0; z-index: 10; min-width: 280px;
      background: var(--color-canvas); border: 1px solid var(--color-hairline);
      border-radius: var(--rounded-md); box-shadow: 0 8px 24px rgba(0,0,0,.08);
      display: flex; flex-direction: column; max-height: 260px; overflow: auto;
    }
    .user-row { text-align: left; padding: 8px 12px; background: none; border: none; cursor: pointer; font: inherit; }
    .user-row:hover { background: var(--color-surface-card); }
    .chip { display: inline-flex; align-items: center; gap: 6px; padding: 8px 12px; border-radius: 999px; background: var(--color-surface-card); border: 1px solid var(--color-hairline); font-weight: 600; }
    .x { background: none; border: none; cursor: pointer; font-size: 15px; color: var(--color-muted); }
    .select { display: flex; flex-direction: column; gap: 6px; font-size: 13px; color: var(--color-muted); }
    .select select {
      height: 44px; padding: 10px 14px; border: 1px solid var(--color-hairline);
      border-radius: var(--rounded-md); background: var(--color-canvas); color: var(--color-ink);
      font: inherit; min-width: 120px;
    }
    .select select:focus { outline: none; border-color: var(--color-primary); }
    .meta { color: var(--color-muted); font-size: 13px; margin-bottom: 8px; }
    table { width: 100%; border-collapse: collapse; margin-top: var(--space-md); }
    th, td { padding: 10px; text-align: left; border-bottom: 1px solid var(--color-hairline); vertical-align: top; }
    .row { cursor: pointer; }
    .row:hover { background: var(--color-surface-card); }
    .nowrap { white-space: nowrap; }
    .body-cell { max-width: 420px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--color-muted); }
    .badge { padding: 2px 10px; border-radius: 999px; font-size: 12px; background: var(--color-surface-card); border: 1px solid var(--color-hairline); }
    .badge.plan { color: var(--color-primary-ink); border-color: var(--color-primary); }
    .status { color: var(--color-success, #198754); font-size: 13px; }
    .status.fail { color: var(--color-error); }
    .empty { text-align: center; color: var(--color-muted); padding: 24px; }
    .pager { display: flex; align-items: center; gap: 12px; margin-top: var(--space-md); justify-content: center; }
    .detail-grid { display: grid; grid-template-columns: 130px 1fr; gap: 6px 12px; font-size: 14px; margin-bottom: 12px; }
    .detail-grid span { color: var(--color-muted); }
    .err { color: var(--color-error); }
    .full-body { white-space: pre-wrap; overflow-wrap: anywhere; background: var(--color-surface-card); border: 1px solid var(--color-hairline); border-radius: var(--rounded-md); padding: 12px 14px; font-family: inherit; font-size: 14px; max-height: 50vh; overflow: auto; }
  `],
})
export class NotificationsAdminPage implements OnInit {
  private readonly api = inject(AdminApi);
  private readonly toast = inject(ToastService);

  protected readonly items = signal<NotificationLogRow[]>([]);
  protected readonly users = signal<Record<string, AdminUserBrief>>({});
  protected readonly details = signal<NotificationLogRow | null>(null);

  protected readonly total = signal(0);
  protected readonly page = signal(1);
  protected readonly pageSize = signal(25);
  protected readonly totalPages = computed(() => {
    const t = this.total();
    const ps = this.pageSize();
    if (t === 0 || ps === 0) return 1;
    return Math.ceil(t / ps);
  });

  protected readonly source = signal('');
  protected readonly userQueryC = signal('');
  protected readonly userResults = signal<AdminUser[]>([]);
  protected readonly filterUser = signal<AdminUser | null>(null);

  ngOnInit(): void { this.refresh(); }

  refresh(): void {
    this.api.listNotifications({
      page: this.page(),
      page_size: this.pageSize(),
      user_id: this.filterUser()?.id,
      source: this.source() || undefined,
    }).subscribe({
      next: (r) => {
        this.total.set(r.total ?? 0);
        if ((r.items ?? []).length === 0 && this.page() > 1) {
          this.page.set(this.page() - 1);
          this.refresh();
          return;
        }
        this.items.set(r.items ?? []);
        this.users.set(r.users ?? {});
      },
      error: (e) => this.toast.error(errorMessage(e, 'Не удалось загрузить журнал')),
    });
  }

  searchUsers(): void {
    this.api.listUsers({ q: this.userQueryC(), page: 1, page_size: 10 }).subscribe({
      next: (r) => this.userResults.set(r.items ?? []),
      error: (e) => this.toast.error(errorMessage(e, 'Не удалось найти пользователей')),
    });
  }

  pickUser(u: AdminUser): void {
    this.filterUser.set(u);
    this.userResults.set([]);
    this.page.set(1);
    this.refresh();
  }

  clearUserFilter(): void {
    this.filterUser.set(null);
    this.userQueryC.set('');
    this.page.set(1);
    this.refresh();
  }

  userLabel(u: AdminUser): string {
    const name = [u.first_name, u.last_name].filter(Boolean).join(' ');
    return u.email || name || (u.telegram_id ? `tg:${u.telegram_id}` : u.id);
  }

  userLabel2(u: AdminUser): string {
    const name = [u.first_name, u.last_name].filter(Boolean).join(' ');
    return [u.email, name, u.telegram_id ? `tg:${u.telegram_id}` : ''].filter(Boolean).join(' · ') || u.id;
  }

  rowUserLabel(n: NotificationLogRow): string {
    if (!n.user_id) return n.recipient || '—';
    const u = this.users()[n.user_id];
    if (!u) return n.user_id;
    const name = [u.first_name, u.last_name].filter(Boolean).join(' ');
    return u.email || name || u.username || (u.telegram_id ? `tg:${u.telegram_id}` : n.user_id);
  }

  preview(n: NotificationLogRow): string {
    const text = n.subject ? `${n.subject}: ${n.body}` : n.body;
    return text.length > 140 ? text.slice(0, 140) + '…' : text;
  }

  setSource(v: string): void {
    this.source.set(v);
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
    if (this.page() > 1) { this.page.set(this.page() - 1); this.refresh(); }
  }
  next(): void {
    if (this.page() < this.totalPages()) { this.page.set(this.page() + 1); this.refresh(); }
  }
}
