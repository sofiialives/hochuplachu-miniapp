// verification-url — общий хелпер встраивания страницы верификации провайдера
// (KYC/SumSub) в iframe. Порт coincat/frontend verification-url.helper.ts: фронт
// добавляет к URL провайдера ровно один параметр — активный язык — чтобы провайдер
// открыл интерфейс на языке пользователя. Backend уже зашивает в сам URL всё
// остальное (уровень/токен сессии). Используется на /kyc/:sessionId
// (kyc-verification.page) и в strict-визарде /verification (verification.page).
import { TranslocoService } from '@jsverse/transloco';

/** Добавляет ?lang=<lang> (или &lang=, если query уже есть) к URL верификации. */
export function buildVerificationUrl(baseUrl: string, lang: string): string {
  const sep = baseUrl.includes('?') ? '&' : '?';
  return `${baseUrl}${sep}lang=${encodeURIComponent(lang)}`;
}

/** Активный язык интерфейса: transloco → <html lang> → 'ru' (SSR-безопасно). */
export function resolveActiveLang(
  transloco: TranslocoService | null | undefined,
  isBrowser: boolean,
): string {
  const active = transloco?.getActiveLang();
  if (active) return active;
  if (isBrowser && typeof document !== 'undefined') {
    return document.documentElement.lang || 'ru';
  }
  return 'ru';
}
