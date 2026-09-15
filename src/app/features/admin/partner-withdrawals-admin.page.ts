import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { AdminApi, AdminUserBrief, AdminWithdrawal } from '../../core/api/admin.api';
import { ButtonComponent } from '../../ui/button.component';
import { InputComponent } from '../../ui/input.component';
import { DialogComponent } from '../../ui/dialog.component';
import { ToastService } from '../../core/notifications/toast.service';
import { errorMessage } from '../../core/errors/api-error';
import { formatAmount } from '../../core/currency/currency-symbols';

// Заявки партнёров на вывод реальных денег (таб «Заявки» раздела «Партнёры»).
// Партнёр резервирует заявкой все pending-начисления валюты и указывает
// реквизиты; оператор переводит деньги ВНЕ системы и жмёт «Выплачено», либо
// «Отклонить» — начисления возвращаются партнёру в «доступно к выводу».
@Component({
  selector: 'app-partner-withdrawals-admin',
  standalone: true,
  imports: [ButtonComponent, InputComponent, DialogComponent, DatePipe],
  template: `<div class="toolbar">
      <label class="select">
        <span>Статус</span>
        <select [value]="status()" (change)="setStatus($any($event.target).value)">
          <option value="pending">На рассмотрении</option>
          <option value="paid">Выплаченные</option>
          <option value="rejected">Отклонённые</option>
          <option value="">Все</option>
        </select>
      </label>
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
        <th>Дата</th><th>Партнёр</th><th>Сумма</th><th>Реквизиты</th><th>Статус</th><th>Комментарий</th><th></th>
      </tr></thead>
      <tbody>
        @for (w of items(); track w.id) {
          <tr>
            <td class="nowrap">{{ w.created_at | date:'d MMM y HH:mm' }}</td>
            <td>{{ partnerLabel(w) }}</td>
            <td class="nowrap"><b>{{ amountLabel(w) }}</b></td>
            <td class="req">{{ w.requisites }}</td>
            <td>
              <span class="badge" [class.paid]="w.status === 'paid'" [class.rejected]="w.status === 'rejected'">
                {{ statusLabel(w.status) }}
              </span>
              @if (w.resolved_at) {
                <div class="muted">{{ w.resolved_at | date:'d MMM y HH:mm' }}</div>
              }
            </td>
            <td class="req">{{ w.admin_comment || '—' }}</td>
            <td class="nowrap">
              @if (w.status === 'pending') {
                <button class="link" (click)="openResolve(w, true)">Выплачено</button>
                <button class="link red" (click)="openResolve(w, false)">Отклонить</button>
              }
            </td>
          </tr>
        } @empty {
          <tr><td colspan="7" class="empty">Заявок нет</td></tr>
        }
      </tbody>
    </table>

    <div class="pager">
      <app-button variant="ghost" (clicked)="prev()" [disabled]="page() <= 1">‹ Назад</app-button>
      <span>Страница {{ page() }} из {{ totalPages() }}</span>
      <app-button variant="ghost" (clicked)="next()" [disabled]="page() >= totalPages()">Вперёд ›</app-button>
    </div>

    @if (resolving(); as r) {
      <app-dialog [title]="r.approve ? 'Подтвердить выплату' : 'Отклонить заявку'" (dismissed)="resolving.set(null)">
        <p class="confirm-text">
          @if (r.approve) {
            Вы перевели <b>{{ amountLabel(r.w) }}</b> партнёру <b>{{ partnerLabel(r.w) }}</b> по реквизитам:
          } @else {
            Заявка партнёра <b>{{ partnerLabel(r.w) }}</b> на <b>{{ amountLabel(r.w) }}</b> будет отклонена,
            начисления вернутся в «доступно к выводу». Реквизиты:
          }
        </p>
        <p class="req-box">{{ r.w.requisites }}</p>
        <app-input [(value)]="commentC" [label]="r.approve ? 'Комментарий (опц.)' : 'Причина отказа (увидит партнёр)'" />
        <app-button variant="primary" [full]="true" [loading]="submitting()"
          [disabled]="submitting()" (clicked)="resolve()">
          {{ r.approve ? 'Подтвердить выплату' : 'Отклонить' }}
        </app-button>
      </app-dialog>
    }`,
  styles: [`
    .toolbar { display: flex; flex-wrap: wrap; gap: 12px; align-items: end; margin: 0 0 var(--space-md); }
    .select { display: flex; flex-direction: column; gap: 6px; font-size: 13px; color: var(--color-muted); }
    .select:last-child { margin-left: auto; }
    .select select {
      height: 44px; padding: 10px 14px;
      border: 1px solid var(--color-hairline);
      border-radius: var(--rounded-md);
      background: var(--color-canvas); color: var(--color-ink);
      font: inherit; min-width: 120px;
    }
    .select select:focus { outline: none; border-color: var(--color-primary); }
    .meta { color: var(--color-muted); font-size: 13px; margin-bottom: 8px; }
    table { width: 100%; border-collapse: collapse; }
    th, td { padding: 10px; text-align: left; border-bottom: 1px solid var(--color-hairline); vertical-align: top; }
    .nowrap { white-space: nowrap; }
    .req { max-width: 280px; overflow-wrap: anywhere; font-size: 13px; }
    .empty { text-align: center; color: var(--color-muted); padding: 24px; }
    .muted { color: var(--color-muted); font-size: 12px; margin-top: 2px; }
    .badge {
      font-size: 12px; padding: 2px 8px; border-radius: 999px; white-space: nowrap;
      background: color-mix(in srgb, var(--color-warning, #b97900) 14%, transparent); color: var(--color-warning, #b97900);
    }
    .badge.paid { background: color-mix(in srgb, var(--color-success, #2e7d32) 14%, transparent); color: var(--color-success, #2e7d32); }
    .badge.rejected { background: color-mix(in srgb, var(--color-error, #c62828) 14%, transparent); color: var(--color-error, #c62828); }
    .link { color: var(--color-primary-ink); margin-right: 8px; background: none; border: none; cursor: pointer; padding: 0; font: inherit; }
    .link.red { color: var(--color-error); }
    .pager { display: flex; align-items: center; gap: 12px; margin-top: var(--space-md); justify-content: center; }
    .confirm-text { color: var(--color-body); font-size: 14px; margin: 0 0 var(--space-sm); }
    .req-box {
      padding: 10px 12px; margin: 0 0 var(--space-sm);
      background: var(--color-surface-card); border-radius: var(--rounded-md);
      font-size: 13px; overflow-wrap: anywhere;
    }
  `],
})
export class PartnerWithdrawalsAdminPage implements OnInit {
  private readonly api = inject(AdminApi);
  private readonly toast = inject(ToastService);

