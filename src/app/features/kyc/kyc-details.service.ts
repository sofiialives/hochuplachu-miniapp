import { Injectable, PLATFORM_ID, inject, signal } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { KycApi, KycSession } from '../../core/api/kyc.api';

// kyc-details.service — порт coincat/frontend kyc-details.service.ts:
// первоначальный GET /kyc/:id + polling каждые 10s, останавливается по
// stopWatching() (на ngOnDestroy страницы). Без browser-окружения (Karma) —
// fetch и таймер не стартуют, см. isBrowser ниже.
const POLL_INTERVAL_MS = 10000;

@Injectable({ providedIn: 'root' })
export class KycDetailsService {
  private readonly api = inject(KycApi);
  private readonly isBrowser = isPlatformBrowser(inject(PLATFORM_ID));

  readonly kycSession = signal<KycSession | null>(null);

  private sessionId = '';
  private pollingTimer: ReturnType<typeof setInterval> | null = null;
  private watching = false;

  fetchKycSession(sessionId: string): void {
    this.sessionId = sessionId;
    this.watching = true;

    if (!this.kycSession()) {
      this.api.getStatus(sessionId).subscribe({
        next: (s) => { if (this.watching) this.kycSession.set(s); },
        error: () => { /* первый запрос мог 404'ить если сессия ещё не создана — продолжим polling'ом */ },
      });
    }

    if (!this.isBrowser) return;
    this.pollingTimer = setInterval(() => {
      if (!this.watching) return;
      this.api.getStatus(this.sessionId).subscribe({
        next: (s) => { if (s && this.watching) this.kycSession.set(s); },
        error: () => {},
      });
    }, POLL_INTERVAL_MS);
  }

  stopWatching(): void {
    this.watching = false;
    if (this.pollingTimer) {
      clearInterval(this.pollingTimer);
      this.pollingTimer = null;
    }
    this.kycSession.set(null);
  }
}
