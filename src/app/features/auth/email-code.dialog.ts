import { Component, OnDestroy, OnInit, inject, input, output, signal } from '@angular/core';
import { DialogComponent } from '../../ui/dialog.component';
import { ButtonComponent } from '../../ui/button.component';
import { InputComponent } from '../../ui/input.component';
import { AuthService } from '../../core/auth/auth.service';
import { extractApiError } from '../../core/errors/api-error';

// EmailCodeDialog — шаг «подтверждение почты» гостевого входа (login-flow
// /auth/email/request + /auth/email/verify). Email вводится НА СТРАНИЦЕ
// (checkout), сюда он приходит как input, а код уже отправлен вызывающим —
// диалог только принимает его, повторяет отправку по таймеру и доводит вход
// до конца.
//
// Отличие от EmailLinkDialog: тот работает в link-flow (/auth/email/link*) и
// требует уже существующей сессии — привязка email к TG-аккаунту. Здесь сессии
// нет вообще, поэтому и endpoints другие.
//
// Ветка telegram_confirm: если к email привязан Telegram, backend вместо токена
// отдаёт approval_token — показываем ожидание и поллим /auth/email/approval/poll
// (тот же протокол, что в email-verify.page.ts).
@Component({
  selector: 'app-email-code-dialog',
  standalone: true,
  imports: [DialogComponent, ButtonComponent, InputComponent],
  template: `<app-dialog [title]="step() === 'confirm' ? 'Подтвердите вход в Telegram' : 'Подтверждение почты'"
                         [closable]="true" (dismissed)="dismissed.emit()">
    @if (step() === 'code') {
      <p class="muted">Код подтверждения отправлен на <strong>{{ email() }}</strong>.</p>
      <app-input
        [value]="code()"
        (valueChange)="onCode($event)"
        (enterPressed)="verify()"
        inputmode="numeric"
        autocomplete="one-time-code"
        name="otp"
        pattern="[0-9]{8}"
        placeholder="00000000"
        [maxLength]="8"
        [error]="codeErr()"></app-input>
      <div class="cta">
        <app-button variant="primary" [full]="true" [loading]="loading()"
                    [disabled]="code().length !== 8 || loading()" (clicked)="verify()">
          Подтвердить
        </app-button>
        @if (resendIn() > 0) {
          <span class="resend muted">Отправить ещё раз через {{ resendIn() }} сек.</span>
        } @else {
          <button class="link-btn" type="button" [disabled]="resending()" (click)="resend()">
            Отправить код ещё раз
          </button>
        }
        <button class="link-btn" type="button" (click)="changeEmail.emit()">Изменить email</button>
      </div>
    } @else {
      <div class="wait">
        <span class="spinner" aria-hidden="true"></span>
        <p class="muted">
          К этому email привязан Telegram. Мы отправили запрос в чат с ботом —
          откройте его и нажмите <strong>«Разрешить»</strong>, вход завершится автоматически.
        </p>
      </div>
    }
  </app-dialog>`,
  styles: [`
    .muted { color: var(--color-muted); margin-bottom: var(--space-md); }
    .cta { margin-top: var(--space-md); display: flex; flex-direction: column; gap: var(--space-sm); align-items: stretch; }
    .resend { align-self: center; font-size: 14px; }
    .link-btn {
      align-self: center;
      color: var(--color-primary-ink);
      font-size: 14px;
      background: none; border: none; padding: var(--space-sm) var(--space-md); cursor: pointer;
      font-weight: 500;
    }
    .link-btn:hover:not(:disabled) { text-decoration: underline; }
    .link-btn:disabled { color: var(--color-muted); cursor: default; }
    .wait { display: flex; flex-direction: column; align-items: center; gap: var(--space-md); text-align: center; }
    .spinner {
      width: 40px; height: 40px; border-radius: 50%;
      border: 3px solid var(--color-hairline);
      border-top-color: var(--color-primary-ink);
      animation: code-spin .8s linear infinite;
    }
    @keyframes code-spin { to { transform: rotate(360deg); } }
  `],
})
export class EmailCodeDialog implements OnInit, OnDestroy {
  private readonly auth = inject(AuthService);

  /** Email, на который вызывающий уже отправил код. */
  readonly email = input.required<string>();
  /** Сессия установлена — вызывающий продолжает свой сценарий. */
  readonly authenticated = output<void>();
  /** Закрыли диалог (крестик / backdrop). */
  readonly dismissed = output<void>();
  /** «Изменить email» — возврат к полю на странице. */
  readonly changeEmail = output<void>();

