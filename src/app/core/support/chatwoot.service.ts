import { Injectable, PLATFORM_ID, computed, effect, inject } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { firstValueFrom } from 'rxjs';
import { TranslocoService } from '@jsverse/transloco';
import { ApiService } from '../api/api.service';
import { AuthService } from '../auth/auth.service';
import { RuntimeConfigService } from '../config/runtime-config.service';

/**
 * Identity пользователя для виджета. identifier_hash — HMAC-подпись
 * identifier+email с бэкенда (GET /support/chat-identity): чат-прокси
 * принимает identifier/email только с валидной подписью, иначе любой
 * посетитель мог бы представиться чужим email.
 */
interface ChatUser {
  identifier: string;
  email?: string;
  name?: string;
  identifier_hash?: string;
}

// Публичное API embed-SDK собственного чат-прокси (cc-gochatwoot/widget.js) —
// перечисляем только то, что реально дёргаем.
interface CcChatWidget {
  open: () => void;
  /** reset() — сброс сессии; reset(user|null) — атомарная смена identity со сбросом. */
  reset: (user?: ChatUser | null) => void;
}

interface CcChatWindow extends Window {
  ccChat?: CcChatWidget;
  ccChatSettings?: {
    showLauncher?: boolean;
    locale?: string;
    color?: string;
    user?: ChatUser;
  };
}

/**
 * Онлайн-чат поддержки для web-версии.
 *
 * Виджет — собственный (cc-gochatwoot): его SDK и всё общение идут через наш
 * чат-домен (CHATWOOT_HOST, например https://chat.hochuplachu.com), реальный
 * Chatwoot-сервер наружу не светится. SDK грузится лениво — только при первом
 * open() из настроек. В Telegram Mini App скрипт не инжектится вообще
 * (available=false): поддержка там идёт через TG-бота.
 */
@Injectable({ providedIn: 'root' })
export class ChatwootService {
  private readonly platformId = inject(PLATFORM_ID);
  private readonly cfg = inject(RuntimeConfigService);
  private readonly auth = inject(AuthService);
  private readonly api = inject(ApiService);
  private readonly transloco = inject(TranslocoService, { optional: true });

  private sdkRequested = false;
  private readyListenerAdded = false;
  private widgetReady = false;
  private openOnReady = false;
  /** id юзера текущей сессии виджета; undefined — смены ещё не отслеживались. */
  private lastUserId: string | null | undefined = undefined;
  /** id юзера, чья identity уехала в виджет (settings или последний reset). */
  private widgetUserId: string | null = null;
  /** Монотонный счётчик синхронизаций: гасит запоздалые reset после await. */
  private identityEpoch = 0;

  constructor() {
    // Выход/смена аккаунта: сбрасываем сессию виджета — его токен живёт в
    // localStorage chat-домена, logout его не трогает, и без reset следующий
    // пользователь этого браузера увидел бы чужую переписку.
    effect(() => {
      const id = this.auth.user()?.id ?? null;
      if (this.lastUserId === undefined) {
        this.lastUserId = id;
        return;
      }
      if (this.lastUserId === id) return;
      this.lastUserId = id;
      void this.syncWidgetIdentity();
    });
  }

  /** Чат доступен: env-конфиг задан и это НЕ Telegram Mini App. */
  readonly available = computed(() => {
    if (!isPlatformBrowser(this.platformId)) return false;
    if (this.auth.isTelegram()) return false;
    return !!this.cfg.chatwoot.host;
  });

  /** Открывает окно чата; при первом вызове инжектит SDK. */
  open(): void {
    if (!this.available()) return;
    const w = window as unknown as CcChatWindow;
    if (this.widgetReady && w.ccChat) {
      w.ccChat.open();
      return;
    }
    this.openOnReady = true;
    this.loadSdk();
  }

  /** Приводит identity виджета к текущему auth.user(); идемпотентен. */
  private async syncWidgetIdentity(): Promise<void> {
    if (!isPlatformBrowser(this.platformId)) return;
    const epoch = ++this.identityEpoch;
    const w = window as unknown as CcChatWindow;
    // SDK ещё не смонтирован — сбрасывать нечего: если он в полёте, ре-синк
    // случится на ccchat:ready; если не запрашивался, рассинхрон сохранённого
    // токена с identity виджет ловит сам при bootstrap (ccchat_ident).
    if (!w.ccChat) return;
    const user = this.auth.user();
    if (!user) {
      this.widgetUserId = null;
      w.ccChat.reset(null);
      return;
    }
    const identity = await this.fetchIdentity();
    // За время запроса auth сменился ещё раз — этот результат устарел
    // (запоздалый reset воскресил бы сессию после logout).
    if (epoch !== this.identityEpoch) return;
    this.widgetUserId = user.id;
    w.ccChat.reset(identity);
  }

  /** Подписанная identity с бэкенда; при ошибке — неподписанный fallback. */
  private async fetchIdentity(): Promise<ChatUser | null> {
    const user = this.auth.user();
    if (!user) return null;
    try {
      return await firstValueFrom(this.api.get<ChatUser>('/support/chat-identity'));
    } catch {
      // Без подписи прокси (при включённой проверке) срежет identity и чат
      // продолжит работать анонимно — лучше, чем не открыться вовсе.
      return {
        identifier: user.id,
        email: user.email || undefined,
        name: [user.first_name, user.last_name].filter(Boolean).join(' ') || undefined,
      };
    }
  }

  private loadSdk(): void {
    if (this.sdkRequested) return;
    this.sdkRequested = true;

    const baseUrl = this.cfg.chatwoot.host.replace(/\/$/, '');
    void this.prepareSettings().then(() => this.injectSdk(baseUrl));
  }

  private async prepareSettings(): Promise<void> {
    const w = window as unknown as CcChatWindow;
    // Launcher прячем: единственная точка входа — пункт «Связаться с нами»
    // в настройках, а плавающий пузырь перекрывал бы bottom-nav.
    // Идентичность передаём сразу в settings — виджет применит её при
    // создании контакта (bootstrap), отдельного вызова не нужно.
    const identity = await this.fetchIdentity();
    this.widgetUserId = identity?.identifier ?? null;
    w.ccChatSettings = {
      showLauncher: false,
      locale: this.transloco?.getActiveLang() ?? 'ru',
      color: this.cfg.brand.colors.primary,
      user: identity ?? undefined,
    };
  }

  private injectSdk(baseUrl: string): void {
    // Один листенер на всё время жизни: при ретрае после onerror loadSdk
    // выполняется повторно, а событие ready в итоге придёт только один раз.
    if (this.readyListenerAdded) {
      this.injectScript(baseUrl);
      return;
    }
    this.readyListenerAdded = true;
    window.addEventListener('ccchat:ready', () => {
      this.widgetReady = true;
      if (this.openOnReady) {
        this.openOnReady = false;
        (window as unknown as CcChatWindow).ccChat?.open();
      }
      // Пока SDK грузился, auth мог смениться (settings несут stale identity,
      // а effect до готовности ccChat сбрасывать было нечего) — ре-синк.
      if ((this.auth.user()?.id ?? null) !== this.widgetUserId) {
        void this.syncWidgetIdentity();
      }
    });

    this.injectScript(baseUrl);
  }

  private injectScript(baseUrl: string): void {
    const script = document.createElement('script');
    script.src = `${baseUrl}/widget.js`;
    script.defer = true;
    script.async = true;
    script.onerror = () => {
      // host недоступен — позволяем повторить попытку следующим кликом
      this.sdkRequested = false;
      script.remove();
    };
    document.head.appendChild(script);
  }
}
