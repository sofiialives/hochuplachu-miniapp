import { Injectable, inject } from '@angular/core';
import { PreloadingStrategy, Route } from '@angular/router';
import { Observable, of, switchMap } from 'rxjs';
import { AuthService } from '../auth/auth.service';

// SectionPreloadStrategy — фоновая догрузка чанков основных разделов
// (пункты bottom-nav), чтобы переключение между ними не упиралось в скачивание
// JS: без неё первый заход в eSIM/Сервисы/Профиль сначала тянет свой чанк по
// мобильной сети и только потом рисует скелетоны.
//
// Роутер зовёт стратегию после каждого NavigationEnd (см. RouterPreloader):
// первый экран к этому моменту уже отрисован, splash снят. Роут, чей компонент
// уже загружен, роутер повторно не предлагает — так что «после КАЖДОЙ
// навигации» стоит ровно один проход по конфигу.
//
// Тянем не всё подряд, а помеченное `data: { preload: true }`. Всё остальное —
// чекауты, оплата, KYC, админка — грузится по требованию: админ-раздел самый
// тяжёлый в бандле и не нужен почти никому.
@Injectable({ providedIn: 'root' })
export class SectionPreloadStrategy implements PreloadingStrategy {
  private readonly auth = inject(AuthService);

  preload(route: Route, load: () => Observable<unknown>): Observable<unknown> {
    if (!route.data?.['preload']) return of(null);
    // Роут под canMatch (у нас это authGuard) гостю не откроется — его чанк
    // был бы скачан впустую. После входа роутер сам сделает NavigationEnd, и
    // стратегия дотянет то, что стало доступно.
    if (route.canMatch?.length && !this.auth.isAuthenticated()) return of(null);
    return whenIdle().pipe(switchMap(() => load()));
  }
}

// Сколько ждём простоя главного потока, прежде чем начать качать. Сразу после
// первой навигации страница ещё добирает свои данные и дорисовывается —
// параллельная загрузка чанков отнимает у неё и сеть, и CPU на парсинг.
const IDLE_DEADLINE_MS = 2_000;
// Фолбэк для браузеров без requestIdleCallback — это Safari до 17.4, то есть
// WKWebView, в котором Telegram открывает Mini App на iOS. Там просто пауза.
const IDLE_FALLBACK_MS = 1_000;

/** Однократный «сигнал простоя»: next+complete, когда главный поток свободен
 *  (или когда истёк дедлайн). Отписка снимает запланированный колбэк. */
function whenIdle(): Observable<void> {
  return new Observable<void>((subscriber) => {
    const fire = (): void => {
      subscriber.next();
      subscriber.complete();
    };
    if (typeof requestIdleCallback === 'function') {
      const handle = requestIdleCallback(fire, { timeout: IDLE_DEADLINE_MS });
      return () => cancelIdleCallback(handle);
    }
    const timer = setTimeout(fire, IDLE_FALLBACK_MS);
    return () => clearTimeout(timer);
  });
}
