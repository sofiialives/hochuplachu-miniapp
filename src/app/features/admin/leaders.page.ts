import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { ActivatedRoute, Router } from '@angular/router';
import { AdminApi, LeaderRow } from '../../core/api/admin.api';
import { ToastService } from '../../core/notifications/toast.service';
import { errorMessage } from '../../core/errors/api-error';
import { formatAmount } from '../../core/currency/currency-symbols';

// LeadersPage — единая таблица лидерборда. Используется и /admin/referral/leaders,
// и /admin/partners/leaders — отличаются только source-method'ом API и
// маршрутом перехода к деталям. Режим читается из ActivatedRoute.data.mode.
//
// Колонки: пользователь (имя + email/телега) · приглашено · оплачено карт ·
// выплачено / в ожидании · last IP. Клик по строке открывает details-страницу
// в том же разделе (/admin/referral/users/:id или /admin/partners/users/:id).
@Component({
  selector: 'app-leaders-page',
  standalone: true,
  imports: [DatePipe],
  template: `<div class="head">
      <h1>{{ title() }}</h1>
      <span class="muted">всего: {{ total() }}</span>
    </div>
    <div class="filters">
      <input
        type="search"
        class="search"
        [value]="query()"
        (input)="onQueryInput($event)"
        (keydown.enter)="searchNow()"
        placeholder="Поиск по email / имени / коду…" />
      @if (query()) { <button class="clear" type="button" (click)="clearQuery()">×</button> }
    </div>
    @if (loading()) {
      <p class="muted">Загрузка…</p>
    } @else if (leaders().length === 0) {
      <p class="muted">
        @if (query()) { Ничего не найдено по запросу «{{ query() }}». }
        @else { Пока нет {{ mode() === 'partner' ? 'партнёров' : 'рефоводов' }} с активностью. }
      </p>
    } @else {
      <table>
        <thead><tr>
          <th>Пользователь</th>
          <th>Приглашено</th>
          <th>Карт оплачено</th>
          <th>Выплачено</th>
          <th>В ожидании</th>
          <th>Last IP</th>
          <th>Last seen</th>
        </tr></thead>
        <tbody>
          @for (row of leaders(); track row.user.id) {
            <tr (click)="openDetails(row)">
              <td>
                <div class="user">
                  <b>{{ userName(row) }}</b>
                  <span class="muted">{{ userSub(row) }}</span>
                </div>
              </td>
              <td>{{ row.invited }}</td>
              <td>{{ row.paid_cards }}</td>
              <td>{{ money(row.total_paid, row.currency) }}</td>
              <td>{{ money(row.pending_amount, row.currency) }}</td>
              <td class="ip">{{ row.last_ip || '—' }}</td>
              <td class="muted">{{ row.last_seen_at ? (row.last_seen_at | date:'d MMM y, HH:mm') : '—' }}</td>
            </tr>
          }
        </tbody>
      </table>

      <div class="pager">
        <button (click)="prev()" [disabled]="offset() === 0">← Назад</button>
        <span class="muted">{{ offset() + 1 }}–{{ offset() + leaders().length }} из {{ total() }}</span>
        <button (click)="next()" [disabled]="offset() + leaders().length >= total()">Далее →</button>
      </div>
    }`,
  styles: [`
    .head { display: flex; align-items: baseline; gap: var(--space-md); margin-bottom: var(--space-md); }
    .head h1 { margin: 0; }
    .muted { color: var(--color-muted); font-size: 13px; }
    .filters { display: flex; align-items: center; gap: var(--space-sm); margin-bottom: var(--space-md); max-width: 420px; position: relative; }
    .search {
      flex: 1; padding: 8px 32px 8px 12px; border: 1px solid var(--color-hairline);
      border-radius: var(--rounded-sm); background: var(--color-canvas); font-size: 14px;
    }
    .search:focus { outline: none; border-color: var(--color-primary); }
    .clear {
      position: absolute; right: 8px; top: 50%; transform: translateY(-50%);
      background: transparent; border: 0; cursor: pointer; font-size: 18px; line-height: 1; color: var(--color-muted);
    }
    .clear:hover { color: var(--color-ink); }
    table { width: 100%; border-collapse: collapse; }
    th, td { padding: 10px; text-align: left; border-bottom: 1px solid var(--color-hairline); font-size: 14px; }
    tbody tr { cursor: pointer; }
    tbody tr:hover { background: var(--color-surface-card); }
    .user { display: flex; flex-direction: column; gap: 2px; }
    .user b { font-weight: 500; }
    .ip { font-family: var(--font-mono, ui-monospace, SFMono-Regular, monospace); font-size: 13px; }
    .pager { display: flex; gap: var(--space-md); align-items: center; justify-content: center; margin-top: var(--space-lg); }
    .pager button { background: var(--color-canvas); border: 1px solid var(--color-hairline); padding: 6px 12px; border-radius: var(--rounded-sm); cursor: pointer; }
    .pager button:disabled { opacity: .4; cursor: not-allowed; }
  `],
})
export class LeadersPage implements OnInit {
  private readonly api = inject(AdminApi);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly toast = inject(ToastService);

