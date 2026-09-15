import { HttpErrorResponse } from '@angular/common/http';

export interface ApiErrorPayload {
  code?: string;
  message?: string;
  payload?: Record<string, unknown>;
}

export function extractApiError(err: unknown): ApiErrorPayload {
  if (err instanceof HttpErrorResponse) {
    const body = err.error as { error?: ApiErrorPayload } | undefined;
    if (body?.error) return body.error;
    if (err.status === 0) return { code: 'NETWORK', message: 'Нет связи с сервером' };
    return { code: 'HTTP_' + err.status, message: err.statusText || 'Ошибка запроса' };
  }
  return { code: 'UNKNOWN', message: 'Неизвестная ошибка' };
}

export function errorMessage(err: unknown, fallback = 'Что-то пошло не так'): string {
  const e = extractApiError(err);
  return e.message || fallback;
}

export const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
