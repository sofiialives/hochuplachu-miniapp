import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { AdminApi, AdminUser } from '../../core/api/admin.api';
import { AuthService, UserRole } from '../../core/auth/auth.service';
import { InputComponent } from '../../ui/input.component';
import { ButtonComponent } from '../../ui/button.component';
import { DialogComponent } from '../../ui/dialog.component';
import { ToastService } from '../../core/notifications/toast.service';
import { errorMessage } from '../../core/errors/api-error';

// Метки для пользователя — показывать в статусе после слова «Заблокирован».
const BLOCK_LABELS: Record<'blocked_login' | 'blocked_cards' | 'blocked_referral', string> = {
  blocked_login: 'вход',
  blocked_cards: 'карты',
  blocked_referral: 'реф-программа',
};

const ROLE_LABELS: Record<UserRole, string> = {
  user: 'Пользователь',
  moderator: 'Модератор',
  admin: 'Админ',
};

@Component({
  selector: 'app-users-admin',
  standalone: true,
  imports: [InputComponent, ButtonComponent, DialogComponent, RouterLink, DatePipe],
  template: `<h1>Пользователи</h1>
    <div class="search">
      <app-input [(value)]="q" placeholder="Поиск (email, имя, ник, TG id)" (enterPressed)="search()" />
      <app-button variant="primary" (click)="search()">Найти</app-button>
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
        <th>ID</th>
        <th>Email</th>
        <th>Имя</th>
        <th>TG</th>
        <th>Никнейм</th>
        <th>Регистрация</th>
        <th>Роль</th>
        <th>Тип</th>
        <th>Реф-код</th>
        <th>Блокировка</th>
        <th></th>
      </tr></thead>
      <tbody>
        @for (u of items(); track u.id) {
          <tr [class.blocked]="anyBlocked(u)">
            <td><code>{{ u.id.slice(0, 8) }}…</code></td>
            <td>{{ u.email ?? '—' }}</td>
            <td>{{ u.first_name }} {{ u.last_name }}</td>
            <td>{{ u.telegram_id ?? '—' }}</td>
            <td>{{ u.username ? '@' + u.username : '—' }}</td>
            <td><span class="dim">{{ u.created_at | date:'dd.MM.yy HH:mm' }}</span></td>
            <td>
              <!-- Назначение ролей — только админ; модератору бэк в любом
                   случае откажет, поэтому ему роль показывается текстом.
                   Своя строка задизейблена — чтобы админ не разжаловал сам
                   себя и не потерял доступ к панели. -->
              @if (meIsAdmin()) {
                <select class="role" [value]="u.role" [disabled]="u.id === meId()"
                  (change)="setRole(u, $any($event.target))">
                  <option value="user">{{ roleLabel('user') }}</option>
                  <option value="moderator">{{ roleLabel('moderator') }}</option>
                  <option value="admin">{{ roleLabel('admin') }}</option>
                </select>
              } @else {
                {{ roleLabel(u.role) }}
              }
            </td>
            <td>{{ u.referral_type }}</td>
            <td><code>{{ u.referral_code }}</code></td>
            <td>
              @if (anyBlocked(u)) {
                <span class="badge">Заблокирован ({{ blockedSummary(u) }})</span>
              } @else {
                <span class="active">Активен</span>
              }
            </td>
            <td class="row-actions">
              <a class="btn" routerLink="/admin/cards" [queryParams]="{ user_id: u.id }">Карты</a>
              <a class="btn" [routerLink]="['/admin/transactions', u.id]">Транзакции карт</a>
              <button class="btn" type="button" (click)="openBlock(u)">
                {{ anyBlocked(u) ? 'Изменить' : 'Заблокировать' }}
              </button>
            </td>
          </tr>
        } @empty {
          <tr><td colspan="11" class="empty">Пользователей нет</td></tr>
        }
      </tbody>
    </table>

    <div class="pager">
      <app-button variant="ghost" (click)="prev()" [disabled]="page() <= 1">‹ Назад</app-button>
      <span>Страница {{ page() }} из {{ totalPages() }}</span>
      <app-button variant="ghost" (click)="next()" [disabled]="page() >= totalPages()">Вперёд ›</app-button>
    </div>

    @if (editing(); as e) {
      <app-dialog title="Блокировка аккаунта" (dismissed)="cancel()">
        <p class="hint">{{ e.email ?? e.id }}: выберите, какие функции заблокировать.</p>
        <ul class="checks">
          <li>
            <label>
              <input type="checkbox" [checked]="draft().blocked_login"
                (change)="setDraft('blocked_login', $any($event.target).checked)" />
              <span><b>Вход</b> — нельзя войти ни через email, ни через TG, ни по сохранённому токену.</span>
            </label>
          </li>
          <li>
            <label>
              <input type="checkbox" [checked]="draft().blocked_cards"
                (change)="setDraft('blocked_cards', $any($event.target).checked)" />
              <span><b>Карты</b> — нельзя выпускать новые, пополнять или продлевать обслуживание. Активные карты замораживаются (RKFreeze в card-issuer). Снятие блокировки разморозит только те карты, которые были заморожены этим действием.</span>
            </label>
          </li>
          <li>
            <label>
              <input type="checkbox" [checked]="draft().blocked_referral"
                (change)="setDraft('blocked_referral', $any($event.target).checked)" />
              <span><b>Реф-программа</b> — ссылка не приносит бонусов: приглашённые не получают welcome-бонус, рефовод не получает payout'ы, вывод накопленных pending — недоступен.</span>
            </label>
          </li>
        </ul>
        <div class="actions">
          <app-button variant="secondary" (click)="cancel()">Отмена</app-button>
          <app-button variant="primary" [loading]="saving()" (click)="save()">Сохранить</app-button>
        </div>
      </app-dialog>
    }`,
  styles: [`
    .search { display: flex; gap: 12px; margin-bottom: var(--space-md); align-items: end; }
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
    .empty { text-align: center; color: var(--color-muted); padding: 24px; }
    .pager { display: flex; align-items: center; gap: 12px; margin-top: var(--space-md); justify-content: center; }
    table { width: 100%; border-collapse: collapse; }
    th, td { padding: 10px; text-align: left; border-bottom: 1px solid var(--color-hairline); font-size: 14px; vertical-align: middle; }
    tr.blocked { background: color-mix(in srgb, var(--color-danger, #dc3545) 6%, transparent); }
    .badge {
      display: inline-block; padding: 3px 8px; border-radius: 999px;
      background: color-mix(in srgb, var(--color-danger, #dc3545) 14%, transparent);
      color: var(--color-danger, #dc3545); font-size: 12px; font-weight: 500;
    }
    .active { color: var(--color-success, #198754); font-size: 13px; }
    .dim { color: var(--color-muted); white-space: nowrap; }
    .row-actions { display: flex; flex-wrap: wrap; gap: var(--space-sm); align-items: center; }
    .btn {
      display: inline-block; background: transparent; border: 1px solid var(--color-hairline);
      padding: 4px 12px; border-radius: var(--rounded-sm); cursor: pointer; font-size: 13px;
      color: var(--color-ink); text-decoration: none; line-height: 1.4;
    }
    .btn:hover { border-color: var(--color-primary); color: var(--color-primary-ink); }

    select.role {
      padding: 4px 8px; border: 1px solid var(--color-hairline);
      border-radius: var(--rounded-sm); background: var(--color-canvas);
      color: var(--color-ink); font: inherit; font-size: 13px;
    }
    select.role:focus { outline: none; border-color: var(--color-primary); }
    select.role:disabled { opacity: .6; cursor: not-allowed; }

    .hint { color: var(--color-muted); margin: 0 0 var(--space-md); }
    .checks { list-style: none; padding: 0; margin: 0 0 var(--space-md); display: flex; flex-direction: column; gap: var(--space-sm); }
    .checks label { display: flex; gap: var(--space-sm); align-items: flex-start; cursor: pointer; padding: 10px; border: 1px solid var(--color-hairline); border-radius: var(--rounded-sm); }
    .checks label:has(input:checked) { border-color: var(--color-danger, #dc3545); background: color-mix(in srgb, var(--color-danger, #dc3545) 4%, transparent); }
    .checks input { margin-top: 2px; accent-color: var(--color-danger, #dc3545); }
    .checks span { font-size: 13px; line-height: 1.4; }
    .actions { display: flex; gap: var(--space-sm); justify-content: flex-end; }
  `],
})
export class UsersAdminPage implements OnInit {
  private readonly api = inject(AdminApi);
  private readonly route = inject(ActivatedRoute);
  private readonly auth = inject(AuthService);
  private readonly toast = inject(ToastService);
  protected readonly items = signal<AdminUser[]>([]);
  protected readonly q = signal('');

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

