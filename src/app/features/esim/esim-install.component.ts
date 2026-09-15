import { Component, computed, inject, input } from '@angular/core';
import { QRCodeComponent } from 'angularx-qrcode';
import { ButtonComponent } from '../../ui/button.component';
import { CopyButtonComponent } from '../../ui/copy-button.component';
import { AuthService } from '../../core/auth/auth.service';
import { openExternalLink } from '../../core/utils/open-external';
import { detectEsimOS, esimActivationLink } from '../../core/utils/esim-activation';

// EsimInstallComponent — единый блок «как поставить купленную eSIM»: кнопка
// системной установки, QR, LPA-строка с копированием, ICCID и инструкция.
// Один компонент на три места (терминальный экран оплаты, страница заказа,
// диалог в «Мои eSIM») — раньше эта разметка была растроена, и кнопка
// активации размножилась бы вместе с ней.
@Component({
  selector: 'app-esim-install',
  standalone: true,
  imports: [QRCodeComponent, ButtonComponent, CopyButtonComponent],
  template: `
    @if (activationLink()) {
      <app-button variant="primary" [full]="true" (clicked)="activate()">Активировать eSIM</app-button>
      <p class="hint">Откроется системная установка eSIM. Если она не открылась — добавьте
        eSIM вручную кодом ниже: Настройки → Сотовая связь → Добавить eSIM.</p>
    } @else {
      <p class="hint">Отсканируйте QR камерой телефона или добавьте eSIM вручную:
        Настройки → Сотовая связь → Добавить eSIM.</p>
    }

    <div class="qr-card">
      <qrcode [qrdata]="qr()" [width]="220" colorLight="#ffffff" errorCorrectionLevel="M" />
    </div>
    <div class="secret-row">
      <span class="secret mono">{{ qr() }}</span>
      <app-copy-button [value]="qr()" label="Код активации" />
    </div>
    @if (iccid()) { <p class="hint">ICCID: {{ iccid() }}</p> }
  `,
  styles: [`
    :host { display: block; text-align: center; }
    .qr-card {
      display: flex; justify-content: center;
      padding: var(--space-md);
      background: #fff;
      border-radius: var(--rounded-md);
      margin: var(--space-md) 0 var(--space-sm);
      max-width: 100%;
    }
    .qr-card :is(canvas, img, svg) { max-width: 100%; height: auto; }
    .secret-row {
      display: flex; align-items: center; gap: var(--space-sm);
      padding: 10px 12px;
      background: var(--color-canvas);
      border: 1px solid var(--color-hairline);
      border-radius: var(--rounded-md);
      text-align: left;
    }
    .secret { flex: 1; min-width: 0; overflow-wrap: anywhere; font-size: 13px; }
    .secret.mono { font-family: var(--font-mono); }
    .hint { margin: var(--space-xs) 0 0; color: var(--color-muted); font-size: 13px; line-height: 1.5; }
  `],
})
export class EsimInstallComponent {
  private readonly auth = inject(AuthService);

  /** LPA-строка активации (POST /esim/my/:id/qr). */
  readonly qr = input.required<string>();
  readonly iccid = input('');

  protected readonly activationLink = computed(() =>
    esimActivationLink(this.qr(), detectEsimOS(this.auth.tgPlatform())));

  protected activate(): void {
    // Открываем СИСТЕМНЫМ браузером: внутри webview (Mini App, in-app browser)
    // ОС universal link не перехватывает. В Mini App это делает
    // Telegram.WebApp.openLink, вне — window.open (жест пользователя есть).
    openExternalLink(this.activationLink());
  }
}
