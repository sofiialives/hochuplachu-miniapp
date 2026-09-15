import { Component, inject, input, output, signal } from '@angular/core';
import { DialogComponent } from '../../ui/dialog.component';
import { ButtonComponent } from '../../ui/button.component';
import { ReferralApi } from '../../core/api/referral.api';
import { ToastService } from '../../core/notifications/toast.service';
import { errorMessage } from '../../core/errors/api-error';
import { formatReferralAmount } from '../../core/referral/referral-format';

// WithdrawRequestDialog — заявка ПАРТНЁРА на вывод заработанного. В отличие от
// WithdrawDialog (мгновенное зачисление на свою карту у обычного рефовода),
// партнёр получает реальные деньги: он указывает реквизиты свободным текстом
// (USDT-адрес, счёт…), заявка резервирует все pending-начисления валюты, а
// оператор переводит сумму вне системы и помечает заявку выплаченной в админке.
// На вход — amount/currency с кнопки «Вывести N» реф-диалога.
@Component({
  selector: 'app-withdraw-request-dialog',
  standalone: true,
  imports: [DialogComponent, ButtonComponent],
  template: `<app-dialog title="Заявка на вывод" (dismissed)="dismissed.emit()">
    <p class="hint">К выводу: <b>{{ amountLabel() }}</b></p>
    <p class="muted">Укажите реквизиты для выплаты (например, USDT-адрес и сеть или номер счёта).
      Заявку рассмотрит оператор; о решении придёт уведомление.</p>
    <label class="req">
      <span>Реквизиты</span>
      <textarea rows="3" maxlength="512" [value]="requisites()"
        (input)="requisites.set($any($event.target).value)"
        placeholder="TRC20: T… / счёт / другой способ"></textarea>
    </label>
    <app-button variant="primary" [full]="true" [loading]="submitting()"
      [disabled]="!requisites().trim() || submitting()" (clicked)="submit()">
      Отправить заявку на {{ amountLabel() }}
    </app-button>
  </app-dialog>`,
  styles: [`
    .hint { color: var(--color-body); margin: 0 0 var(--space-sm); }
    .muted { color: var(--color-muted); font-size: 14px; margin: 0 0 var(--space-md); }
    .req { display: flex; flex-direction: column; gap: 6px; margin: 0 0 var(--space-md); font-size: 13px; color: var(--color-muted); }
    .req textarea {
      padding: 10px 12px; resize: vertical; min-height: 72px;
      border: 1px solid var(--color-hairline);
      border-radius: var(--rounded-md);
      background: var(--color-canvas); color: var(--color-ink);
      font: inherit;
    }
    .req textarea:focus { outline: none; border-color: var(--color-primary); }
  `],
})
export class WithdrawRequestDialog {
  private readonly refApi = inject(ReferralApi);
  private readonly toast = inject(ToastService);

  readonly amount = input.required<number>();
  readonly currency = input.required<string>();
  readonly dismissed = output<void>();
  readonly success = output<void>();

  protected readonly requisites = signal('');
  protected readonly submitting = signal(false);

  protected amountLabel(): string {
    return formatReferralAmount(this.amount(), this.currency());
  }

  submit(): void {
    if (!this.requisites().trim()) return;
    this.submitting.set(true);
    this.refApi.createWithdrawal(this.currency(), this.requisites().trim()).subscribe({
      next: () => {
        this.submitting.set(false);
        this.toast.success('Заявка отправлена — о решении придёт уведомление');
        this.success.emit();
      },
      error: (e) => {
        this.submitting.set(false);
        this.toast.error(errorMessage(e, 'Не удалось отправить заявку'));
      },
    });
  }
}
