import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { ApiService } from './api.service';

export interface CardTransaction {
  id: string;
  card_id: string;
  kind: string;
  amount: number;
  currency: string;
  description: string;
  raw_currency_amount?: number;
  raw_currency?: string;
  fee_amount?: number;
  status: string;
  happened_at: string;
}

@Injectable({ providedIn: 'root' })
export class TransactionsApi {
  private readonly api = inject(ApiService);
  list(filter?: { card_id?: string; kind?: string; from?: string; to?: string }): Observable<{ items: CardTransaction[] }> {
    return this.api.get('/transactions', filter);
  }
}