  protected readonly mode = signal<'referral' | 'partner'>('referral');
  protected readonly loading = signal(true);
  protected readonly leaders = signal<LeaderRow[]>([]);
  protected readonly total = signal(0);
  protected readonly limit = signal(50);
  protected readonly offset = signal(0);
  // query — текущее значение поисковой строки. На каждый ввод запускается
  // debounce'нутый load (300 мс), чтобы не дёргать /admin/.../leaders на каждом
  // нажатии клавиши. Любое изменение query сбрасывает offset в 0.
  protected readonly query = signal('');
  private debounceHandle: ReturnType<typeof setTimeout> | null = null;

  protected readonly title = computed(() =>
    this.mode() === 'partner' ? 'Лидерборд партнёров' : 'Рефоводы',
  );

  ngOnInit(): void {
    // mode идёт из routes data (см. app.routes.ts). Default 'referral'.
    const m = this.route.snapshot.data?.['mode'] as 'referral' | 'partner' | undefined;
    if (m) this.mode.set(m);
    this.load();
  }

  protected userName(row: LeaderRow): string {
    const parts = [row.user.first_name, row.user.last_name].filter(Boolean);
    if (parts.length > 0) return parts.join(' ');
    if (row.user.email) return row.user.email;
    if (row.user.username) return '@' + row.user.username;
    if (row.user.telegram_id) return 'tg:' + row.user.telegram_id;
    return row.user.id;
  }

  // userSub — вторая строка под именем. Email/username включаем сюда, только
  // если они не использованы как primary в userName — иначе получился бы
  // дубликат. @username важен для админа, чтобы быстро открыть диалог с
  // TG-юзером (по числовому id не напишешь).
  protected userSub(row: LeaderRow): string {
    const primary = this.userName(row);
    const bits: string[] = [];
    if (row.user.email && primary !== row.user.email) {
      bits.push(row.user.email);
    }
    if (row.user.username && primary !== '@' + row.user.username) {
      bits.push('@' + row.user.username);
    }
    if (row.user.telegram_id) bits.push('tg:' + row.user.telegram_id);
    bits.push('код ' + row.user.referral_code);
    return bits.join(' · ');
  }

  protected openDetails(row: LeaderRow): void {
    const base = this.mode() === 'partner' ? '/admin/partners/users' : '/admin/referral/users';
    this.router.navigate([base, row.user.id]);
  }

  protected onQueryInput(event: Event): void {
    const value = (event.target as HTMLInputElement).value;
    this.query.set(value);
    this.scheduleReload();
  }

  protected clearQuery(): void {
    this.query.set('');
    this.offset.set(0);
    this.load();
  }

  // searchNow — немедленный поиск по Enter: отменяет debounce и грузит сразу.
  protected searchNow(): void {
    if (this.debounceHandle) clearTimeout(this.debounceHandle);
    this.offset.set(0);
    this.load();
  }

  protected prev(): void {
    const next = Math.max(0, this.offset() - this.limit());
    if (next !== this.offset()) {
      this.offset.set(next);
      this.load();
    }
  }

  protected next(): void {
    const next = this.offset() + this.limit();
    if (next < this.total()) {
      this.offset.set(next);
      this.load();
    }
  }

  // scheduleReload — debounce 300 мс. Сбрасывает offset (новый поиск всегда
  // показывает первую страницу).
  private scheduleReload(): void {
    if (this.debounceHandle) clearTimeout(this.debounceHandle);
    this.debounceHandle = setTimeout(() => {
      this.offset.set(0);
      this.load();
    }, 300);
  }

  private load(): void {
    this.loading.set(true);
    const q = this.query();
    const fetcher = this.mode() === 'partner'
      ? this.api.partnersLeaders(this.limit(), this.offset(), q)
      : this.api.referralLeaders(this.limit(), this.offset(), q);
    fetcher.subscribe({
      next: (r) => {
        this.leaders.set(r.leaders);
        this.total.set(r.total);
        this.loading.set(false);
      },
      error: (e) => {
        this.loading.set(false);
        this.toast.error(errorMessage(e, 'Не удалось загрузить лидерборд'));
      },
    });
  }

  protected money(v: number | string | null | undefined, c: string | null | undefined): string {
    return formatAmount(v, c);
  }
}