  protected readonly meIsAdmin = computed(() => this.auth.user()?.role === 'admin');
  protected readonly meId = computed(() => this.auth.user()?.id);

  // editing — null когда диалог закрыт. draft хранит ИЗМЕНЯЕМОЕ состояние
  // чекбоксов (полностью отдельно от editing, чтобы при отмене UI вернулся в
  // исходное), saving — лоадер кнопки.
  protected readonly editing = signal<AdminUser | null>(null);
  protected readonly draft = signal<{ blocked_login: boolean; blocked_cards: boolean; blocked_referral: boolean }>({
    blocked_login: false, blocked_cards: false, blocked_referral: false,
  });
  protected readonly saving = signal(false);

  ngOnInit(): void {
    // ?q= из URL — deep-link «открыть уже отфильтрованный список». Так сюда
    // ведёт ссылка на профиль из карточки контакта в Chatwoot
    // (/admin/users?q=<telegram_id>); серверный поиск матчит telegram_id
    // точно, если q целиком парсится как число. Подставляем ДО первого
    // refresh() — иначе список успеет загрузиться без фильтра.
    const q = this.route.snapshot.queryParamMap.get('q');
    if (q) this.q.set(q);
    this.refresh();
  }

  // refresh — загрузка текущей страницы (используется и пейджером). search —
  // новый поиск: сбрасывает на первую страницу.
  refresh(): void {
    this.api.listUsers({ page: this.page(), page_size: this.pageSize(), q: this.q() || undefined }).subscribe({
      next: (r) => { this.total.set(r.total ?? 0); this.items.set(r.items ?? []); },
      error: (e) => this.toast.error(errorMessage(e, 'Не удалось загрузить пользователей')),
    });
  }

