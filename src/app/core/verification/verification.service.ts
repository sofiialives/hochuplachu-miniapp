import { Injectable, PLATFORM_ID, computed, effect, inject, signal } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { firstValueFrom } from 'rxjs';
import { VerificationApi, VerificationStatus } from '../api/verification.api';
import { RuntimeConfigService } from '../config/runtime-config.service';
import { AuthService } from '../auth/auth.service';

/** VerificationService — обёртка над /verification/status + утилиты для
 *  pre-purchase gate и phone-polling в Telegram-flow.
 *
 *  Принципы:
 *  - В simple-режиме (cfg.verificationMode) refresh() — no-op, needed()
 *    всегда false. UI banner/section не рисует.
 *  - В strict refresh() кешируется в signal; needed()/checks() — computed
 *    производные.
 *  - pollWhilePhoneMissing — отдельный helper для phone-step в TG: после
 *    нажатия «Поделиться» frontend ждёт пока бот получит Contact и обновит
 *    User.Phone. polling каждые 2 секунды, max 60 секунд. */
@Injectable({ providedIn: 'root' })
export class VerificationService {
  private readonly api = inject(VerificationApi);
  private readonly cfg = inject(RuntimeConfigService);
  private readonly platformId = inject(PLATFORM_ID);
  private readonly auth = inject(AuthService);

  readonly status = signal<VerificationStatus | null>(null);

  constructor() {
    // Реактивно следим за auth.user(): как только user появляется (после
    // bootstrap или после in-app логина — verifyCode/confirmLink), один раз
    // освежаем статус верификации. Без этого баннер «Пройти верификацию» не
    // появлялся сразу после логина — refresh()-в инициализаторе не успевал
    // (user ещё не был установлен), и до F5 status() оставался null.
    // При смене юзера / logout — сбрасываем кеш, чтобы старые чеки не
    // протекли в новую сессию.
    let lastUserId: string | null = null;
    effect(() => {
      const u = this.auth.user();
      if (!u) {
        if (lastUserId !== null) {
          this.status.set(null);
          lastUserId = null;
        }
        return;
      }
      if (u.id !== lastUserId) {
        lastUserId = u.id;
        void this.refresh();
      }
    });
  }

  /** Strict + есть хотя бы один не-ok чек → банер/плашка/гейт. */
  readonly needed = computed(() => {
    const s = this.status();
    if (!s) return false;
    return s.mode === 'strict' && !s.all_ok;
  });

  /** В strict-режиме true если email-чек не пройден. */
  readonly emailMissing = computed(() => this.checkMissing('email'));
  readonly phoneMissing = computed(() => this.checkMissing('phone'));
  readonly providerMissing = computed(() => this.checkMissing('provider'));

  private checkMissing(key: 'email' | 'phone' | 'provider'): boolean {
    const s = this.status();
    if (!s || s.mode !== 'strict') return false;
    return !s.checks[key]?.ok;
  }

  /** Дёргает /verification/status; в simple-режиме отдаёт фейковый ok-снапшот
   *  без сетевого запроса, чтобы не плодить лишний трафик. */
  async refresh(): Promise<void> {
    if (!isPlatformBrowser(this.platformId)) return;
    if (this.cfg.verificationMode !== 'strict') {
      this.status.set({ mode: 'simple', checks: {}, all_ok: true });
      return;
    }
    try {
      const s = await firstValueFrom(this.api.status());
      this.status.set(s);
    } catch {
      // Сетевая ошибка — оставляем предыдущий снапшот. Это лучше, чем
      // обнулить и заставить wizard прыгать.
    }
  }

  /** Принудительно дёргает /verification/start (sentinel-запрос на сервере)
   *  и возвращает URL для KYC. Используется provider-шагом wizard'а. */
  async startProviderSession(): Promise<{ passed: boolean; url?: string } | null> {
    if (!isPlatformBrowser(this.platformId)) return null;
    try {
      return await firstValueFrom(this.api.start());
    } catch {
      return null;
    }
  }

  /** Сохраняет phone из web-формы. */
  async submitPhone(phone: string): Promise<boolean> {
    if (!isPlatformBrowser(this.platformId)) return false;
    try {
      await firstValueFrom(this.api.submitPhone(phone));
      await this.refresh();
      return true;
    } catch {
      return false;
    }
  }

  /** Polling пока phone.ok не станет true. Возвращает true если phone
   *  сохранился в timeoutMs; false иначе (юзер не подтвердил поделиться).
   *  Используется TG-flow: нажал «Поделиться» → ждём пока бот OnContact
   *  обновит User.Phone в БД, на каждом тике дёргаем /verification/status. */
  async pollWhilePhoneMissing(timeoutMs = 60_000, stepMs = 2000): Promise<boolean> {
    const deadline = performance.now() + timeoutMs;
    while (performance.now() < deadline) {
      await this.refresh();
      if (!this.phoneMissing()) return true;
      await new Promise((r) => setTimeout(r, stepMs));
    }
    return !this.phoneMissing();
  }
}