  protected readonly items = signal<AdminWithdrawal[]>([]);
  protected readonly users = signal<Record<string, AdminUserBrief>>({});
  /** Фильтр статуса; дефолт pending — оператору в первую очередь нужны нерешённые. */
  protected readonly status = signal('pending');

  protected readonly total = signal(0);
  protected readonly page = signal(1);
  protected readonly pageSize = signal(25);
  protected readonly totalPages = computed(() => {
    const t = this.total();
    const ps = this.pageSize();
    if (t === 0 || ps === 0) return 1;
    return Math.ceil(t / ps);
  });

  /** Открытый диалог решения: заявка + вид действия. */
  protected readonly resolving = signal<{ w: AdminWithdrawal; approve: boolean } | null>(null);
  protected readonly commentC = signal('');
  protected readonly submitting = signal(false);

  ngOnInit(): void {
    this.refresh();
  }

  refresh(): void {
    this.api.listPartnerWithdrawals({ page: this.page(), page_size: this.pageSize(), status: this.status() }).subscribe({
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
      error: (e) => this.toast.error(errorMessage(e, 'Не удалось загрузить заявки')),
    });
  }

  protected setStatus(v: string): void {
    this.status.set(v);
    this.page.set(1);
    this.refresh();
  }

  protected setPageSize(v: string): void {
    const n = parseInt(v, 10);
    if (!isNaN(n) && n > 0) {
      this.pageSize.set(n);
      this.page.set(1);
      this.refresh();
    }
  }
  protected prev(): void {
    if (this.page() > 1) {
      this.page.set(this.page() - 1);
      this.refresh();
    }
  }
  protected next(): void {
    if (this.page() < this.totalPages()) {
      this.page.set(this.page() + 1);
      this.refresh();
    }
  }

  protected partnerLabel(w: AdminWithdrawal): string {
    const u = this.users()[w.user_id];
    if (!u) return w.user_id;
    const name = [u.first_name, u.last_name].filter(Boolean).join(' ');
    return u.email || name || u.username || (u.telegram_id ? `tg:${u.telegram_id}` : w.user_id);
  }

  protected amountLabel(w: AdminWithdrawal): string {
    return formatAmount(w.amount, w.currency);
  }

  protected statusLabel(status: AdminWithdrawal['status']): string {
    if (status === 'paid') return 'выплачено';
    if (status === 'rejected') return 'отклонено';
    return 'на рассмотрении';
  }

  protected openResolve(w: AdminWithdrawal, approve: boolean): void {
    this.commentC.set('');
    this.resolving.set({ w, approve });
  }

  protected resolve(): void {
    const r = this.resolving();
    if (!r) return;
    this.submitting.set(true);
    const obs = r.approve
      ? this.api.markPartnerWithdrawalPaid(r.w.id, this.commentC().trim())
      : this.api.rejectPartnerWithdrawal(r.w.id, this.commentC().trim());
    obs.subscribe({
      next: () => {
        this.submitting.set(false);
        this.resolving.set(null);
        this.toast.success(r.approve ? 'Выплата подтверждена' : 'Заявка отклонена');
        this.refresh();
      },
      error: (e) => {
        this.submitting.set(false);
        this.toast.error(errorMessage(e, 'Не удалось сохранить решение'));
      },
    });
  }
}