  search(): void {
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

  setRole(u: AdminUser, select: HTMLSelectElement): void {
    const role = select.value as UserRole;
    if (role === u.role) return;
    this.api.updateUser(u.id, { role }).subscribe({
      next: () => { this.toast.success('Роль обновлена'); this.patchLocal(u.id, { role }); },
      error: (e) => {
        // Нативный select уже показывает новое значение — откатываем к фактическому.
        select.value = u.role;
        this.toast.error(errorMessage(e, 'Не удалось обновить роль'));
      },
    });
  }

  protected roleLabel(role: UserRole): string {
    return ROLE_LABELS[role];
  }

  protected anyBlocked(u: AdminUser): boolean {
    return !!u.blocked_login || !!u.blocked_cards || !!u.blocked_referral;
  }

  // blockedSummary — «вход, карты» (по тем что true). Используется в badge'е
  // под колонкой статуса.
  protected blockedSummary(u: AdminUser): string {
    const parts: string[] = [];
    if (u.blocked_login) parts.push(BLOCK_LABELS.blocked_login);
    if (u.blocked_cards) parts.push(BLOCK_LABELS.blocked_cards);
    if (u.blocked_referral) parts.push(BLOCK_LABELS.blocked_referral);
    return parts.join(', ');
  }

  openBlock(u: AdminUser): void {
    this.editing.set(u);
    this.draft.set({
      blocked_login: !!u.blocked_login,
      blocked_cards: !!u.blocked_cards,
      blocked_referral: !!u.blocked_referral,
    });
  }

  setDraft(field: 'blocked_login' | 'blocked_cards' | 'blocked_referral', value: boolean): void {
    this.draft.set({ ...this.draft(), [field]: value });
  }

  cancel(): void {
    this.editing.set(null);
    this.saving.set(false);
  }

  save(): void {
    const e = this.editing();
    if (!e) return;
    const d = this.draft();
    // PATCH шлёт сразу 3 флага — это атомарно с точки зрения админа («сохранил
    // комбинацию»). Backend сам решит, чьё значение менять и нужно ли
    // дёргать BlockingService (он смотрит на разницу blocked_cards).
    this.saving.set(true);
    this.api.updateUser(e.id, {
      blocked_login: d.blocked_login,
      blocked_cards: d.blocked_cards,
      blocked_referral: d.blocked_referral,
    }).subscribe({
      next: () => {
        this.saving.set(false);
        this.patchLocal(e.id, d);
        this.editing.set(null);
        const any = d.blocked_login || d.blocked_cards || d.blocked_referral;
        this.toast.success(any ? 'Блокировка обновлена' : 'Блокировка снята');
      },
      error: (err) => {
        this.saving.set(false);
        this.toast.error(errorMessage(err, 'Не удалось сохранить'));
      },
    });
  }

  private patchLocal(userId: string, patch: Partial<AdminUser>): void {
    this.items.set(this.items().map((u) => (u.id === userId ? { ...u, ...patch } : u)));
  }
}
