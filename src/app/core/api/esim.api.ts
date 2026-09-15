import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { ApiService, SLOW_REQUEST_TIMEOUT_MS } from './api.service';
import { BillStatus, PaymentFields } from './orders.api';

/** eSIM-тариф каталога (GET /esim/products). Отдаются только тарифы с
 *  резолвящимся провайдером; disable_purchase — рисуется некликабельным. */
export interface EsimProduct {
  id: string;
  name: string;
  description: string;
  /** ISO-2; пусто = глобальный тариф. */
  country_code: string;
  country_name: string;
  days: number;
  /** Объём трафика в МБ; 0 = безлимит. */
  data_mb: number;
  issue_price: number;
  issue_currency: string;
  disable_purchase: boolean;
  sort_order: number;
  /** Направление мультистранового пакета (europe|asia|global|…); у страновых
   *  тарифов пусто — там направлением служит country_code. */
  region_code?: string;
  region_name?: string;
  /** Покрытие регионального пакета — ISO-2 коды стран. */
  locations?: string[];
}

/** Карточка направления на витрине «Все направления». */
export interface EsimDirection {
  /** ISO-2 страны либо код региона. */
  code: string;
  name: string;
  /** ISO-2 в нижнем регистре для картинки флага (/assets/flags/{flag}.svg). */
  flag?: string;
  /** Иконка региона — у регионов флага нет. */
  emoji?: string;
  min_price: number;
  currency: string;
  plans: number;
  popular?: boolean;
  /** Сколько стран покрывает региональный пакет. */
  countries?: number;
}

/** Купленная eSIM юзера (GET /esim/my; без QR — он только через POST /qr). */
export interface MyEsim {
  id: string;
  created_at: string;
  esim_order_id: string;
  esim_product_id: string;
  status: 'issuing' | 'active' | 'expired' | 'depleted' | string;
  name: string;
  country_code: string;
  country_name: string;
  days: number;
  data_mb: number;
  iccid: string;
  data_total_mb?: number | null;
  data_used_mb?: number | null;
  data_left_mb?: number | null;
  expire_at?: string | null;
  /** lastSyncAt ПРОВАЙДЕРА (не время нашего запроса). */
  usage_synced_at?: string | null;
  /** true в ответе usage/refresh — провайдер недоступен, отдан кеш. */
  stale?: boolean;
}

/** Заявка на покупку eSIM (EnrichEsimOrder). Статусы:
 *  pending_payment|pending_kyc|paid|issued|failed|refunded|cancelled. */
export interface EsimOrder extends PaymentFields {
  id: string;
  created_at: string;
  esim_product_id: string;
  product_name: string;
  status: string;
  amount_issue: number;
  issue_currency: string;
  issued_esim_id?: string;
}

/** Заявка на продление eSIM (EnrichEsimRecharge). Статусы:
 *  pending_payment|pending_kyc|paid|done|failed|refunded|cancelled. */
export interface EsimRecharge extends PaymentFields {
  id: string;
  created_at: string;
  esim_id: string;
  esim_product_id: string;
  status: string;
  amount: number;
  currency: string;
}

export interface EsimOrderRequest {
  esim_product_id: string;
  payment_currency: string;
  promo_code?: string;
  requisites_from?: Record<string, string>;
  matomo_cid?: string;
  utm?: Record<string, string>;
}

export interface EsimRechargeRequest {
  payment_currency: string;
  promo_code?: string;
  requisites_from?: Record<string, string>;
  matomo_cid?: string;
  utm?: Record<string, string>;
}

@Injectable({ providedIn: 'root' })
export class EsimApi {
  private readonly api = inject(ApiService);

  /** Каталог тарифов. `direction` (ISO-2 страны либо код региона) сужает выборку
   *  НА СЕРВЕРЕ: каталог провайдера — тысячи позиций, а странице направления
   *  нужны десятки. */
  products(direction?: string): Observable<{ products: EsimProduct[] }> {
    const path = direction ? `/esim/products?direction=${encodeURIComponent(direction)}` : '/esim/products';
    return this.api.get(path);
  }

  /** Один тариф по id — чекауту и продлению незачем качать весь каталог. */
  product(id: string): Observable<{ product: EsimProduct }> {
    return this.api.get(`/esim/products/${encodeURIComponent(id)}`);
  }

