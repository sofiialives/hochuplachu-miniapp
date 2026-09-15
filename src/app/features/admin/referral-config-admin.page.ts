import { Component, OnInit, inject, signal } from '@angular/core';
import { AdminApi } from '../../core/api/admin.api';
import { ReferralConfig } from '../../core/api/referral.api';
import { ButtonComponent } from '../../ui/button.component';
import { InputComponent } from '../../ui/input.component';
import { ToastService } from '../../core/notifications/toast.service';
import { errorMessage } from '../../core/errors/api-error';

// ReferralConfigAdminPage — редактирование singleton-настроек реф-программы.
// Поля:
//   - referrer_reward — что получает рефовод при первой оплаченной карте
//   - referee_bonus   — пригласительный бонус приглашённому (зачисляется на
//                       карту при первом пополнении первой открытой карты).
//                       0 = отключено, тогда welcome-диалог не показывается
//                       и пункт условий «$N другу» скрывается
//   - currency        — валюта обеих величин
//
// Сохранение — PATCH /admin/referral/config; backend сбрасывает кеш сервиса.
@Component({
  selector: 'app-referral-config-admin',
  standalone: true,
  imports: [ButtonComponent, InputComponent],
  template: `<h1>Реферальная программа</h1>
    <p class="hint">Настройки применяются мгновенно ко всем пользователям. Установите бонус приглашённому в 0, чтобы скрыть его в интерфейсе.</p>
    <form (submit)="save($event)">
      <label>
        <span>Награда рефоводу (за первую оплаченную карту приглашённого)</span>
        <app-input [value]="referrerReward()" (valueChange)="referrerReward.set($event)" inputmode="decimal" />
      </label>
      <label>
        <span>Пригласительный бонус приглашённому (зачисляется на карту при первом пополнении первой карты)</span>
        <app-input [value]="refereeBonus()" (valueChange)="refereeBonus.set($event)" inputmode="decimal" />
      </label>
      <label>
        <span>Валюта</span>
        <app-input [value]="currency()" (valueChange)="currency.set($event.toUpperCase())" />
      </label>
      <app-button variant="primary" type="submit" [loading]="loading()">Сохранить</app-button>
    </form>`,
  styles: [`
    .hint { color: var(--color-muted); margin-bottom: var(--space-md); }
    form { display: flex; flex-direction: column; gap: var(--space-md); max-width: 480px; }
    label { display: flex; flex-direction: column; gap: 6px; }
    label > span { font-size: 13px; color: var(--color-body); }
  `],
})
export class ReferralConfigAdminPage implements OnInit {
  private readonly api = inject(AdminApi);
  private readonly toast = inject(ToastService);

  protected readonly referrerReward = signal('10');
  protected readonly refereeBonus = signal('5');
  protected readonly currency = signal('USD');
  protected readonly loading = signal(false);

  ngOnInit(): void {
    this.api.getReferralConfig().subscribe({
      next: (cfg) => this.setFromConfig(cfg),
      error: (e) => this.toast.error(errorMessage(e, 'Не удалось загрузить настройки')),
    });
  }

  save(event?: Event): void {
    if (event) event.preventDefault();
    const reward = parseFloat(this.referrerReward());
    const bonus = parseFloat(this.refereeBonus());
    if (!Number.isFinite(reward) || reward < 0 || !Number.isFinite(bonus) || bonus < 0) {
      this.toast.error('Суммы должны быть числами ≥ 0');
      return;
    }
    const currency = this.currency().trim().toUpperCase();
    if (!currency) {
      this.toast.error('Укажите валюту');
      return;
    }
    this.loading.set(true);
    this.api.updateReferralConfig({
      referrer_reward: reward,
      referee_bonus: bonus,
      currency,
    }).subscribe({
      next: (cfg) => {
        this.loading.set(false);
        this.setFromConfig(cfg);
        this.toast.success('Сохранено');
      },
      error: (e) => {
        this.loading.set(false);
        this.toast.error(errorMessage(e, 'Не удалось сохранить'));
      },
    });
  }

  private setFromConfig(cfg: ReferralConfig): void {
    this.referrerReward.set(String(cfg.referrer_reward));
    this.refereeBonus.set(String(cfg.referee_bonus));
    this.currency.set(cfg.currency);
  }
}
