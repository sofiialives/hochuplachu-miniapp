import {
  Component,
  DestroyRef,
  PLATFORM_ID,
  computed,
  effect,
  inject,
  signal,
} from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { DomSanitizer, SafeResourceUrl } from '@angular/platform-browser';
import { isPlatformBrowser } from '@angular/common';
import { BackBarComponent } from '../../ui/back-bar.component';
import { ButtonComponent } from '../../ui/button.component';
import { InputComponent } from '../../ui/input.component';
import { DialogComponent } from '../../ui/dialog.component';
import { AuthService } from '../../core/auth/auth.service';
import { VerificationService } from '../../core/verification/verification.service';
import { VerificationStatus } from '../../core/api/verification.api';
import { EMAIL_REGEX, extractApiError } from '../../core/errors/api-error';
import { RuntimeConfigService } from '../../core/config/runtime-config.service';
import { formatPhoneInput } from '../../shared/phone-format';
import { TranslocoService } from '@jsverse/transloco';
import { buildVerificationUrl, resolveActiveLang } from '../../shared/verification-url';

type Step = 'email' | 'phone' | 'provider' | 'done' | 'loading';

// Минимально-возможные сигнатуры Telegram.WebApp.* которые нам тут нужны.
// Базовая deeper-обёртка живёт в auth.service.ts; здесь оставляем тонкий
// типизированный геттер только для requestContact / openLink.
interface TgWebApp {
  requestContact?: (callback: (ok: boolean) => void) => void;
  openLink?: (url: string, opts?: { try_instant_view?: boolean }) => void;
}
function tgWebApp(): TgWebApp | null {
  if (typeof window === 'undefined') return null;
  return ((window as unknown) as { Telegram?: { WebApp?: TgWebApp } }).Telegram?.WebApp ?? null;
}

/**
 * VerificationPage — wizard для strict-режима верификации.
 *
 *   email    → запрашиваем код, подтверждаем (для TG-юзеров без email — link).
 *   phone    → TG share_contact / web-форма (только цифры с опц. «+»).
 *   provider → KYC URL у coincat (открываем в новой вкладке/WebApp.openLink).
 *
 * После каждого успешного шага — verification.refresh(). При `all_ok=true`
 * автоматически navigate-аем на returnUrl из query-параметра `return` или на «/».
 *
 * Простая state-machine: `step` сигнал = email|phone|provider|done|loading.
 * Шаги выбираются по checks() из VerificationService.
 */
