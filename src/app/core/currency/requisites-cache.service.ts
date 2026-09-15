import { Injectable, PLATFORM_ID, inject } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';

// requisites-cache — хранит введённые пользователем значения полей реквизитов
// (CreateOrderRequest.from) по currency.id, как coincat-frontend FormCacheService.
// Структура: { [currencyId]: { phone: "...", bankName: "SBER", ... }, common: { fio: "..." } }.
// Поля, имена которых одинаковы между валютами (fio, email и т.п.), читаются
// из common, специфические — из секции выбранной валюты.
const KEY = 'hp.requisitesCache';
const COMMON_FIELDS = new Set(['fio', 'recipient', 'sender']);

interface CacheShape {
  common: Record<string, string>;
  [currencyId: string]: Record<string, string>;
}

@Injectable({ providedIn: 'root' })
export class RequisitesCacheService {
  private readonly isBrowser = isPlatformBrowser(inject(PLATFORM_ID));

  load(currencyId: string): Record<string, string> {
    if (!this.isBrowser || !currencyId) return {};
    const all = this.readAll();
    const perCurrency = all[currencyId] ?? {};
    return { ...all.common, ...perCurrency };
  }

  save(currencyId: string, values: Record<string, string>): void {
    if (!this.isBrowser || !currencyId) return;
    const all = this.readAll();
    const perCurrency = { ...(all[currencyId] ?? {}) };
    const common = { ...all.common };
    for (const [k, v] of Object.entries(values)) {
      if (v == null || v === '') continue;
      if (COMMON_FIELDS.has(k)) common[k] = v;
      else perCurrency[k] = v;
    }
    all[currencyId] = perCurrency;
    all.common = common;
    try { localStorage.setItem(KEY, JSON.stringify(all)); } catch { /* quota / private mode — ignore */ }
  }

  private readAll(): CacheShape {
    try {
      const raw = localStorage.getItem(KEY);
      if (!raw) return { common: {} };
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object') {
        if (!parsed.common) parsed.common = {};
        return parsed as CacheShape;
      }
    } catch { /* corrupted — wipe */ }
    return { common: {} };
  }
}