  /** Витрина направлений: страны и регионы с «от N ₽». Отдельный запрос —
   *  тарифов тысячи, гонять их целиком ради сетки карточек незачем. */
  directions(): Observable<{ countries: EsimDirection[]; regions: EsimDirection[] }> {
    return this.api.get('/esim/directions');
  }

  my(): Observable<{ esims: MyEsim[] }> { return this.api.get('/esim/my'); }
  /** Живой остаток трафика (throttle 1/мин на eSIM у бэка). При недоступном
   *  провайдере приходит кеш с stale=true. */
  refreshUsage(esimId: string): Observable<{ esim: MyEsim }> {
    return this.api.post(`/esim/my/${esimId}/usage/refresh`, {});
  }
  /** LPA-строка активации (bearer-секрет). Каждый просмотр аудитится бэком. */
  qr(esimId: string): Observable<{ qr: string; iccid: string }> {
    return this.api.post(`/esim/my/${esimId}/qr`, {});
  }

  // Money-мутирующие POST — с увеличенным таймаутом (см. orders.api.ts).
  createOrder(body: EsimOrderRequest): Observable<{ order: EsimOrder }> {
    return this.api.post('/esim/orders', body, SLOW_REQUEST_TIMEOUT_MS);
  }
  getOrder(id: string): Observable<{ order: EsimOrder }> { return this.api.get(`/esim/orders/${id}`); }
  rescheduleOrder(id: string): Observable<{ order: EsimOrder }> {
    return this.api.post(`/esim/orders/${id}/reschedule`, {}, SLOW_REQUEST_TIMEOUT_MS);
  }
  cancelOrder(id: string): Observable<unknown> { return this.api.post(`/esim/orders/${id}/cancel`, {}); }
  uploadOrderBill(id: string, file: File): Observable<{ ok: boolean }> {
    return this.api.postMultipart(`/esim/orders/${id}/bill`, billForm(file));
  }
  orderBillStatus(id: string): Observable<{ status: BillStatus }> { return this.api.get(`/esim/orders/${id}/bill`); }

  /** Можно ли продлить eSIM «тем же планом» (живой TOPUP-каталог вендора).
   *  false — у вендора нет пакета продления этого тарифа (микро-планы);
   *  сбои каталога бэкенд деградирует в true (fail-open). */
  rechargeAvailability(esimId: string): Observable<{ available: boolean }> {
    return this.api.get(`/esim/my/${esimId}/recharge/availability`);
  }
  createRecharge(esimId: string, body: EsimRechargeRequest): Observable<{ recharge: EsimRecharge }> {
    return this.api.post(`/esim/my/${esimId}/recharge`, body, SLOW_REQUEST_TIMEOUT_MS);
  }
  getRecharge(id: string): Observable<{ recharge: EsimRecharge }> { return this.api.get(`/esim/recharges/${id}`); }
  rescheduleRecharge(id: string): Observable<{ recharge: EsimRecharge }> {
    return this.api.post(`/esim/recharges/${id}/reschedule`, {}, SLOW_REQUEST_TIMEOUT_MS);
  }
  cancelRecharge(id: string): Observable<unknown> { return this.api.post(`/esim/recharges/${id}/cancel`, {}); }
  uploadRechargeBill(id: string, file: File): Observable<{ ok: boolean }> {
    return this.api.postMultipart(`/esim/recharges/${id}/bill`, billForm(file));
  }
  rechargeBillStatus(id: string): Observable<{ status: BillStatus }> { return this.api.get(`/esim/recharges/${id}/bill`); }
}

function billForm(file: File): FormData {
  const fd = new FormData();
  fd.append('file', file, file.name);
  return fd;
}

/** Человекочитаемый объём трафика: 0 = безлимит; МБ < 1024, иначе ГБ. */
export function formatDataMb(mb: number): string {
  if (!mb) return 'Безлимит';
  if (mb < 1024) return `${mb} МБ`;
  const gb = mb / 1024;
  return `${Number.isInteger(gb) ? gb : gb.toFixed(1)} ГБ`;
}

/** Склонение «день/дня/дней». */
export function daysWord(n: number): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod100 >= 11 && mod100 <= 14) return 'дней';
  if (mod10 === 1) return 'день';
  if (mod10 >= 2 && mod10 <= 4) return 'дня';
  return 'дней';
}
