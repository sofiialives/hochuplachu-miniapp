import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { ApiService } from './api.service';

export interface ReferralConfig {
  referrer_reward: number;
  referee_bonus: number;
  currency: string;
}

export interface ReferralInfo {
  code: string;
  link: string;
  tg_link: string;
  stats: { invited: number; paid_cards: number; total_payout: number; currency: string };
  reward: { amount: number; currency: string };
  referee_bonus: { amount: number; currency: string };
  bonus_available: number;
}

export interface ReferralPayoutRow {
  id: string;
  created_at: string;
  paid_at?: string;
  amount: number;
  currency: string;
  /** reserved — начисление зарезервировано открытой заявкой партнёра на вывод. */
  status: 'pending' | 'reserved' | 'paid';
  partner_override: boolean;
  payout_topup_id?: string;
  triggering_card_order_id?: string;
  withdrawal_id?: string;
}

/** Заявка партнёра на вывод реальных денег (решает оператор в админке). */
export interface ReferralWithdrawalRow {
  id: string;
  created_at: string;
  amount: number;
  currency: string;
  requisites: string;
  status: 'pending' | 'paid' | 'rejected';
  resolved_at?: string;
  /** Комментарий оператора (причина отказа / примечание к выплате). */
  admin_comment?: string;
}

export interface ReferralPendingSum {
  currency: string;
  amount: number;
  count: number;
}

export interface ReferralPayouts {
  payouts: ReferralPayoutRow[];
  pending: ReferralPendingSum[];
}

export interface ReferralWithdrawResult {
  topup_id: string;
  card_id: string;
  amount: number;
  currency: string;
  count: number;
}

@Injectable({ providedIn: 'root' })
export class ReferralApi {
  private readonly api = inject(ApiService);

  /** Публичный конфиг — суммы реф-программы для текстов (без авторизации). */
  config(): Observable<ReferralConfig> { return this.api.get('/referral/config'); }

  info(): Observable<ReferralInfo> { return this.api.get('/referral/info'); }

  /** История реф-начислений + агрегаты pending по валюте. */
  payouts(): Observable<ReferralPayouts> { return this.api.get('/referral/payouts'); }

  /** Выплата всех pending-начислений в валюте указанной карты на эту карту.
   *  Возвращает связанный TopUpOrder.id для перехода на success-страницу. */
  withdraw(cardId: string): Observable<ReferralWithdrawResult> {
    return this.api.post('/referral/withdraw', { card_id: cardId });
  }

  /** Заявки текущего пользователя на вывод (партнёрский путь), новые сверху. */
  withdrawals(): Observable<{ items: ReferralWithdrawalRow[] }> {
    return this.api.get('/referral/withdrawals');
  }

  /** Заявка партнёра на вывод: резервирует все pending-начисления валюты,
   *  решение принимает оператор. Только для назначенных партнёров
   *  (иначе бэк отвечает WITHDRAWAL_NOT_PARTNER). */
  createWithdrawal(currency: string, requisites: string): Observable<ReferralWithdrawalRow> {
    return this.api.post('/referral/withdrawals', { currency, requisites });
  }

  /** Помечает welcome-bonus-диалог как увиденный (NOW в БД). */
  dismissWelcome(): Observable<{ ok: boolean }> {
    return this.api.post('/referral/welcome/dismiss', {});
  }
}
