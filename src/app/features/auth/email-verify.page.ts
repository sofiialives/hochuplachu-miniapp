import { Component, OnDestroy, computed, inject, signal } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { ButtonComponent } from '../../ui/button.component';
import { InputComponent } from '../../ui/input.component';
import { BackBarComponent } from '../../ui/back-bar.component';
import { AuthService } from '../../core/auth/auth.service';
import { ToastService } from '../../core/notifications/toast.service';
import { EMAIL_REGEX, extractApiError } from '../../core/errors/api-error';

@Component({
  standalone: true,
  imports: [ButtonComponent, InputComponent, BackBarComponent],
  template: `<app-back-bar />
    <section class="wrap">
    @if (step() === 'email') {
      <h1 class="title">Вход по email</h1>
      <p class="hint">Введите ваш email — мы пришлём 8-значный код подтверждения.</p>
      <app-input
        [value]="email()"
        (valueChange)="onEmailChange($event)"
        (enterPressed)="sendCode()"
        type="email"
        autocomplete="email"
        inputmode="email"
        placeholder="you@example.com"
        [error]="emailError()"></app-input>
      <div class="cta">
        <app-button variant="primary" [full]="true" [loading]="loading()" [disabled]="!emailValid() || loading()" (click)="sendCode()">
          Получить код
        </app-button>
      </div>
    } @else if (step() === 'code') {
      <h1 class="title">Введите код</h1>
      <p class="hint">Мы отправили 8-значный код на <strong>{{ email() }}</strong>.</p>
      <app-input
        [value]="code()"
        (valueChange)="onCodeChange($event)"
        inputmode="numeric"
        autocomplete="one-time-code"
        name="otp"
        pattern="[0-9]{8}"
        placeholder="00000000"
        [maxLength]="8"
        [error]="codeError()"></app-input>
      <div class="cta">
        <app-button variant="primary" [full]="true" [loading]="loading()" [disabled]="code().length !== 8 || loading()" (click)="verify()">
          Войти
        </app-button>
        <button class="link-btn" type="button" (click)="backToEmail()">Заменить email</button>
      </div>
    } @else {
      <h1 class="title">Подтвердите вход в Telegram</h1>
      <div class="confirm-wait">
        <span class="spinner" aria-hidden="true"></span>
        <p class="hint">
          К этому аккаунту привязан Telegram. Мы отправили запрос в чат с ботом —
          откройте его и нажмите <strong>«Разрешить»</strong>, после этого вход завершится автоматически.
        </p>
      </div>
      <div class="cta">
        <button class="link-btn" type="button" (click)="cancelConfirm()">Отмена</button>
      </div>
    }
  </section>`,
  styles: [`
    .title { font-size: 22px; font-family: 'Syncopate Cyr'; text-transform: uppercase;} 
    .wrap {
      padding: var(--space-md) 52px var(--space-xl);
      max-width: 1200px; margin: 0 auto;
    }
    .hint { color: rgba(0, 0, 0, 1); font-size: 14px; margin-top: 6px; margin-bottom: 16px; }
    .cta { margin-top: var(--space-lg); display: flex; flex-direction: column; gap: var(--space-sm); align-items: stretch; }
    .link-btn {
      align-self: center;
      color: background: rgba(255, 186, 38, 1);;
      font-size: 14px;
      background: none; border: none; padding: var(--space-sm) var(--space-md); cursor: pointer;
      font-weight: 500;
    }
    .link-btn:hover { text-decoration: underline; }
    .confirm-wait { display: flex; flex-direction: column; align-items: center; gap: var(--space-md); margin-top: var(--space-lg); text-align: center; }
    .spinner {
      width: 40px; height: 40px; border-radius: 50%;
      border: 3px solid var(--color-border, rgba(0,0,0,.12));
      border-top-color: var(--color-primary-ink);
      animation: confirm-spin .8s linear infinite;
    }
    @keyframes confirm-spin { to { transform: rotate(360deg); } }
    @media (max-width: 1023px) {
      .wrap { padding-left: 16px; padding-right: 16px; }
    }
        @media (min-width: 1024px) {
      .wrap { padding-left: 120px; padding-right: 120px; }
      .hint { font-size: 24px; margin-top: 26px; margin-bottom: 26px; }
      .title { font-size: 44px;} 
    }
  `],
})
export class EmailVerifyPage implements OnDestroy {
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly toast = inject(ToastService);

