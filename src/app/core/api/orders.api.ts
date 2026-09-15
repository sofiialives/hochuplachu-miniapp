import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { ApiService, SLOW_REQUEST_TIMEOUT_MS } from './api.service';

// Флаг «карта выпускается» для ЛК: заявка оплачена, но card-строка появится
// на backend только по событию card.issued (rabbit round-trip к issuer'у).
// Без флага главный экран сразу после оплаты утверждал бы «У вас ещё нет
// виртуальных карт». Пишут checkout (мгновенно оплаченный бесплатный выпуск)
// и payment.page (переход card-order в paid/issuing), читает и чистит
// home.page (поллинг GET /orders/:id до issued/терминального статуса).
const ISSUING_ORDER_KEY = 'hp.issuing_order_id';
export function storeIssuingOrderId(id: string): void {
  localStorage.setItem(ISSUING_ORDER_KEY, id);
}
export function readIssuingOrderId(): string {
  return localStorage.getItem(ISSUING_ORDER_KEY) ?? '';
}
export function clearIssuingOrderId(): void {
  localStorage.removeItem(ISSUING_ORDER_KEY);
}

// Order — плоский DTO заявки на выпуск карты. Backend пакует сюда persistent-поля
// CardOrder + распакованные ключи payment_details + computed (currency_short_name,
// payment_currency_type). См. services.EnrichCardOrder в backend.
// Никакого отдельного `payment` envelope — всё в одном объекте.
export interface Order {
  id: string;
  card_product_id: string;
  status: string;
  provider: 'cc' | 'kassaai' | 'platega' | 'enot';
  amount_issue: number;
  amount_payment: number;
  payment_currency: string;
  discount_amount?: number;
  paid_at?: string;
  failure_reason?: string;

  // computed
  currency_short_name?: string;
  payment_currency_type?: 'crypto' | 'banking' | 'digital' | 'cash' | string;

  // coincat
  coincat_order_id?: string;
  coincat_order_code?: string;
  coincat_status?: string;

  // распакованные payment_details
  deposit_requisites?: Record<string, unknown>;
  deposit_requisites_type?: string; // 'card'|'phone'|'account'|'complex'|'raw'
  payment_link?: string;
  payment_link_bill?: string;
  address?: string;
  url?: string;
  qr?: string;
  /** Режим показа СБП-оплаты: 'qr' — QR на нашей странице (H2H);
   *  'redirect' — пейформа эквайра в новом окне + ожидание у нас. */
  mode?: 'qr' | 'redirect';
  expires_at?: string;
  bill_type?: string; // 'qr'|'email'|''
}

// TopUp — плоский DTO пополнения. Те же правила, что и Order.
export interface TopUp {
  id: string;
  card_id: string;
  status: string;
  provider: 'cc' | 'kassaai' | 'platega' | 'enot';
  amount: number;
  currency: string;
  amount_payment: number;
  payment_currency: string;
  /** Пригласительный бонус, зачисляемый на карту сверх amount (первое
   *  пополнение первой карты приглашённого). На оплату не влияет.
   *  0 — бонуса не было. */
  referral_bonus?: number;
  paid_at?: string;
  failure_reason?: string;

  currency_short_name?: string;
  payment_currency_type?: 'crypto' | 'banking' | 'digital' | 'cash' | string;

  coincat_order_id?: string;
  coincat_order_code?: string;
  coincat_status?: string;

  deposit_requisites?: Record<string, unknown>;
  deposit_requisites_type?: string;
  payment_link?: string;
  payment_link_bill?: string;
  address?: string;
  url?: string;
  qr?: string;
  /** Режим показа СБП-оплаты: 'qr' — QR на нашей странице (H2H);
   *  'redirect' — пейформа эквайра в новом окне + ожидание у нас. */
  mode?: 'qr' | 'redirect';
  expires_at?: string;
  bill_type?: string;
}

// BillStatus: 0 — нет/обрабатывается, 1 — принят, 2 — отклонён.
export type BillStatus = 0 | 1 | 2;

/** Общие платёжные поля payable-заявок новых типов (eSIM/сервисы) — зеркало
 *  enrichPaymentInfo backend'а: coincat-поля, метаданные валюты и
 *  распакованные payment_details. У card-заявок (Order/TopUp/ServiceRenewal)
 *  та же форма, но provider там без пустого значения — их интерфейсы выше
 *  остаются как есть. */
export interface PaymentFields {
  /** Платёжный провайдер; '' у free-заявок (метод оплаты не резолвился). */
  provider: 'cc' | 'kassaai' | 'platega' | 'enot' | '';
  amount_payment: number;
  payment_currency: string;
  discount_amount?: number;
  paid_at?: string;
  failure_reason?: string;

  currency_short_name?: string;
  payment_currency_type?: 'crypto' | 'banking' | 'digital' | 'cash' | string;

  coincat_order_id?: string;
  coincat_order_code?: string;
  coincat_status?: string;

  deposit_requisites?: Record<string, unknown>;
  deposit_requisites_type?: string;
  payment_link?: string;
  payment_link_bill?: string;
  address?: string;
  url?: string;
  qr?: string;
  /** Режим показа СБП-оплаты: 'qr' — QR на нашей странице (H2H);
   *  'redirect' — пейформа эквайра в новом окне + ожидание у нас. */
  mode?: 'qr' | 'redirect';
  expires_at?: string;
  bill_type?: string;
}

