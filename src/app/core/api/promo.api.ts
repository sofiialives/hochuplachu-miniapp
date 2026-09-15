import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { ApiService } from './api.service';

export interface PromoValidation {
  valid: boolean;
  discount_amount: number;
  currency: string;
  free: boolean;
  final_amount: number;
}

@Injectable({ providedIn: 'root' })
export class PromoApi {
  private readonly api = inject(ApiService);
  /** product_type/product_id — контекст новых типов (esim|service); пустой
   *  product_type бэк трактует как card. Для esim-issue цену резолвит бэк,
   *  для сервисов и topup-операций amount/currency обязательны. */
  validate(body: {
    code: string;
    scope?: 'issue' | 'topup';
    card_product_id?: string;
    amount?: number;
    currency?: string;
    product_type?: 'card' | 'esim' | 'service';
    product_id?: string;
  }): Observable<PromoValidation> {
    return this.api.post('/promo/validate', body);
  }
}
