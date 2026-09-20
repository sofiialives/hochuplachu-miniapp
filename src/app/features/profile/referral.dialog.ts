import { Component, OnInit, computed, inject, output, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { QRCodeComponent } from 'angularx-qrcode';
import { DialogComponent } from '../../ui/dialog.component';
import { ButtonComponent } from '../../ui/button.component';
import {
  ReferralApi,
  ReferralInfo,
  ReferralPayoutRow,
  ReferralPendingSum,
  ReferralWithdrawalRow,
} from '../../core/api/referral.api';
import { ToastService } from '../../core/notifications/toast.service';
import { AuthService } from '../../core/auth/auth.service';
import { formatReferralAmount } from '../../core/referral/referral-format';
import { WithdrawDialog } from './withdraw-dialog';
import { WithdrawRequestDialog } from './withdraw-request.dialog';

@Component({
  selector: 'app-referral-dialog',
  standalone: true,
  imports: [DialogComponent, ButtonComponent, QRCodeComponent, WithdrawDialog, WithdrawRequestDialog, DatePipe],
  template: `<app-dialog title="Реферальная программа" (dismissed)="closed.emit()">
    @if (info(); as i) {
      <div class="qr">
        <qrcode [qrdata]="i.link" [width]="220" cssClass="qr-canvas" errorCorrectionLevel="M" />
      </div>
      <p class="hint">Отправь свою ссылку-приглашение или покажи QR-код своему другу. Получай вознаграждение, когда он откроет карту.</p>
      <div class="cta">
        <app-button variant="primary" [full]="true" (click)="copy(i.link)">Скопировать ссылку</app-button>
        <button class="toggle" (click)="expanded.set(!expanded())">
          {{ expanded() ? 'Скрыть' : 'Показать' }} условия
        </button>
      </div>
      @if (expanded()) {
        <ul class="rules">
          <!-- Партнёру премия идёт с КАЖДОЙ открытой карты приглашённого,
               обычному рефоводу — только с первой (RewardOnPaidCard бэка). -->
          @if (isPartner()) {
            <li>{{ rewardLabel() }} за каждую карту, открытую приглашёнными пользователями</li>
          } @else {
            <li>{{ rewardLabel() }} за открытие первой карты приглашённым пользователем</li>
          }
          @if (refereeBonusAmount() > 0) {
            <li>{{ refereeLabel() }} на карту получит ваш друг при первом пополнении своей первой карты</li>
          }
        </ul>
      }
      @if (i.stats) {
        <div class="stats">
          <div><b>{{ i.stats.invited }}</b> приглашено</div>
          <div><b>{{ i.stats.paid_cards }}</b> оплатило карту</div>
          <div><b>{{ i.stats.total_payout }} {{ i.stats.currency }}</b> заработано</div>
        </div>
      }

      <!-- Pending — кнопка(и) «Вывести N». Если pending сгруппировано по разным
           валютам — рендерим по кнопке на каждую (один Withdraw покрывает только
           одну валюту). Если пусто — блок не показываем. Партнёру кнопка
           открывает ЗАЯВКУ на вывод (реальные деньги по реквизитам, решает
           оператор), обычному рефоводу — мгновенное зачисление на карту. -->
      @if (pending().length > 0) {
        <div class="withdraw">
          <h4>Доступно к выводу</h4>
          @for (p of pending(); track p.currency) {
            <app-button variant="primary" [full]="true" (click)="openWithdraw(p)">
              Вывести {{ formatPending(p) }}
            </app-button>
          }
        </div>
      }

      <!-- Заявки партнёра на вывод: статусы решений оператора. -->
      @if (withdrawals().length > 0) {
        <div class="history">
          <h4>Заявки на вывод</h4>
          <ul>
            @for (w of withdrawals(); track w.id) {
              <li>
                <div class="line-1">
                  <span class="amount">{{ formatWithdrawal(w) }}</span>
                  <span class="status" [class.paid]="w.status === 'paid'" [class.rejected]="w.status === 'rejected'">
                    {{ withdrawalStatusLabel(w.status) }}
                  </span>
                </div>
                <div class="line-2">
                  <span>{{ (w.resolved_at || w.created_at) | date:'d MMM y' }}</span>
                </div>
                @if (w.status === 'rejected' && w.admin_comment) {
                  <div class="line-2"><span>Причина: {{ w.admin_comment }}</span></div>
                }
              </li>
            }
          </ul>
        </div>
      }

      <!-- История начислений со статусами. Источник правды — referral_payouts,
           которые мы уже грузим вместе с pending-агрегатом. -->
      @if (payouts().length > 0) {
        <div class="history">
          <h4>История начислений</h4>
          <ul>
            @for (p of payouts(); track p.id) {
              <li>
                <div class="line-1">
                  <span class="amount">+{{ formatPayout(p) }}</span>
                  <span class="status" [class.paid]="p.status === 'paid'">
                    {{ payoutStatusLabel(p.status) }}
                  </span>
                </div>
                <div class="line-2">
                  <span>{{ (p.paid_at || p.created_at) | date:'d MMM y' }}</span>
                  @if (p.partner_override) { <span class="tag">партнёр</span> }
                </div>
              </li>
            }
          </ul>
        </div>
      }
    }

    @if (withdrawDialogFor(); as w) {
      <app-withdraw-dialog
        [amount]="w.amount"
        [currency]="w.currency"
        (dismissed)="closeWithdraw()"
        (success)="onWithdrawSuccess()" />
    }

    @if (requestDialogFor(); as w) {
      <app-withdraw-request-dialog
        [amount]="w.amount"
        [currency]="w.currency"
        (dismissed)="requestDialogFor.set(null)"
        (success)="onRequestSuccess()" />
    }
  </app-dialog>`,
  styles: [`
    .qr { display: flex; justify-content: center;  background: white; border-radius: var(--rounded-md);  }
    .hint { color: rgba(0, 0, 0, 1); text-align: center; font-size: 14px; }    .cta { display: flex; flex-direction: column; gap: var(--space-sm); margin-top: var(--space-md); }
    .toggle { color: rgba(255, 186, 38, 1); text-decoration: underline; font-size: 14px; }    .rules { color: var(--color-body); font-size: 14px; padding-left: 20px; }
    .rules li + li { margin-top: 6px; }
    .stats { display: flex; flex-wrap: wrap; gap: 8px; padding: var(--space-md); margin-top: var(--space-md); background: var(--color-surface); border: 1px solid var(--color-hairline); border-radius: var(--rounded-lg); font-size: 12px; font-family: 'Gilroy', sans-serif; }
    .stats > div { flex: 1 1 100px; min-width: 0; }
    :host ::ng-deep h3 { font-size: 26px; }
    @media (min-width: 1024px) {
      :host ::ng-deep h3 { font-size: 32px; }
    }

    .withdraw { margin-top: var(--space-lg); display: flex; flex-direction: column; gap: var(--space-sm); }
    .withdraw h4 { margin: 0 0 4px; font-size: 14px; color: var(--color-muted); font-weight: 500; }

    .history { margin-top: var(--space-lg); }
    .history h4 { margin: 0 0 var(--space-sm); font-size: 14px; color: var(--color-muted); font-weight: 500; }
    .history ul { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: 8px; }
    .history li { padding: 14px 16px; background: var(--color-surface); border: 1px solid var(--color-hairline); border-radius: var(--rounded-lg); font-size: 14px; }
    .history .line-1 { display: flex; justify-content: space-between; align-items: center; }
    .history .line-2 { display: flex; justify-content: space-between; align-items: center; margin-top: 4px; color: var(--color-muted); font-size: 12px; }
    .history .amount { font-weight: 500; color: var(--color-ink); font-family: 'Gilroy', sans-serif; }
    .history .status { font-size: 12px; padding: 2px 8px; border-radius: 999px; background: color-mix(in srgb, var(--color-warning, #b97900) 14%, transparent); color: var(--color-warning, #b97900); }
    .history .status.paid { background: color-mix(in srgb, var(--color-success, #2e7d32) 14%, transparent); color: var(--color-success, #2e7d32); }
    .history .status.rejected { background: color-mix(in srgb, var(--color-error, #c62828) 14%, transparent); color: var(--color-error, #c62828); }
    .history .tag { font-size: 11px; padding: 1px 6px; border-radius: 4px; background: var(--color-hairline); color: var(--color-body); }
  `],
})
export class ReferralDialog implements OnInit {
  private readonly api = inject(ReferralApi);
  private readonly toast = inject(ToastService);
  private readonly auth = inject(AuthService);
  readonly closed = output<void>();
  
  protected readonly isPartner = computed(() => this.auth.user()?.referral_type === 'partner');
  protected readonly info = signal<ReferralInfo | null>(null);
  protected readonly payouts = signal<ReferralPayoutRow[]>([]);
  protected readonly pending = signal<ReferralPendingSum[]>([]);
  protected readonly expanded = signal(false);
  protected readonly withdrawDialogFor = signal<ReferralPendingSum | null>(null);
  protected readonly requestDialogFor = signal<ReferralPendingSum | null>(null);
  
  protected readonly withdrawals = signal<ReferralWithdrawalRow[]>([]);

  protected readonly refereeBonusAmount = computed(() => this.info()?.referee_bonus?.amount ?? 0);

  ngOnInit(): void {
    this.api.info().subscribe((i) => this.info.set(i));
    this.loadPayouts();
    this.loadWithdrawals();
  }

  
  private loadWithdrawals(): void {
    if (!this.isPartner()) return;
    this.api.withdrawals().subscribe({
      next: (r) => this.withdrawals.set(r.items ?? []),
      error: () => undefined,
    });
  }

  protected payoutStatusLabel(status: ReferralPayoutRow['status']): string {
    if (status === 'paid') return 'зачислено';
    if (status === 'reserved') return 'в выплате';
    return 'ожидает';
  }

  protected withdrawalStatusLabel(status: ReferralWithdrawalRow['status']): string {
    if (status === 'paid') return 'выплачено';
    if (status === 'rejected') return 'отклонено';
    return 'на рассмотрении';
  }

  protected formatWithdrawal(w: ReferralWithdrawalRow): string {
    return formatReferralAmount(w.amount, w.currency);
  }

  
  protected onRequestSuccess(): void {
    this.requestDialogFor.set(null);
    this.loadPayouts();
    this.loadWithdrawals();
  }

  protected rewardLabel(): string {
    const i = this.info();
    if (!i) return '';
    return formatReferralAmount(i.reward.amount, i.reward.currency);
  }

  protected refereeLabel(): string {
    const i = this.info();
    if (!i) return '';
    return formatReferralAmount(i.referee_bonus.amount, i.referee_bonus.currency);
  }

  protected formatPayout(p: ReferralPayoutRow): string {
    return formatReferralAmount(p.amount, p.currency);
  }

  protected formatPending(p: ReferralPendingSum): string {
    return formatReferralAmount(p.amount, p.currency);
  }

  openWithdraw(p: ReferralPendingSum): void {
    if (this.isPartner()) {
      this.requestDialogFor.set(p);
    } else {
      this.withdrawDialogFor.set(p);
    }
  }

  closeWithdraw(): void {
    this.withdrawDialogFor.set(null);
  }

  onWithdrawSuccess(): void {
    this.withdrawDialogFor.set(null);
    this.closed.emit();
  }

  private loadPayouts(): void {
    this.api.payouts().subscribe({
      next: (r) => {
        this.payouts.set(r.payouts ?? []);
        this.pending.set(r.pending ?? []);
      },
      error: () => {  },
    });
  }

  copy(link: string): void {
    if (typeof navigator !== 'undefined' && navigator.clipboard) {
      navigator.clipboard.writeText(link).then(() => this.toast.success('Скопировано'));
    }
  }
}