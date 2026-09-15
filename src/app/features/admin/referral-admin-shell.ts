import { Component } from '@angular/core';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';

// ReferralAdminShell — обёртка для /admin/referral. Объединяет «Конфиг» и
// «Рефоводы» (лидерборд) под одной вкладкой sidebar'а, чтобы не плодить пункты
// меню верхнего уровня и не разрывать тематический раздел. Состояние вкладки
// — через URL (router-outlet), не сохраняется при перезагрузке вне намеренно.
@Component({
  selector: 'app-referral-admin-shell',
  standalone: true,
  imports: [RouterLink, RouterLinkActive, RouterOutlet],
  template: `<div class="tabs">
      <a routerLink="config" routerLinkActive="active">Конфиг</a>
      <a routerLink="leaders" routerLinkActive="active">Рефоводы</a>
    </div>
    <router-outlet />`,
  styles: [`
    .tabs { display: flex; gap: 4px; border-bottom: 1px solid var(--color-hairline); margin-bottom: var(--space-lg); }
    .tabs a {
      padding: 10px 16px; text-decoration: none; color: var(--color-muted);
      border-bottom: 2px solid transparent; font-weight: 500; font-size: 14px;
      margin-bottom: -1px;
    }
    .tabs a.active { color: var(--color-ink); border-bottom-color: var(--color-primary-ink); }
  `],
})
export class ReferralAdminShell {}
