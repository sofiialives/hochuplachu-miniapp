/**
 * Открывает внешнюю ссылку в новом окне. В Telegram Mini App — через
 * WebApp.openLink (попап-блокеров там нет), в браузере — window.open('_blank').
 *
 * false — окно открыть не удалось (блокировщик всплывающих окон): вызывающий
 * оставляет пользователю кнопку-фолбэк («Перейти к оплате» на payment-странице).
 */
export function openExternalLink(url: string | null | undefined): boolean {
  if (!url || typeof window === 'undefined') return false;
  const wa = (window as unknown as { Telegram?: { WebApp?: { openLink?: (u: string) => void } } }).Telegram?.WebApp;
  if (wa?.openLink) {
    wa.openLink(url);
    return true;
  }
  return window.open(url, '_blank') != null;
}
