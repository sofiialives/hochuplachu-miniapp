import { Component, OnInit, computed, inject, input, output, signal } from '@angular/core';
import { DialogComponent } from '../../ui/dialog.component';
import { ButtonComponent } from '../../ui/button.component';
import { InputComponent } from '../../ui/input.component';
import { AuthService } from '../../core/auth/auth.service';
import { EMAIL_REGEX, extractApiError } from '../../core/errors/api-error';

@Component({
  selector: 'app-email-link-dialog',
  standalone: true,
  imports: [DialogComponent, ButtonComponent, InputComponent],
  template: `<app-dialog [title]="title()" [closable]="closable()" (dismissed)="closed.emit()">
    @if (step() === 'intro') {
      <p class="sub">✔ Воспользоваться картой</p>
      <p class="muted">Подтвердите email, и карта активирована. Это займёт меньше минуты.</p>
      <app-button variant="primary" [full]="true" (click)="step.set('email')">+ Подтвердить email</app-button>
    } @else if (step() === 'email') {
      @if (mode() === 'login') {
        <p class="muted">Введите ваш email — мы пришлём код подтверждения. Если у вас уже есть аккаунт с этим email, его карты и заявки появятся в этом аккаунте.</p>
      } @else {
        <p class="muted">Введите ваш email — мы пришлём код подтверждения.</p>
      }
      <app-input
        [value]="email()"
        (valueChange)="onEmail($event)"
        (enterPressed)="send()"
        type="email" placeholder="you@example.com"
        [error]="emailErr()"></app-input>
      <div class="cta">
        <app-button variant="primary" [full]="true" [loading]="loading()" [disabled]="!emailValid() || loading()" (click)="send()">Получить код</app-button>
      </div>
    } @else {
      <app-input
        [value]="code()"
        (valueChange)="onCode($event)"
        inputmode="numeric"
        autocomplete="one-time-code"
        name="otp"
        pattern="[0-9]{8}"
        placeholder="00000000" [maxLength]="8" [error]="codeErr()"></app-input>
      <div class="cta">
        <app-button variant="primary" [full]="true" [loading]="loading()" [disabled]="code().length !== 8 || loading()" (click)="confirm()">Подтвердить</app-button>
        <button class="link-btn" type="button" (click)="backToEmail()">Заменить email</button>
      </div>
    }
  </app-dialog>`,
  styles: [`
    .sub { font-weight: 500; color: var(--color-success); }
    /* .muted — те же значения, что .hint на email-verify.page.ts: цвет,
       размер, отступы, десктопная градация в медиа-запросе ниже. Имя класса
       не трогала (используется в шаблоне), поменяла только сами значения. */
    .muted { color: rgba(0, 0, 0, 1); font-size: 18px; margin-top: 8px; margin-bottom: 20px; }
    .cta { margin-top: var(--space-md); display: flex; flex-direction: column; gap: var(--space-sm); align-items: stretch; }
    .link-btn {
      align-self: center;
      color: rgba(255, 186, 38, 1);
      font-size: 14px;
      background: none; border: none; padding: var(--space-sm) var(--space-md); cursor: pointer;
      font-weight: 500;
    }
    .link-btn:hover { text-decoration: underline; }

    @media (min-width: 1024px) {
      .muted { font-size: 24px; margin-top: 26px; margin-bottom: 26px; }
    }
  `],
})
export class EmailLinkDialog implements OnInit {
  private readonly auth = inject(AuthService);
  protected readonly step = signal<'intro' | 'email' | 'code'>('intro');
  protected readonly email = signal('');
  protected readonly code = signal('');
  protected readonly emailErr = signal('');
  protected readonly codeErr = signal('');
  protected readonly loading = signal(false);
  protected readonly emailValid = computed(() => EMAIL_REGEX.test(this.email().trim()));
  readonly linked = output<void>();
  readonly mode = input<'link' | 'login'>('link');
  readonly closable = input(false);
  readonly closed = output<void>();

  protected readonly title = computed(() => {
    switch (this.step()) {
      case 'intro': return 'Готовы к использованию? Ваша карта ждёт!';
      case 'code': return 'Введите код';
      default: return this.mode() === 'login' ? 'Вход по email' : 'Привязать email';
    }
  });

  ngOnInit(): void {
    if (this.mode() === 'login') this.step.set('email');
  }

  onEmail(v: string): void { this.email.set(v); if (this.emailErr()) this.emailErr.set(''); }
  onCode(v: string): void {
    const digits = v.replace(/\D/g, '').slice(0, 8);
    this.code.set(digits);
    if (this.codeErr()) this.codeErr.set('');
    if (digits.length === 8 && !this.loading()) this.confirm();
  }

  backToEmail(): void {
    this.step.set('email');
    this.code.set('');
    this.codeErr.set('');
  }

  send(): void {
    const value = this.email().trim().toLowerCase();
    if (!EMAIL_REGEX.test(value)) {
      this.emailErr.set('Введите корректный email');
      return;
    }
    this.loading.set(true);
    this.auth.requestLink(value).subscribe({
      next: () => { this.loading.set(false); this.step.set('code'); },
      error: (err) => {
        this.loading.set(false);
        const e = extractApiError(err);
        this.emailErr.set(e.message ?? 'Не удалось отправить код');
      },
    });
  }

  confirm(): void {
    this.loading.set(true);
    this.codeErr.set('');
    this.auth.confirmLink(this.email().trim().toLowerCase(), this.code()).subscribe({
      next: () => { this.loading.set(false); this.linked.emit(); },
      error: (err) => {
        this.loading.set(false);
        const e = extractApiError(err);
        if (e.code === 'CODE_INVALID') this.codeErr.set('Неверный код');
        else if (e.code === 'CODE_EXPIRED') this.codeErr.set('Код истёк, запросите новый');
        else this.codeErr.set(e.message ?? 'Ошибка проверки кода');
      },
    });
  }
}