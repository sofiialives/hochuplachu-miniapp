import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { ApiService, SLOW_REQUEST_TIMEOUT_MS } from './api.service';

// kyc.api — типы зеркалят openapi KycVerificationInfo (см. /api/v2/kyc/:id).
export type KycStatus =
  | 'Not Started'
  | 'In Progress'
  | 'In Review'
  | 'Approved'
  | 'Declined'
  | 'Expired'
  | 'Abandoned';

export interface KycSession {
  sessionId: string;
  status: KycStatus;
  errorMessage?: string | null;
  verificationUrl?: string;
  serviceName?: string | null;
  step?: 'passport' | 'registration' | 'selfie' | 'review';
}

/** Тип заявки-владельца KYC-сессии. Новые payable-типы (eSIM/сервисы)
 *  попадают сюда через ветку pending_kyc cc-оплаты (требование обменника). */
export type KycOwnerType = 'card_order' | 'topup' | 'renewal' | 'esim_order' | 'esim_recharge' | 'service_order';

export interface KycFinishResult {
  coincat_order_id: string;
  status: string;
  owner_type: '' | KycOwnerType;
  owner_id: string;
  /** Для topup/renewal: их payment-роуты включают :cardId, одного owner_id
   *  для навигации после finish недостаточно. Пусто у остальных типов. */
  card_id: string;
}

/** Точка возобновления незавершённого KYC (заявка в pending_kyc за последние
 *  24ч). session_id="" — возобновлять нечего. */
export interface KycActiveResult {
  session_id: string;
  owner_type?: KycOwnerType;
  owner_id?: string;
}

@Injectable({ providedIn: 'root' })
export class KycApi {
  private readonly api = inject(ApiService);

  getStatus(id: string): Observable<KycSession> { return this.api.get(`/kyc/${id}`); }
  /** Самая свежая pending_kyc-заявка юзера — для авто-резюма после того, как
   *  Telegram убил Mini App посреди верификации (см. app-shell). */
  active(): Observable<KycActiveResult> { return this.api.get('/kyc/active'); }
  // finish на бэкенде синхронно зовёт неидемпотентный coincat
  // finishOrderVerification (создаёт реальную заявку) — ранний клиентский
  // таймаут открывал бы окно двойного вызова, поэтому потолок увеличен.
  finish(id: string): Observable<KycFinishResult> { return this.api.post(`/kyc/${id}/finish`, {}, SLOW_REQUEST_TIMEOUT_MS); }
}
