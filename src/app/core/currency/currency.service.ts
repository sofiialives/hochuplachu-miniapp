import { Injectable, inject, signal } from '@angular/core';
import { Observable, tap } from 'rxjs';
import { ApiService } from '../api/api.service';

export interface PaymentCurrencyLevel {
  min_amount: number;
  max_amount: number;
  rate: number;
  fee: number;
}

export interface PaymentCurrencyValidate {
  type: string;
  rule?: string;
}

export interface PaymentCurrencyField {
  name: string;
  required: boolean;
  type: string;
  min_length?: number;
  max_length?: number;
  validates?: PaymentCurrencyValidate[];
}

export interface PaymentCurrency {
  id: string;
  currency_short_name: string;
  short_name: string;
  name: string;
  symbol: string;
  type: string;
  rate: number;
  levels?: PaymentCurrencyLevel[];
  reverse_levels?: PaymentCurrencyLevel[];
  fields_from?: PaymentCurrencyField[];
  /** Провайдер метода оплаты: 'cc' (Coincat) | 'kassaai' | 'platega' | 'enot' (СБП). */
  provider?: string;
  /** false — метод включён, но условия доступности юзеру не выполнены:
   *  рисуется отключённым с серой подписью condition_note. */
  available?: boolean;
  condition_note?: string;
}

/** Scope списка методов оплаты: покупка / пополнение+продление. */
export type PaymentScope = 'issue' | 'topup';

/** Тип продукта для /payment/methods (merge глобальных строк и
 *  переопределений типа на бэке). Дефолт card — старые вызовы не меняются. */
export type PaymentProductType = 'card' | 'esim' | 'service';

/** Метод доступен для выбора (undefined = легаси-ответ без поля). */
export function isMethodAvailable(c: PaymentCurrency): boolean {
  return c.available !== false;
}

/** СБП-провайдеры (kassaai / platega / enot): оплата счётом-инвойсом с QR
 *  либо по ссылке пейформы — без формы реквизитов плательщика, заявка
 *  создаётся сразу. */
export function isSbpProvider(provider: string | undefined): boolean {
  return provider === 'kassaai' || provider === 'platega' || provider === 'enot';
}

/**
 * nonPhoneFromFields — поля, которые НЕ являются телефоном. Используется
 * чтобы спрятать input phone из формы реквизитов на checkout/topup/extend:
 * backend сам подставит `from.phone` из User.Phone (см. callCoincatCreateOrder).
 *
 * Если у валюты единственное поле было phone — диалог открывать не нужно,
 * заявку шлём напрямую (см. использование в checkout.page.ts / topup.page.ts).
 */
export function nonPhoneFromFields(c?: PaymentCurrency | null): PaymentCurrencyField[] {
  return (c?.fields_from ?? []).filter((f) => f.type !== 'phone' && f.name !== 'phone');
}

export interface SbpBank {
  bank_id: string;
  name: string;
  logo_url: string;
  schema: string;
  package_name?: string;
  web_client_url?: string;
  is_dr_active: boolean;
}

@Injectable({ providedIn: 'root' })
export class CurrencyService {
  private readonly api = inject(ApiService);
  /** Кэш методов оплаты scope=issue product_type=card (курсы для
   *  каталога карт / rate-quote — читают ТОЛЬКО card-кеш). */
  readonly issueMethods = signal<PaymentCurrency[]>([]);
  /** Кэш последних ответов по ключу `${scope}:${productType}` — страницы
   *  могут читать синхронно, не дожидаясь своей загрузки. */
  private readonly methodsCache = new Map<string, PaymentCurrency[]>();

  /** Единый список методов оплаты (cc-валюты + СБП kassaai/platega) c
   *  признаком доступности. Источник — /payment/methods (админ-раздел
   *  «Методы оплаты»); product_type выбирает переопределения типа. */
  loadMethods(scope: PaymentScope, productType: PaymentProductType = 'card'): Observable<{ methods: PaymentCurrency[]; receive_currency: string }> {
    return this.api.get<{ methods: PaymentCurrency[]; receive_currency: string }>(
      `/payment/methods?scope=${scope}&product_type=${productType}`,
    ).pipe(
      tap((res) => {
        this.methodsCache.set(`${scope}:${productType}`, res.methods);
        if (scope === 'issue' && productType === 'card') this.issueMethods.set(res.methods);
      }),
    );
  }

  /** Синхронный снапшот кэша методов (пусто, если ещё не грузили). */
  cachedMethods(scope: PaymentScope, productType: PaymentProductType = 'card'): PaymentCurrency[] {
    return this.methodsCache.get(`${scope}:${productType}`) ?? [];
  }

  loadSbpBanks(): Observable<{ banks: SbpBank[] }> {
    return this.api.get<{ banks: SbpBank[] }>('/payment/cc/sbp-banks');
  }

  paymentInfo(): Observable<{ receive_currency: string; support_bot_url: string; knowledge_base_url: string }> {
    return this.api.get('/payment/info');
  }
}
