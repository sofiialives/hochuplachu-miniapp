import { Component, inject, input, output, signal } from '@angular/core';
import { Router } from '@angular/router';
import { DialogComponent } from '../../ui/dialog.component';
import { ButtonComponent } from '../../ui/button.component';
import { ReferralApi } from '../../core/api/referral.api';
import { formatReferralAmount } from '../../core/referral/referral-format';

// WelcomeBonusDialog — показывается ОДИН раз пользователю, зарегистрированному
// по реф-ссылке. Текст и сумма приходят от родителя через input (родитель
// берёт bonus_available из /referral/info: приглашённым партнёром и
// приглашённым заблокированного рефовода бэк отдаёт 0 — диалог не показывается).
// Не closable: единственный способ закрыть —
// кнопка «Выбрать карту», которая помечает диалог как увиденный
// (POST /referral/welcome/dismiss) и отправляет пользователя в каталог.
// Если бэк фейлит — всё равно закрываем: «не показать дважды» — серверный
// инвариант, но UX важнее единичной ошибки сети.
@Component({
  selector: 'app-welcome-bonus-dialog',
  standalone: true,
  imports: [DialogComponent, ButtonComponent],
  template: `<app-dialog title="Поздравляем!" [closable]="false">
    <p class="amount">{{ formatted() }}</p>
    <p class="body">Вы получили пригласительный бонус {{ formatted() }} — оформите карту, и он зачислится на неё при первом пополнении.</p>
    <app-button variant="primary" [full]="true" [loading]="loading()" (click)="onPick()">Выбрать карту</app-button>
  </app-dialog>`,
  styles: [`
    .amount {
      text-align: center;
      font-family: 'Gilroy', sans-serif;
      font-size: 34px;
      font-weight: 700;
      color: var(--color-primary-ink);
      margin: 0 0 var(--space-md);
    }
    .body { color: var(--color-body); margin-bottom: var(--space-lg); font-size: 15px; line-height: 1.5; }
  `],
})
export class WelcomeBonusDialog {
  private readonly api = inject(ReferralApi);
  private readonly router = inject(Router);

  readonly amount = input.required<number>();
  readonly currency = input.required<string>();
  readonly dismissed = output<void>();

  protected readonly loading = signal(false);

  protected formatted(): string {
    return formatReferralAmount(this.amount(), this.currency());
  }

  onPick(): void {
    this.loading.set(true);
    this.api.dismissWelcome().subscribe({
      next: () => this.finish(),
      error: () => this.finish(),
    });
  }

  private finish(): void {
    this.loading.set(false);
    this.dismissed.emit();
    // Именно /cards/new: на «/» у авторизованного теперь ЛК (плейсхолдер
    // «нет карт»), а каталог выбора карты живёт на отдельном роуте.
    this.router.navigate(['/cards/new']);
  }
}