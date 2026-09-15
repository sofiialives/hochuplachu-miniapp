import { Component, OnInit, inject, signal } from '@angular/core';
import { DatePipe, JsonPipe } from '@angular/common';
import { ActivatedRoute } from '@angular/router';
import { AdminApi, LeaderDetailsResponse } from '../../core/api/admin.api';
import { ToastService } from '../../core/notifications/toast.service';
import { errorMessage } from '../../core/errors/api-error';
import { formatAmount } from '../../core/currency/currency-symbols';

// LeaderDetailsPage — карточка одного рефовода / партнёра. mode из route.data.
// Содержит:
//   - профиль (имя, контакты, last IP, last seen);
//   - сводку статистики (приглашено / оплачено / выплачено / pending);
//   - партнёрский конфиг (только для partner mode);
//   - историю payouts со статусами;
//   - список приглашённых (с last_ip каждого — основной артефакт антифрод-сверки);
//   - audit-log пользователя (события + IP + User-Agent + meta).
@Component({
  selector: 'app-leader-details-page',
  standalone: true,
  imports: [DatePipe, JsonPipe],
  template: `@if (loading()) {
      <p class="muted">Загрузка…</p>
    } @else if (data(); as d) {
      <header class="hdr">
        <a class="back" href="javascript:history.back()">‹ назад к лидерборду</a>
        <h1>{{ name(d) }}</h1>
        <div class="sub muted">
          @if (d.user.email) { <span>{{ d.user.email }}</span> }
          @if (d.user.username) { <span>@{{ d.user.username }}</span> }
          @if (d.user.telegram_id) { <span>tg:{{ d.user.telegram_id }}</span> }
          <span>код {{ d.user.referral_code }}</span>
          <span>тип {{ d.user.referral_type }}</span>
          <span>с {{ d.user.created_at | date:'d MMM y' }}</span>
        </div>
      </header>

      <section class="grid">
        <div class="card">
          <h3>Статистика</h3>
          <ul class="kv">
            <li><span>Приглашено</span><b>{{ d.stats.invited }}</b></li>
            <li><span>Оплатило карту</span><b>{{ d.stats.paid_cards }}</b></li>
            <li><span>Выплачено</span><b>{{ money(d.stats.total_payout, d.stats.currency) }}</b></li>
            @for (p of d.stats.pending; track p.currency) {
              <li><span>В ожидании</span><b>{{ money(p.amount, p.currency) }} ({{ p.count }})</b></li>
            }
          </ul>
        </div>
        @if (d.partner_config; as pc) {
          <div class="card">
            <h3>Партнёрский конфиг</h3>
            <ul class="kv">
              <li><span>Ставка</span><b>{{ money(pc.amount, pc.currency) }}</b></li>
              <li><span>Level</span><b>{{ pc.level }}</b></li>
              @if (pc.comment) { <li><span>Комментарий</span><b>{{ pc.comment }}</b></li> }
            </ul>
          </div>
        }
      </section>

      <section>
        <h3>Приглашённые ({{ d.invited.length }})</h3>
        @if (d.invited.length === 0) {
          <p class="muted">Никого не пригласил.</p>
        } @else {
          <table>
            <thead><tr>
              <th>Пользователь</th>
              <th>Регистрация</th>
              <th>Карт оплачено</th>
              <th>Last IP</th>
              <th>Last seen</th>
            </tr></thead>
            <tbody>
              @for (i of d.invited; track i.id) {
                <tr>
                  <td>
                    <div class="user">
                      <b>{{ inviteName(i) }}</b>
                      <span class="muted">{{ inviteSub(i) }}</span>
                    </div>
                  </td>
                  <td class="muted">{{ i.created_at | date:'d MMM y, HH:mm' }}</td>
                  <td>{{ i.paid_cards }}</td>
                  <td class="ip">{{ i.last_ip || '—' }}</td>
                  <td class="muted">{{ i.last_seen_at ? (i.last_seen_at | date:'d MMM y, HH:mm') : '—' }}</td>
                </tr>
              }
            </tbody>
          </table>
        }
      </section>

      <section>
        <h3>История выплат ({{ d.payouts.length }})</h3>
        @if (d.payouts.length === 0) {
          <p class="muted">Выплат ещё не было.</p>
        } @else {
          <table>
            <thead><tr>
              <th>Дата</th>
              <th>Сумма</th>
              <th>Статус</th>
              <th>Связанный topup</th>
              <th>Карта-заявка</th>
              <th>Партнёр-override</th>
            </tr></thead>
            <tbody>
              @for (p of d.payouts; track p.id) {
                <tr>
                  <td class="muted">{{ (p.paid_at || p.created_at) | date:'d MMM y, HH:mm' }}</td>
                  <td>{{ money(p.amount, p.currency) }}</td>
                  <td>
                    <span class="status" [class.paid]="p.status === 'paid'">{{ p.status }}</span>
                  </td>
                  <td class="muted">{{ p.payout_topup_id || '—' }}</td>
                  <td class="muted">{{ p.triggering_card_order_id || '—' }}</td>
                  <td>{{ p.partner_override ? 'да' : 'нет' }}</td>
                </tr>
              }
            </tbody>
          </table>
        }
      </section>

      <section>
        <h3>Аудит-лог пользователя ({{ d.audit.length }})</h3>
        @if (d.audit.length === 0) {
          <p class="muted">Событий нет (модель audit включена недавно — данные появятся по мере действий).</p>
        } @else {
          <table>
            <thead><tr>
              <th>Когда</th>
              <th>Событие</th>
              <th>IP</th>
              <th>User-Agent</th>
              <th>Meta</th>
            </tr></thead>
            <tbody>
              @for (e of d.audit; track e.id) {
                <tr>
                  <td class="muted">{{ e.created_at | date:'d MMM y, HH:mm:ss' }}</td>
                  <td>{{ e.event }}</td>
                  <td class="ip">{{ e.ip || '—' }}</td>
                  <td class="ua">{{ e.user_agent || '—' }}</td>
                  <td class="meta">{{ e.meta | json }}</td>
                </tr>
              }
            </tbody>
          </table>
        }
      </section>
    }`,
  styles: [`
    .hdr { margin-bottom: var(--space-lg); }
    .hdr h1 { margin: var(--space-xs) 0 0; }
    .back { color: var(--color-muted); font-size: 13px; text-decoration: none; }
    .back:hover { color: var(--color-ink); }
    .sub { display: flex; flex-wrap: wrap; gap: var(--space-sm); margin-top: 4px; font-size: 13px; }
    .muted { color: var(--color-muted); font-size: 13px; }
    .grid { display: grid; grid-template-columns: 1fr 1fr; gap: var(--space-md); margin-bottom: var(--space-lg); }
    .card { background: var(--color-surface-card); padding: var(--space-md); border-radius: var(--rounded-md); }
    .card h3 { margin: 0 0 var(--space-sm); font-size: 14px; font-weight: 500; }
    .kv { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: 6px; font-size: 14px; }
    .kv li { display: flex; justify-content: space-between; }
    .kv span { color: var(--color-muted); }

    section { margin-bottom: var(--space-xl); }
    section h3 { margin: 0 0 var(--space-sm); font-size: 14px; font-weight: 500; color: var(--color-muted); }
    table { width: 100%; border-collapse: collapse; font-size: 14px; }
    th, td { padding: 8px 10px; text-align: left; border-bottom: 1px solid var(--color-hairline); vertical-align: top; }
    th { font-weight: 500; font-size: 13px; color: var(--color-muted); }
    .user { display: flex; flex-direction: column; gap: 2px; }
    .user b { font-weight: 500; }
    .ip { font-family: var(--font-mono, ui-monospace, monospace); font-size: 13px; }
    .ua { max-width: 320px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 12px; color: var(--color-muted); }
    .meta { max-width: 320px; font-family: var(--font-mono, ui-monospace, monospace); font-size: 12px; color: var(--color-body); word-break: break-word; }
    .status { font-size: 12px; padding: 2px 8px; border-radius: 999px; background: color-mix(in srgb, var(--color-warning, #b97900) 14%, transparent); color: var(--color-warning, #b97900); }
    .status.paid { background: color-mix(in srgb, var(--color-success, #2e7d32) 14%, transparent); color: var(--color-success, #2e7d32); }
    @media(max-width: 768px) { .grid { grid-template-columns: 1fr; } }
  `],
})
export class LeaderDetailsPage implements OnInit {
  private readonly api = inject(AdminApi);
  private readonly route = inject(ActivatedRoute);
  private readonly toast = inject(ToastService);