  protected readonly step = signal<'email' | 'code' | 'confirm'>('email');
  protected readonly email = signal('');
  protected readonly code = signal('');
  protected readonly emailError = signal('');
  protected readonly codeError = signal('');
  protected readonly loading = signal(false);
  protected readonly emailValid = computed(() => EMAIL_REGEX.test(this.email().trim()));

  
  private approvalToken: string | null = null;
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  
  private pollInFlight = false;

  ngOnDestroy(): void {
    this.stopPolling();
  }

  onEmailChange(v: string): void {
    this.email.set(v);
    if (this.emailError()) this.emailError.set('');
  }

  onCodeChange(v: string): void {
    const digits = v.replace(/\D/g, '').slice(0, 8);
    this.code.set(digits);
    if (this.codeError()) this.codeError.set('');
    if (digits.length === 8 && !this.loading()) this.verify();
  }

  backToEmail(): void {
    this.step.set('email');
    this.code.set('');
    this.codeError.set('');
  }

  sendCode(): void {
    const value = this.email().trim().toLowerCase();
    if (!EMAIL_REGEX.test(value)) {
      this.emailError.set('Введите корректный email, например you@example.com');
      return;
    }
    this.loading.set(true);
    this.auth.requestCode(value).subscribe({
      next: () => {
        this.loading.set(false);
        this.step.set('code');
      },
      error: (err) => {
        this.loading.set(false);
        const e = extractApiError(err);
        if (e.code === 'RATE_LIMITED') {
          this.emailError.set('Слишком много запросов. Попробуйте через минуту.');
        } else if (e.code === 'NETWORK') {
          this.toast.error(e.message ?? 'Нет связи с сервером');
        } else {
          this.emailError.set(e.message ?? 'Не удалось отправить код');
        }
      },
    });
  }

  verify(): void {
    this.loading.set(true);
    this.codeError.set('');
    this.auth.verifyCode(this.email().trim().toLowerCase(), this.code()).subscribe({
      next: (res) => {
        this.loading.set(false);
        if (res.telegram_confirm && res.approval_token) {
          this.approvalToken = res.approval_token;
          this.step.set('confirm');
          this.startPolling();
          return;
        }
        this.finishLogin();
      },
      error: (err) => {
        this.loading.set(false);
        const e = extractApiError(err);
        if (e.code === 'CODE_INVALID') this.codeError.set('Неверный код');
        else if (e.code === 'CODE_EXPIRED') this.codeError.set('Код истёк, запросите новый');
        else if (e.code === 'TOO_MANY_ATTEMPTS') this.codeError.set('Слишком много попыток, подождите 5 минут');
        else this.codeError.set(e.message ?? 'Ошибка проверки кода');
      },
    });
  }

  cancelConfirm(): void {
    this.stopPolling();
    this.approvalToken = null;
    this.step.set('email');
    this.code.set('');
  }

  private startPolling(): void {
    this.stopPolling();
    this.pollTimer = setInterval(() => this.pollOnce(), 2000);
  }

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
            this.finishLogin();
            break;
          case 'denied':
            this.abortConfirm('Вход отклонён в Telegram.');
            break;
          case 'expired':
            this.abortConfirm('Время подтверждения истекло. Запросите новый код.');
            break;
        }
      },
      error: (err) => {
        this.pollInFlight = false;
        const e = extractApiError(err);
        if (e.code === 'APPROVAL_NOT_FOUND' || e.code === 'LOGIN_BLOCKED') {
          this.abortConfirm(e.message ?? 'Не удалось подтвердить вход');
        }
      },
    });
  }

  private abortConfirm(message: string): void {
    this.cancelConfirm();
    this.toast.error(message);
  }

  private finishLogin(): void {
    const ret = this.route.snapshot.queryParamMap.get('return');
    this.router.navigateByUrl(ret && ret.startsWith('/') ? ret : '/');
  }
}