@Component({
  selector: 'app-verification',
  standalone: true,
  imports: [BackBarComponent, ButtonComponent, InputComponent, DialogComponent],
  template: `<app-back-bar />
    <section class="wrap">
      <h1 class="title">Подтверждение аккаунта</h1>
      <p class="sub">Шаги обязательны для оформления заявки. Это нужно только один раз.</p>

      <ul class="progress" aria-label="Прогресс верификации">
        @for (s of progressItems(); track s.key) {
          <li [class.done]="s.done" [class.active]="s.key === step()" [class.pending]="!s.done && s.key !== step()">
            <span class="dot"></span>
            <span class="label">{{ s.label }}</span>
          </li>
        }
      </ul>

      @switch (step()) {
        @case ('loading') {
          <div class="loading"><span class="spin" aria-hidden="true"></span> Загружаем статус…</div>
        }

        @case ('email') {
          <div class="card">
            <h3>{{ emailLinkMode() ? 'Привяжите email' : 'Войдите по email' }}</h3>
            <p class="muted">Мы пришлём 8-значный код на указанный адрес.</p>

            @if (emailTgConfirm()) {
              <div class="loading"><span class="spin" aria-hidden="true"></span> Ожидаем подтверждение…</div>
              <p class="hint">
                К этому аккаунту привязан Telegram. Мы отправили запрос в чат с ботом —
                откройте его и нажмите <strong>«Разрешить»</strong>.
              </p>
              <button class="link-btn" type="button" (click)="cancelEmailTgConfirm()">Отмена</button>
            } @else if (!emailCodeSent()) {
              <app-input
                [value]="email()"
                (valueChange)="onEmail($event)"
                (enterPressed)="sendEmail()"
                type="email"
                placeholder="you@example.com"
                [error]="emailErr()"></app-input>
              <app-button variant="primary" [full]="true"
                [loading]="emailLoading()"
                [disabled]="!emailValid() || emailLoading()"
                (clicked)="sendEmail()">Получить код</app-button>
            } @else {
              <app-input
                [value]="emailCode()"
                (valueChange)="onEmailCode($event)"
                inputmode="numeric"
                autocomplete="one-time-code"
                name="otp"
                placeholder="00000000"
                [maxLength]="8"
                [error]="emailCodeErr()"></app-input>
              <app-button variant="primary" [full]="true"
                [loading]="emailLoading()"
                [disabled]="emailCode().length !== 8 || emailLoading()"
                (clicked)="confirmEmail()">Подтвердить</app-button>
              <button class="link-btn" type="button" (click)="resetEmailCode()">Заменить email</button>
            }
          </div>
        }

        @case ('phone') {
          <div class="card">
            @if (telegramShareSupported()) {
              <h3>Поделитесь номером телефона</h3>
              <p class="muted">Telegram отправит ваш номер боту — мы его сразу подтвердим.</p>
              <app-button variant="primary" [full]="true"
                [loading]="phoneTgWaiting()"
                [disabled]="phoneTgWaiting()"
                (clicked)="onTgShareContact()">
                @if (phoneTgWaiting()) { Ожидаем номер… }
                @else { Поделиться номером с Telegram }
              </app-button>
              @if (phoneTgWaiting()) {
                <p class="hint">Если случайно нажали «Отмена» в Telegram — нажмите кнопку снова.</p>
              }
            } @else {
              <h3>Введите номер телефона</h3>
              <app-input
                [value]="phone()"
                (valueChange)="onPhoneInput($event)"
                inputmode="numeric"
                placeholder="+79261234567"
                [maxLength]="16"
                [error]="phoneErr()"></app-input>
              <app-button variant="primary" [full]="true"
                [disabled]="!phoneValid()"
                (clicked)="phoneConfirmOpen.set(true)">Далее</app-button>
            }
          </div>

          @if (phoneConfirmOpen()) {
            <app-dialog title="Проверьте номер телефона" (dismissed)="phoneConfirmOpen.set(false)">
              <p class="confirm-num">{{ phone() }}</p>
              <p class="muted">Если ошиблись — нажмите «Отмена» и поправьте.</p>
              <div class="confirm-cta">
                <app-button variant="secondary" [full]="true" (clicked)="phoneConfirmOpen.set(false)">Отмена</app-button>
                <app-button variant="primary" [full]="true"
                  [loading]="phoneWebLoading()"
                  [disabled]="phoneWebLoading()"
                  (clicked)="submitWebPhone()">Подтвердить</app-button>
              </div>
            </app-dialog>
          }
        }

        @case ('provider') {
          <div class="card card--provider">
            @if (providerErr(); as err) {
              <h3>Верификация личности</h3>
              <p class="muted err-text">{{ err }}</p>
              <div class="retry-cta">
                <app-button variant="primary" [full]="true" (clicked)="retryProvider()">Повторить</app-button>
              </div>
            } @else if (safeProviderUrl(); as url) {
              <!-- KYC встроен прямо в карточку. polling /verification/status
                   продолжает работать в фоне и переключит шаг на 'done' как
                   только провайдер подтвердит KYC — компонент сам уйдёт на
                   returnUrl без действий пользователя. -->
              <iframe
                class="provider-frame"
                [src]="url"
                allow="camera; microphone; clipboard-read; clipboard-write; geolocation"
                referrerpolicy="origin"
                title="Верификация личности"></iframe>
            } @else {
              <h3>Верификация личности</h3>
              <div class="progress-row">
                <span class="spin" aria-hidden="true"></span>
                <span>Готовим страницу верификации…</span>
              </div>
            }
          </div>
        }

        @case ('done') {
          <div class="card success">
            <h3>Готово!</h3>
            <p>Все проверки пройдены — вернитесь и оформляйте заявку.</p>
            <app-button variant="primary" [full]="true" (clicked)="goReturn()">Продолжить</app-button>
          </div>
        }
      }
    </section>`,
  styles: [`
    .wrap { padding: var(--space-md); max-width: 480px; margin: 0 auto; padding-bottom: 110px; }
    .title { margin: 0 0 var(--space-sm); font-size: 24px; font-weight: 500; }
    .sub { color: var(--color-muted); margin: 0 0 var(--space-lg); font-size: 14px; }
    .progress {
      list-style: none; padding: 0; margin: 0 0 var(--space-lg);
      display: flex; flex-direction: column; gap: 8px;
    }
    .progress li {
      display: flex; align-items: center; gap: 12px;
      font-size: 14px;
    }
    .progress .dot {
      width: 14px; height: 14px; border-radius: 50%; flex: 0 0 14px;
      background: color-mix(in srgb, var(--color-hairline) 80%, transparent);
      border: 2px solid var(--color-hairline);
    }
    .progress li.active .dot { background: var(--color-primary); border-color: var(--color-primary); box-shadow: 0 0 0 3px color-mix(in srgb, var(--color-primary) 25%, transparent); }
    .progress li.done .dot { background: var(--color-success, #2e8b57); border-color: var(--color-success, #2e8b57); }
    .progress li.done .label { color: var(--color-muted); text-decoration: line-through; }
    .card {
      background: var(--color-surface); border: 1px solid var(--color-hairline);
      border-radius: var(--rounded-md);
      padding: var(--space-md);
      display: flex; flex-direction: column; gap: var(--space-md);
    }
    .card h3 { margin: 0; font-size: 18px; font-weight: 500; }
    .card .muted { color: var(--color-muted); margin: 0; font-size: 14px; line-height: 1.5; }
    .card.success { border-color: var(--color-success, #2e8b57); }
    .loading { display: flex; align-items: center; gap: 10px; color: var(--color-muted); justify-content: center; padding: var(--space-lg) 0; }
    .progress-row { display: flex; align-items: center; gap: 10px; color: var(--color-muted); font-size: 14px; }
    .err-text { color: var(--color-danger, #c0392b); }
    /* Карточка с iframe — обнуляем внутренние отступы и режем gap, чтобы
       KYC-страница занимала всю ширину и высоту блока без визуального
       «обрамления внутри обрамления». */
    .card--provider { padding: 0; gap: 0; overflow: hidden; }
    .card--provider h3 { padding: var(--space-md) var(--space-md) 0; }
    .card--provider .muted,
    .card--provider .progress-row { padding: 0 var(--space-md) var(--space-md); }
    .card--provider .retry-cta { padding: 0 var(--space-md) var(--space-md); }
    .provider-frame {
      width: 100%;
      min-height: min(80vh, 720px);
      border: 0;
      display: block;
      background: var(--color-surface);
    }
    .spin {
      width: 18px; height: 18px; border-radius: 50%;
      border: 2px solid var(--color-hairline); border-top-color: var(--color-primary-ink);
      animation: ver-spin .9s linear infinite;
    }
    @keyframes ver-spin { to { transform: rotate(360deg); } }
    .hint { font-size: 13px; color: var(--color-muted); margin: 0; }
    .link-btn {
      align-self: center;
      color: var(--color-primary-ink);
      font-size: 14px;
      background: none; border: none; padding: var(--space-sm) var(--space-md); cursor: pointer;
      font-weight: 500;
    }
    .link-btn:hover { text-decoration: underline; }
    .confirm-num { font-size: 22px; font-weight: 600; text-align: center; margin: var(--space-md) 0; }
    .confirm-cta { display: flex; gap: var(--space-sm); margin-top: var(--space-md); }
    .confirm-cta app-button { flex: 1; }
  `],
})
export class VerificationPage {
  private readonly verification = inject(VerificationService);
  private readonly auth = inject(AuthService);
  private readonly cfg = inject(RuntimeConfigService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly platformId = inject(PLATFORM_ID);
  private readonly transloco = inject(TranslocoService, { optional: true });
  private readonly isBrowser = isPlatformBrowser(this.platformId);

  // Текущий шаг wizard'а.
  protected readonly step = signal<Step>('loading');

  // Состояние email-шага.
  protected readonly email = signal('');
  protected readonly emailErr = signal('');
  protected readonly emailCode = signal('');
  protected readonly emailCodeErr = signal('');
  protected readonly emailCodeSent = signal(false);
  protected readonly emailLoading = signal(false);
  protected readonly emailValid = computed(() => EMAIL_REGEX.test(this.email().trim()));
  // Ожидание кнопки «Разрешить» в Telegram: у введённого email есть аккаунт
  // с привязанным TG — backend не выдаёт сессию без подтверждения владельца.
  protected readonly emailTgConfirm = signal(false);
  private approvalToken: string | null = null;
  private approvalTimer: ReturnType<typeof setInterval> | null = null;
  private approvalInFlight = false;
  // emailLinkMode — true когда пользователь авторизован (TG), но email не привязан.
  // false — пользователь не авторизован (web без сессии), используем login-flow.
  protected readonly emailLinkMode = computed(() => this.auth.isAuthenticated());

  // Состояние phone-шага.
  protected readonly phone = signal('');
  protected readonly phoneErr = signal('');
  protected readonly phoneConfirmOpen = signal(false);
  protected readonly phoneTgWaiting = signal(false);
  protected readonly phoneWebLoading = signal(false);
  protected readonly phoneValid = computed(() => {
    const v = this.phone();
    return /^\+?\d{8,15}$/.test(v);
  });
  protected readonly telegramShareSupported = computed(() => {
    const checks = this.verification.status()?.checks;
    return checks?.phone?.telegram_share_supported === true;
  });

  // Состояние provider-шага. Шаг полностью автоматический: при попадании на
  // него мы сразу дергаем /verification/start (или используем кешированный
  // URL из status), рисуем страницу верификации в iframe прямо в карточке
  // и запускаем polling /verification/status. Видимых кнопок нет — пока
  // URL грузится показываем спиннер, при сбое — текст ошибки.
  protected readonly providerUrl = signal<string | null>(null);
  protected readonly providerErr = signal<string | null>(null);
  private readonly providerStarted = signal(false);
  private providerPollHandle: ReturnType<typeof setInterval> | null = null;
  private readonly destroyRef = inject(DestroyRef);
  private readonly sanitizer = inject(DomSanitizer);

  // safeProviderUrl — providerUrl с добавленным ?lang=<активный язык> (паритет
  // с coincat/frontend: провайдер KYC открывает интерфейс на языке юзера),
  // прогнанный через DomSanitizer для [src] iframe (Angular иначе вырежет
  // внешний URL из ресурсного контекста).
  protected readonly safeProviderUrl = computed<SafeResourceUrl | null>(() => {
    const url = this.providerUrl();
    if (!url) return null;
    const withLang = buildVerificationUrl(url, resolveActiveLang(this.transloco, this.isBrowser));
    return this.sanitizer.bypassSecurityTrustResourceUrl(withLang);
  });

  protected readonly progressItems = computed(() => {
    const s = this.verification.status();
    return [
      { key: 'email', label: 'Email', done: !!s?.checks.email?.ok },
      { key: 'phone', label: 'Телефон', done: !!s?.checks.phone?.ok },
      { key: 'provider', label: 'Верификация личности', done: !!s?.checks.provider?.ok },
    ];
  });

  constructor() {
    // При входе на страницу — refresh статуса и вычислить шаг. Дополнительно
    // переключаем шаг при любом изменении status() (например, после refresh
    // в phone-polling).
    effect(() => {
      const s = this.verification.status();
      if (!s) return;
      this.recomputeStep(s);
    });
    // Авто-запуск provider-шага. Срабатывает один раз: как только step
    // становится 'provider', дёргаем start (или используем кешированный URL),
    // открываем верификацию в новой вкладке и запускаем polling.
    // providerStarted страхует от повторного вызова на каждом изменении
    // status() (polling refresh обновляет status, эффект ре-исполняется).
    effect(() => {
      if (this.step() !== 'provider') return;
      if (this.providerStarted()) return;
      if (this.providerErr()) return;
      this.providerStarted.set(true);
      void this.runProvider();
    });
    if (isPlatformBrowser(this.platformId)) {
      void this.verification.refresh();
    }
    // Чистим polling-таймеры если страница ушла из навигации до того, как
    // юзер закончил KYC / подтвердил вход в Telegram.
    this.destroyRef.onDestroy(() => {
      this.stopProviderPolling();
      this.stopApprovalPolling();
    });
  }

  private recomputeStep(s: VerificationStatus | null): void {
    if (!s) { this.step.set('loading'); return; }
    if (s.mode === 'simple' || s.all_ok) {
      this.step.set('done');
      // Сразу уходим обратно, не задерживая на success-экране.
      this.goReturn();
      return;
    }
    if (!s.checks.email?.ok) { this.step.set('email'); return; }
    if (!s.checks.phone?.ok) { this.step.set('phone'); return; }
    if (!s.checks.provider?.ok) {
      this.step.set('provider');
      // Cache URL если backend его уже отдал в статусе.
      if (s.checks.provider?.url) this.providerUrl.set(s.checks.provider.url);
      return;
    }
    this.step.set('done');
  }

  // ===== Email =====

  onEmail(v: string): void { this.email.set(v); if (this.emailErr()) this.emailErr.set(''); }
  onEmailCode(v: string): void {
    const digits = v.replace(/\D/g, '').slice(0, 8);
    this.emailCode.set(digits);
    if (this.emailCodeErr()) this.emailCodeErr.set('');
    if (digits.length === 8 && !this.emailLoading()) this.confirmEmail();
  }
  resetEmailCode(): void {
    this.emailCodeSent.set(false);
    this.emailCode.set('');
    this.emailCodeErr.set('');
  }
  sendEmail(): void {
    const value = this.email().trim().toLowerCase();
    if (!EMAIL_REGEX.test(value)) { this.emailErr.set('Введите корректный email'); return; }
    this.emailLoading.set(true);
    const obs = this.emailLinkMode() ? this.auth.requestLink(value) : this.auth.requestCode(value);
    obs.subscribe({
      next: () => { this.emailLoading.set(false); this.emailCodeSent.set(true); },
      error: (err) => {
        this.emailLoading.set(false);
        const e = extractApiError(err);
        this.emailErr.set(e.message ?? 'Не удалось отправить код');
      },
    });
  }
  confirmEmail(): void {
    this.emailLoading.set(true);
    this.emailCodeErr.set('');
    const email = this.email().trim().toLowerCase();
    const code = this.emailCode();
    const onError = (err: unknown): void => {
      this.emailLoading.set(false);
      const e = extractApiError(err);
      if (e.code === 'CODE_INVALID') this.emailCodeErr.set('Неверный код');
      else if (e.code === 'CODE_EXPIRED') this.emailCodeErr.set('Код истёк, запросите новый');
      else this.emailCodeErr.set(e.message ?? 'Ошибка проверки кода');
    };
    if (this.emailLinkMode()) {
      this.auth.confirmLink(email, code).subscribe({
        next: async () => {
          this.emailLoading.set(false);
          await this.verification.refresh();
        },
        error: onError,
      });
      return;
    }
    this.auth.verifyCode(email, code).subscribe({
      next: async (res) => {
        this.emailLoading.set(false);
        // Аккаунт с привязанным Telegram: сессии ещё нет — ждём «Разрешить»
        // в чате с ботом и опрашиваем статус подтверждения.
        if (res.telegram_confirm && res.approval_token) {
          this.approvalToken = res.approval_token;
          this.emailTgConfirm.set(true);
          this.startApprovalPolling();
          return;
        }
        await this.verification.refresh();
      },
      error: onError,
    });
  }

  cancelEmailTgConfirm(): void {
    this.stopApprovalPolling();
    this.approvalToken = null;
    this.emailTgConfirm.set(false);
    this.resetEmailCode();
  }

  private startApprovalPolling(): void {
    this.stopApprovalPolling();
    this.approvalTimer = setInterval(() => this.pollApprovalOnce(), 2000);
  }

  // Гасит ТОЛЬКО таймер: startApprovalPolling начинается с этого вызова, и
  // обнуление approvalToken здесь делало бы каждый pollApprovalOnce no-op
  // (guard `if (!token)`). Токен сбрасывает cancelEmailTgConfirm.
  private stopApprovalPolling(): void {
    if (this.approvalTimer !== null) {
      clearInterval(this.approvalTimer);
      this.approvalTimer = null;
    }
    this.approvalInFlight = false;
  }

  private pollApprovalOnce(): void {
    const token = this.approvalToken;
    if (!token || this.approvalInFlight) return;
    this.approvalInFlight = true;
    this.auth.pollApproval(token).subscribe({
      next: async (res) => {
        this.approvalInFlight = false;
        switch (res.status) {
          case 'approved':
            this.stopApprovalPolling();
            this.emailTgConfirm.set(false);
            await this.verification.refresh();
            break;
          case 'denied':
            this.abortEmailTgConfirm('Вход отклонён в Telegram.');
            break;
          case 'expired':
            this.abortEmailTgConfirm('Время подтверждения истекло. Запросите новый код.');
            break;
          // pending — ждём дальше
        }
      },
      error: (err) => {
        this.approvalInFlight = false;
        const e = extractApiError(err);
        // Сетевые сбои и rate-limit молча переживаем — следующий тик повторит.
        if (e.code === 'APPROVAL_NOT_FOUND' || e.code === 'LOGIN_BLOCKED') {
          this.abortEmailTgConfirm(e.message ?? 'Не удалось подтвердить вход');
        }
      },
    });
  }

  private abortEmailTgConfirm(message: string): void {
    this.cancelEmailTgConfirm();
    this.emailErr.set(message);
  }

  // ===== Phone (TG share) =====

  onTgShareContact(): void {
    const wa = tgWebApp();
    if (!wa || typeof wa.requestContact !== 'function') {
      this.phoneErr.set('Поделиться контактом нельзя в этом клиенте Telegram');
      return;
    }
    this.phoneTgWaiting.set(true);
    try {
      wa.requestContact((ok: boolean) => {
        if (!ok) {
          // Юзер отказался в нативном prompt'е — выключаем спиннер. Кнопку
          // оставляем активной для повторного нажатия.
          this.phoneTgWaiting.set(false);
        }
        // ok=true: контакт уехал в бот, polling /verification/status подберёт
        // изменение phone.ok и переключит wizard на provider-шаг.
      });
    } catch {
      this.phoneTgWaiting.set(false);
    }
    // Polling статуса параллельно с requestContact callback'ом — на случай
    // если ok=true пришёл, а потом юзер закрыл/свернул мини-апп.
    void this.verification.pollWhilePhoneMissing(60_000, 2000).then((got) => {
      this.phoneTgWaiting.set(false);
      if (!got) {
        // 60s истекли — кнопка снова активна, пусть пробует.
      }
    });
  }

  // ===== Phone (web form) =====

  onPhoneInput(v: string): void {
    this.phone.set(formatPhoneInput(v));
    if (this.phoneErr()) this.phoneErr.set('');
  }
  async submitWebPhone(): Promise<void> {
    this.phoneWebLoading.set(true);
    const ok = await this.verification.submitPhone(this.phone());
    this.phoneWebLoading.set(false);
    this.phoneConfirmOpen.set(false);
    if (!ok) {
      this.phoneErr.set('Не удалось сохранить номер. Проверьте формат и попробуйте ещё раз.');
    }
  }

  // ===== Provider (KYC) =====
  //
  // Шаг полностью автоматический: пользователь не нажимает кнопок.
  //   1) Если URL уже отдан в /verification/status (backend кеширует сессию)
  //      — сразу запускаем polling, iframe рендерится из safeProviderUrl().
  //   2) Иначе зовём /verification/start. passed → refresh уведёт в done.
  //      url → сохраняем + polling; iframe сам подхватит. Иначе — ошибка.

  // Ошибка start-запроса (в т.ч. 408-таймаут) не должна быть тупиком: сброс
  // providerErr + providerStarted заново взводит guard-effect в конструкторе,
  // и runProvider выполняется повторно.
  retryProvider(): void {
    this.providerErr.set(null);
    this.providerStarted.set(false);
  }

  private async runProvider(): Promise<void> {
    if (this.providerUrl()) {
      this.startProviderPolling();
      return;
    }
    const res = await this.verification.startProviderSession();
    if (!res) {
      this.providerErr.set('Не удалось получить ссылку на верификацию. Попробуйте позже.');
      return;
    }
    if (res.passed) {
      void this.verification.refresh();
      return;
    }
    if (!res.url) {
      this.providerErr.set('Сервис верификации временно недоступен. Попробуйте позже.');
      return;
    }
    this.providerUrl.set(res.url);
    this.startProviderPolling();
  }

  // Periodic refresh после открытия KYC-страницы. Polling останавливаем, как
  // только step ушёл с 'provider' (KYC одобрен → done → goReturn(), либо юзер
  // ушёл со страницы).
  private startProviderPolling(): void {
    if (this.providerPollHandle) return;
    this.providerPollHandle = setInterval(() => {
      if (this.step() !== 'provider') {
        this.stopProviderPolling();
        return;
      }
      void this.verification.refresh();
    }, 5000);
  }

  private stopProviderPolling(): void {
    if (this.providerPollHandle) {
      clearInterval(this.providerPollHandle);
      this.providerPollHandle = null;
    }
  }

  // ===== Navigation =====

  goReturn(): void {
    if (this.cfg.verificationMode !== 'strict') {
      // simple — гейта нет, незачем застревать тут.
      void this.router.navigate(['/']);
      return;
    }
    const ret = this.route.snapshot.queryParamMap.get('return');
    if (ret && ret.startsWith('/')) {
      void this.router.navigateByUrl(ret);
    } else {
      void this.router.navigate(['/']);
    }
  }
}