  protected readonly step = signal<'code' | 'confirm'>('code');
  protected readonly code = signal('');
  protected readonly codeErr = signal('');
  protected readonly loading = signal(false);
  protected readonly resending = signal(false);
  protected readonly resendIn = signal(RESEND_SECONDS);

  private approvalToken: string | null = null;
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private tickTimer: ReturnType<typeof setInterval> | null = null;
  private pollInFlight = false;

  ngOnInit(): void {
    this.startCountdown();
  }

  ngOnDestroy(): void {
    this.stopPolling();
    this.stopCountdown();
  }

  protected onCode(v: string): void {
    const digits = v.replace(/\D/g, '').slice(0, 8);
    this.code.set(digits);
    if (this.codeErr()) this.codeErr.set('');
    if (digits.length === 8 && !this.loading()) this.verify();
  }

  protected verify(): void {
    if (this.code().length !== 8 || this.loading()) return;
    this.loading.set(true);
    this.codeErr.set('');
    this.auth.verifyCode(this.email(), this.code()).subscribe({
      next: (res) => {
        this.loading.set(false);
        // Аккаунт с привязанным Telegram — сессии ещё нет, ждём «Разрешить».
        if (res.telegram_confirm && res.approval_token) {
          this.approvalToken = res.approval_token;
          this.step.set('confirm');
          this.stopCountdown();
          this.startPolling();
          return;
        }
        this.authenticated.emit();
      },
      error: (err) => {
        this.loading.set(false);
        const e = extractApiError(err);
        if (e.code === 'CODE_INVALID') this.codeErr.set('Неверный код');
        else if (e.code === 'CODE_EXPIRED') this.codeErr.set('Код истёк, запросите новый');
        else if (e.code === 'TOO_MANY_ATTEMPTS') this.codeErr.set('Слишком много попыток, подождите 5 минут');
        else this.codeErr.set(e.message ?? 'Ошибка проверки кода');
      },
    });
  }

  protected resend(): void {
    if (this.resendIn() > 0 || this.resending()) return;
    this.resending.set(true);
    this.codeErr.set('');
    this.auth.requestCode(this.email()).subscribe({
      next: () => {
        this.resending.set(false);
        this.code.set('');
        this.startCountdown();
      },
      error: (err) => {
        this.resending.set(false);
        const e = extractApiError(err);
        this.codeErr.set(e.code === 'RATE_LIMITED'
          ? 'Слишком много запросов. Попробуйте через минуту.'
          : (e.message ?? 'Не удалось отправить код'));
        // Даже при отказе взводим паузу — иначе пользователь будет долбить
        // кнопку и упираться в тот же лимит.
        this.startCountdown();
      },
    });
  }

  private startCountdown(): void {
    this.stopCountdown();
    this.resendIn.set(RESEND_SECONDS);
    this.tickTimer = setInterval(() => {
      const left = this.resendIn() - 1;
      this.resendIn.set(left);
      if (left <= 0) this.stopCountdown();
    }, 1000);
  }

  private stopCountdown(): void {
    if (this.tickTimer !== null) {
      clearInterval(this.tickTimer);
      this.tickTimer = null;
    }
  }

  private startPolling(): void {
    this.stopPolling();
    this.pollTimer = setInterval(() => this.pollOnce(), 2000);
  }

  // Гасим только таймер: approvalToken нужен последующим тикам (startPolling
  // начинается с stopPolling — обнуление токена сделало бы poll no-op'ом).
  private stopPolling(): void {
    if (this.pollTimer !== null) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
    this.pollInFlight = false;
  }

  private pollOnce(): void {
    const token = this.approvalToken;
    if (!token || this.pollInFlight) return;
    this.pollInFlight = true;
    this.auth.pollApproval(token).subscribe({
      next: (res) => {
        this.pollInFlight = false;
        switch (res.status) {
          case 'approved':
            this.stopPolling();
            this.authenticated.emit();
            break;
          case 'denied':
            this.abort('Вход отклонён в Telegram.');
            break;
          case 'expired':
            this.abort('Время подтверждения истекло. Запросите новый код.');
            break;
          // pending — ждём дальше
        }
      },
      error: (err) => {
        this.pollInFlight = false;
        const e = extractApiError(err);
        // Сетевые сбои и rate-limit молча переживаем — следующий тик повторит.
        if (e.code === 'APPROVAL_NOT_FOUND' || e.code === 'LOGIN_BLOCKED') {
          this.abort(e.message ?? 'Не удалось подтвердить вход');
        }
      },
    });
  }

  private abort(message: string): void {
    this.stopPolling();
    this.approvalToken = null;
    this.step.set('code');
    this.code.set('');
    this.codeErr.set(message);
    this.startCountdown();
  }
}

const RESEND_SECONDS = 45;
