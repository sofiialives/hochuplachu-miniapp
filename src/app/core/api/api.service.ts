import { HttpClient, HttpErrorResponse, HttpParams } from '@angular/common/http';
import { Injectable, PLATFORM_ID, inject } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { EMPTY, Observable, TimeoutError, catchError, map, throwError, timeout } from 'rxjs';
import { RuntimeConfigService } from '../config/runtime-config.service';

export interface ApiEnvelope<T> {
  ok: boolean;
  data?: T;
  error?: { code: string; message: string; payload?: Record<string, unknown> };
}

// Страховочный потолок ожидания ответа. У HttpClient нет собственного
// таймаута: если сервер принял соединение и молчит (повисший upstream,
// полуоткрытый TCP), запрос остаётся pending навсегда, а UI — в вечном
// loading (кнопка «Получить код» с бесконечным лоадером — реальный кейс).
export const REQUEST_TIMEOUT_MS = 30_000;

// Потолок для «медленных» ручек: money-мутирующие POST (issue/topup/
// extend-service/reschedule, kyc finish) на бэкенде синхронно ходят в coincat
// (до трёх последовательных вызовов с ~30s лимитом каждый) и НЕ отменяются
// при клиентском аборте — ранний фронтовый таймаут спровоцировал бы ретрай
// и дубль заявки со сгоревшим промокодом. Сюда же multipart-загрузки чеков:
// PDF по медленной мобильной сети в 30s может не уложиться.
export const SLOW_REQUEST_TIMEOUT_MS = 120_000;

@Injectable({ providedIn: 'root' })
export class ApiService {
  private readonly http = inject(HttpClient);
  private readonly cfg = inject(RuntimeConfigService);
  private readonly isBrowser = isPlatformBrowser(inject(PLATFORM_ID));

  private url(path: string): string {
    return this.cfg.config.apiBaseUrl.replace(/\/$/, '') + path;
  }

  // Оборачивает запрос таймаутом; TimeoutError конвертируем в HttpErrorResponse
  // с конвертом { error: { code, message } } — его понимает extractApiError,
  // так что все существующие error-хендлеры покажут осмысленный текст без
  // изменений. timeout() при срабатывании отписывается от источника — Angular
  // абортит XHR/fetch, «зомби»-запрос не остаётся висеть.
  private withTimeout<T>(path: string, obs: Observable<T>, timeoutMs: number): Observable<T> {
    return obs.pipe(
      timeout(timeoutMs),
      catchError((err: unknown) => {
        if (err instanceof TimeoutError) {
          return throwError(() => new HttpErrorResponse({
            status: 408,
            statusText: 'Request Timeout',
            url: this.url(path),
            error: { error: { code: 'TIMEOUT', message: 'Сервер не отвечает. Попробуйте ещё раз.' } },
          }));
        }
        return throwError(() => err);
      }),
    );
  }

  get<T>(path: string, params?: Record<string, string | number | undefined>, timeoutMs = REQUEST_TIMEOUT_MS): Observable<T> {
    if (!this.isBrowser) return EMPTY;
    let p = new HttpParams();
    for (const [k, v] of Object.entries(params ?? {})) {
      if (v !== undefined && v !== null && v !== '') p = p.set(k, String(v));
    }
    return this.withTimeout(path, this.http.get<ApiEnvelope<T>>(this.url(path), { params: p }).pipe(map((r) => r.data as T)), timeoutMs);
  }

  post<T>(path: string, body: unknown, timeoutMs = REQUEST_TIMEOUT_MS): Observable<T> {
    if (!this.isBrowser) return EMPTY;
    return this.withTimeout(path, this.http.post<ApiEnvelope<T>>(this.url(path), body).pipe(map((r) => r.data as T)), timeoutMs);
  }

  patch<T>(path: string, body: unknown, timeoutMs = REQUEST_TIMEOUT_MS): Observable<T> {
    if (!this.isBrowser) return EMPTY;
    return this.withTimeout(path, this.http.patch<ApiEnvelope<T>>(this.url(path), body).pipe(map((r) => r.data as T)), timeoutMs);
  }

  delete<T>(path: string, timeoutMs = REQUEST_TIMEOUT_MS): Observable<T> {
    if (!this.isBrowser) return EMPTY;
    return this.withTimeout(path, this.http.delete<ApiEnvelope<T>>(this.url(path)).pipe(map((r) => r.data as T)), timeoutMs);
  }

  // Multipart-загрузка (чеки PDF). Вынесена сюда, чтобы и у неё был таймаут:
  // сырой this.http.post в *.api.ts оставлял кнопку загрузки в вечном
  // спиннере при повисшем соединении — тот же класс бага, что и с email-кодом.
  postMultipart<T>(path: string, form: FormData, timeoutMs = SLOW_REQUEST_TIMEOUT_MS): Observable<T> {
    if (!this.isBrowser) return EMPTY;
    return this.withTimeout(path, this.http.post<ApiEnvelope<T>>(this.url(path), form).pipe(map((r) => r.data as T)), timeoutMs);
  }
}