// ServiceRenewal — плоский DTO заявки на продление обслуживания. Сумма не
// задаётся пользователем — берётся из CardProduct.annual_service_fee.
// При успешной оплате backend продлевает Card.service_expires_at на
// extension_days (365). См. services.EnrichServiceRenewal в backend.
export interface ServiceRenewal {
  id: string;
  card_id: string;
  status: string;
  provider: 'cc' | 'kassaai' | 'platega' | 'enot';
  amount: number;
  currency: string;
  amount_payment: number;
  payment_currency: string;
  discount_amount?: number;
  extension_days: number;
  paid_at?: string;
  failure_reason?: string;

  currency_short_name?: string;
  payment_currency_type?: 'crypto' | 'banking' | 'digital' | 'cash' | string;

  coincat_order_id?: string;
  coincat_order_code?: string;
  coincat_status?: string;

  deposit_requisites?: Record<string, unknown>;
  deposit_requisites_type?: string;
  payment_link?: string;
  payment_link_bill?: string;
  address?: string;
  url?: string;
  qr?: string;
  /** Режим показа СБП-оплаты: 'qr' — QR на нашей странице (H2H);
   *  'redirect' — пейформа эквайра в новом окне + ожидание у нас. */
  mode?: 'qr' | 'redirect';
  expires_at?: string;
  bill_type?: string;
}

@Injectable({ providedIn: 'root' })
export class OrdersApi {
  private readonly api = inject(ApiService);

  // Money-мутирующие POST идут с увеличенным таймаутом: их хендлеры синхронно
  // ходят в coincat (суммарно до ~90s) и не отменяются при клиентском аборте —
  // ранний таймаут провоцировал бы ретрай и дубль заявки (см. api.service.ts).
  issue(body: { card_product_id: string; payment_currency: string; promo_code?: string; requisites_from?: Record<string, string>; matomo_cid?: string; utm?: Record<string, string> }): Observable<{ order: Order }> {
    return this.api.post('/orders/issue', body, SLOW_REQUEST_TIMEOUT_MS);
  }
  // Возвращает один Order — backend сам делает live refresh реквизитов из
  // coincat при precondition. См. GetOrder controller.
  get(id: string): Observable<{ order: Order }> { return this.api.get(`/orders/${id}`); }
  cancel(id: string): Observable<unknown> { return this.api.post(`/orders/${id}/cancel`, {}); }
  reschedule(id: string): Observable<{ order: Order }> { return this.api.post(`/orders/${id}/reschedule`, {}, SLOW_REQUEST_TIMEOUT_MS); }

  topup(cardId: string, body: { amount: number; payment_currency: string; promo_code?: string; requisites_from?: Record<string, string>; matomo_cid?: string; utm?: Record<string, string> }): Observable<{ topup: TopUp }> {
    return this.api.post(`/cards/${cardId}/topup`, body, SLOW_REQUEST_TIMEOUT_MS);
  }
  getTopUp(id: string): Observable<{ topup: TopUp }> { return this.api.get(`/topups/${id}`); }
  rescheduleTopUp(id: string): Observable<{ topup: TopUp }> { return this.api.post(`/topups/${id}/reschedule`, {}, SLOW_REQUEST_TIMEOUT_MS); }

  // multipart file upload — auth-interceptor добавит Bearer/Telegram заголовки.
  uploadOrderBill(id: string, file: File): Observable<{ ok: boolean }> {
    return this.api.postMultipart(`/orders/${id}/bill`, billForm(file));
  }
  getOrderBillStatus(id: string): Observable<{ status: BillStatus }> {
    return this.api.get(`/orders/${id}/bill`);
  }
  uploadTopUpBill(id: string, file: File): Observable<{ ok: boolean }> {
    return this.api.postMultipart(`/topups/${id}/bill`, billForm(file));
  }
  getTopUpBillStatus(id: string): Observable<{ status: BillStatus }> {
    return this.api.get(`/topups/${id}/bill`);
  }

  // Service renewal (продление годового обслуживания карты).
  extendService(
    cardId: string,
    body: { payment_currency: string; promo_code?: string; requisites_from?: Record<string, string>; matomo_cid?: string; utm?: Record<string, string> },
  ): Observable<{ renewal: ServiceRenewal }> {
    return this.api.post(`/cards/${cardId}/extend-service`, body, SLOW_REQUEST_TIMEOUT_MS);
  }
  getRenewal(id: string): Observable<{ renewal: ServiceRenewal }> {
    return this.api.get(`/renewals/${id}`);
  }
  uploadRenewalBill(id: string, file: File): Observable<{ ok: boolean }> {
    return this.api.postMultipart(`/renewals/${id}/bill`, billForm(file));
  }
  getRenewalBillStatus(id: string): Observable<{ status: BillStatus }> {
    return this.api.get(`/renewals/${id}/bill`);
  }
}

function billForm(file: File): FormData {
  const fd = new FormData();
  fd.append('file', file, file.name);
  return fd;
}
