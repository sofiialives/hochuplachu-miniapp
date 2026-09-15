import { Injectable, PLATFORM_ID, inject } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';

// ImageCacheService — хранит ответы по картинкам в браузерном Cache Storage
// (`caches`-API), чтобы фоны карт не перезапрашивались при каждой перезагрузке
// страницы. На внешних URL это спасает даже без HTTP cache-control;
// на /assets — дополнительный fallback, если nginx сменит max-age.
//
// Возвращаем blob: URL — он создаётся из тела закешированного Response, без
// сетевого запроса. При первом обращении (cache miss) делаем `fetch`, кладём
// в Cache Storage и тоже отдаём blob URL.

const CACHE_NAME = 'hp-card-bg-v1';

@Injectable({ providedIn: 'root' })
export class ImageCacheService {
  private readonly platformId = inject(PLATFORM_ID);
  // memo — внутрисессионный кеш, чтобы для одного URL Promise решался один раз.
  // Cache Storage переживает перезагрузку, memo — нет. Это OK: после reload
  // первый resolve пойдёт в Cache Storage и тоже не дёрнет сеть.
  private readonly memo = new Map<string, Promise<string>>();

  async resolve(url: string | null | undefined): Promise<string> {
    const raw = (url ?? '').trim();
    if (!raw) return '';
    if (!isPlatformBrowser(this.platformId)) return raw;
    if (typeof caches === 'undefined') return raw;
    // data: и blob: уже самодостаточные, не кешируем повторно.
    if (raw.startsWith('data:') || raw.startsWith('blob:')) return raw;

    const cached = this.memo.get(raw);
    if (cached) return cached;
    const p = this.fetchAndCache(raw);
    this.memo.set(raw, p);
    return p;
  }

  private async fetchAndCache(url: string): Promise<string> {
    try {
      const cache = await caches.open(CACHE_NAME);
      let response = await cache.match(url);
      if (!response) {
        response = await fetch(url, { mode: 'cors', credentials: 'omit' });
        if (response.ok) {
          // Клонируем ДО чтения — body можно прочитать только один раз.
          await cache.put(url, response.clone());
        } else {
          return url;
        }
      }
      const blob = await response.blob();
      return URL.createObjectURL(blob);
    } catch {
      return url;
    }
  }
}
