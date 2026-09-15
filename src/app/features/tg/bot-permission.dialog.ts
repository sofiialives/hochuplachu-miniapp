import { Component, inject, output } from '@angular/core';
import { DialogComponent } from '../../ui/dialog.component';
import { ButtonComponent } from '../../ui/button.component';
import { RuntimeConfigService } from '../../core/config/runtime-config.service';

@Component({
  selector: 'app-bot-permission-dialog',
  standalone: true,
  imports: [DialogComponent, ButtonComponent],
  template: `<app-dialog title="Нужно разрешение" [closable]="false">
    <p>Необходимо разрешить «{{ name }}» посылать вам уведомления об операциях. Разрешите, пожалуйста, писать вам от лица нашей компании в боте.</p>
    <div class="cta">
      <app-button variant="primary" [full]="true" (click)="onOk()">Ок</app-button>
    </div>
  </app-dialog>`,
  styles: [`.cta { margin-top: var(--space-md); }`],
})
export class BotPermissionDialog {
  readonly dismissed = output<void>();
  private readonly cfg = inject(RuntimeConfigService);
  protected get name(): string { return this.cfg.brand.service_name; }

  // Поток установки флага bot_can_write — только через бэк:
  //   1) Юзер нажал Allow в системном prompt'е → Telegram присылает нашему
  //      боту update write_access_allowed → handler в internal/telegram/bot.go
  //      ставит флаг.
  //   2) Юзер сам нажал /start или написал боту → те же бот-handler'ы.
  // Фронт сюда НИКАКОГО POST не шлёт — иначе клиент мог бы лгать о статусе
  // подписки. Диалог просто инициирует prompt и закрывает себя; при следующем
  // bootstrap (`/auth/me`) флаг подтянется из БД, если Telegram реально его
  // выставил.
  onOk(): void {
    if (typeof window === 'undefined') {
      this.dismissed.emit();
      return;
    }
    type WebApp = {
      requestWriteAccess?: (cb?: (granted: boolean) => void) => void;
      openTelegramLink?: (u: string) => void;
    };
    const wa = (window as unknown as { Telegram?: { WebApp?: WebApp } }).Telegram?.WebApp;

    if (wa?.requestWriteAccess) {
      try {
        wa.requestWriteAccess(() => this.dismissed.emit());
        return;
      } catch {
        // старый клиент / API недоступен — fallback ниже
      }
    }

    // Web-сценарий (или старая версия TG) — открываем бота по ссылке, чтобы
    // юзер нажал /start вручную. Бот-handler /start поставит флаг.
    const u = this.cfg.brand.telegram_bot_username?.trim();
    if (u) {
      const url = `https://t.me/${u}?start=allow`;
      if (wa?.openTelegramLink) wa.openTelegramLink(url);
      else window.open(url, '_blank');
    }
    this.dismissed.emit();
  }
}
