import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { ApiService } from './api.service';

/** Состояние одной проверки. URL непустой только у provider в случае
 *  ok=false: фронт открывает его в браузере / WebApp.openLink. */
export interface VerificationCheck {
  ok: boolean;
  url?: string;
  /** Только у phone: true когда у юзера есть telegram_id — frontend
   *  показывает кнопку «Поделиться через Telegram» вместо формы. */
  telegram_share_supported?: boolean;
}

/** Объединённый снапшот всех шагов verification.
 *  В simple-режиме сервер вернёт mode='simple', all_ok=true и пустой checks. */
export interface VerificationStatus {
  mode: 'simple' | 'strict';
  checks: {
    email?: VerificationCheck;
    phone?: VerificationCheck;
    provider?: VerificationCheck;
  };
  all_ok: boolean;
}

@Injectable({ providedIn: 'root' })
export class VerificationApi {
  private readonly api = inject(ApiService);

  status(): Observable<VerificationStatus> {
    return this.api.get<VerificationStatus>('/verification/status');
  }

  /** Принудительно пересоздаёт KYC-сессию через sentinel-запрос. Возвращает
   *  свежий URL. Используется когда юзер пришёл из профиля «Пройти верификацию»
   *  или его сессия устарела. */
  start(): Observable<{ passed: boolean; url?: string }> {
    return this.api.post<{ passed: boolean; url?: string }>('/verification/start', {});
  }

  /** Сохраняет phone из web-формы. verified остаётся false; в Telegram
   *  Mini App используем requestContact + бот ловит OnContact (см. backend),
   *  там verified=true. */
  submitPhone(phone: string): Observable<{ phone: string; phone_verified: boolean }> {
    return this.api.post<{ phone: string; phone_verified: boolean }>('/verification/phone', { phone });
  }
}