  protected readonly loading = signal(true);
  protected readonly data = signal<LeaderDetailsResponse | null>(null);

  ngOnInit(): void {
    const mode = (this.route.snapshot.data?.['mode'] ?? 'referral') as 'referral' | 'partner';
    const userId = this.route.snapshot.paramMap.get('userId') ?? '';
    if (!userId) {
      this.loading.set(false);
      this.toast.error('Не указан userId');
      return;
    }
    const fetcher = mode === 'partner'
      ? this.api.partnerUserDetails(userId)
      : this.api.referralUserDetails(userId);
    fetcher.subscribe({
      next: (r) => {
        this.data.set(r);
        this.loading.set(false);
      },
      error: (e) => {
        this.loading.set(false);
        this.toast.error(errorMessage(e, 'Не удалось загрузить данные'));
      },
    });
  }

  protected name(d: LeaderDetailsResponse): string {
    const parts = [d.user.first_name, d.user.last_name].filter(Boolean);
    if (parts.length > 0) return parts.join(' ');
    if (d.user.email) return d.user.email;
    if (d.user.username) return '@' + d.user.username;
    if (d.user.telegram_id) return 'tg:' + d.user.telegram_id;
    return d.user.id;
  }

  protected inviteName(i: { first_name: string; last_name: string; email?: string; username?: string; telegram_id?: number; id: string }): string {
    const parts = [i.first_name, i.last_name].filter(Boolean);
    if (parts.length > 0) return parts.join(' ');
    if (i.email) return i.email;
    if (i.username) return '@' + i.username;
    if (i.telegram_id) return 'tg:' + i.telegram_id;
    return i.id;
  }

  protected inviteSub(i: { first_name: string; last_name: string; email?: string; username?: string; telegram_id?: number }): string {
    const hasName = !!(i.first_name || i.last_name);
    const bits: string[] = [];
    // Email/username добавляем, только если они не стали primary в inviteName
    // (когда имя/фамилия пустые, primary падает на email или @username).
    if (i.email && hasName) bits.push(i.email);
    if (i.username && (hasName || i.email)) bits.push('@' + i.username);
    if (i.telegram_id) bits.push('tg:' + i.telegram_id);
    return bits.join(' · ');
  }

  protected money(v: number | string | null | undefined, c: string | null | undefined): string {
    return formatAmount(v, c);
  }
}
