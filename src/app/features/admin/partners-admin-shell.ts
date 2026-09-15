import { Component } from '@angular/core';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';

// PartnersAdminShell — обёртка для /admin/partners с тремя вкладками:
// «Список» (CRUD конфигов PartnerConfig), «Лидерборд» (топ партнёров по
// выплатам/приглашениям) и «Заявки» (заявки партнёров на вывод реальных
// денег — решает оператор). Страница деталей лежит на /users/:userId.
@Component({
  selector: 'app-partners-admin-shell',
  standalone: true,
  imports: [RouterLink, RouterLinkActive, RouterOutlet],
  template: `<div class="tabs">
      <a routerLink="list" routerLinkActive="active">Список</a>
      <a routerLink="leaders" routerLinkActive="active">Лидерборд</a>
      <a routerLink="withdrawals" routerLinkActive="active">Заявки</a>
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
export class PartnersAdminShell {}
