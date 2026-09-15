import { Component, output } from '@angular/core';

/**
 * VerificationBanner — баннер на главной странице для strict-режима, когда
 * у пользователя есть незакрытые шаги верификации. Стиль повторяет
 * `referral-banner.ts` (cream-карточка, emoji+текст+стрелка). Видимостью
 * управляет родительский шаблон через `verification.needed()`.
 */
@Component({
  selector: 'app-verification-banner',
  standalone: true,
  template: `<button class="banner" (click)="clicked.emit()">
    <span class="emoji">🛡️</span>
    <span class="text"><b>Пройти верификацию</b><br>Завершите проверку, чтобы оформить карту</span>
    <span class="arrow">›</span>
  </button>`,
  styles: [`
    .banner {
      width: 100%; display: flex; align-items: center; gap: 12px;
      padding: var(--space-md);
      background: var(--color-surface-card);
      border-radius: var(--rounded-lg);
      text-align: left; color: var(--color-ink);
      margin: var(--space-md) 0;
    }
    .emoji { font-size: 28px; }
    .text { flex: 1; font-size: 14px; }
    .arrow { color: var(--color-muted); }
  `],
})
export class VerificationBanner {
  readonly clicked = output<void>();
}
