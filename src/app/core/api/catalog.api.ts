import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { ApiService } from './api.service';

/** Статус раздела каталога: coming_soon — у бренда нет активных
 *  продуктов/провайдеров, рисуем заглушку «Раздел в разработке». */
export type SectionState = 'available' | 'coming_soon';

export interface CatalogSections {
  cards: SectionState;
  esim: SectionState;
  services: SectionState;
}

/** Элемент единой истории заказов GET /profile/orders (union всех типов).
 *  Поля за пределами общих заполняются по type (см. profile_orders.go). */
export interface ProfileOrderItem {
  type: 'card_order' | 'topup' | 'renewal' | 'esim_order' | 'esim_recharge' | 'service_order';
  id: string;
  created_at: string;
  status: string;
  amount?: number;
  currency?: string;
  amount_payment?: number;
  payment_currency?: string;
  paid_at?: string | null;
  provider?: string;
  // discount_amount — скидка промокода в валюте заказа; 0 = промокод не
  // применялся, и строка истории про него молчит.
  discount_amount?: number;
  // card_order
  card_product_id?: string;
  // topup / renewal
  card_id?: string;
  // esim_order / esim_recharge
  esim_product_id?: string;
  esim_id?: string;
  product_name?: string;
  // service_order
  service_product_id?: string;
  kind?: 'account_topup' | 'gift_card';
  codes_issued?: boolean;
}

@Injectable({ providedIn: 'root' })
export class CatalogApi {
  private readonly api = inject(ApiService);

  /** GET /catalog/sections — доступность разделов (cards всегда available). */
  sections(): Observable<{ sections: CatalogSections }> {
    return this.api.get('/catalog/sections');
  }

  /** GET /profile/orders — единая история заказов всех типов. */
  profileOrders(page = 1, pageSize = 25): Observable<{ items: ProfileOrderItem[]; total: number; page: number; page_size: number }> {
    return this.api.get('/profile/orders', { page, page_size: pageSize });
  }
}
