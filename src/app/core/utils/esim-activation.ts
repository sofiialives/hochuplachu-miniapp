/**
 * Ссылка «установить eSIM одним тапом» — universal link самой ОС, который
 * открывает системный установщик eSIM с уже подставленными SM-DP+ и кодом
 * активации. QR при этом остаётся: со своего же телефона его не отсканировать.
 *
 * iOS 17.4+  — https://esimsetup.apple.com/esim_qrcode_provisioning?carddata=<LPA>
 * Android 10+ — https://esimsetup.android.com/esim_qrcode_provisioning?carddata=<LPA>
 *
 * Два условия, без которых ссылка не срабатывает:
 *  - открывать её нужно ВНЕ webview приложения (системным браузером) — внутри
 *    WKWebView/Chrome-webview universal link не перехватывается ОС. В Mini App
 *    это делает `Telegram.WebApp.openLink` (по докам — «opens a link in an
 *    external browser»), см. openExternalLink;
 *  - у Android поддержка неровная: нужны свежие GMS и SIM Manager, а сама
 *    ссылка отрабатывает из Google-экосистемы (Chrome/SMS/Gmail) — из
 *    сторонних браузеров может не сработать. Поэтому QR и код остаются
 *    видимыми всегда, а кнопка — дополнительный путь, а не единственный.
 */

/** ОС, у которой есть системная установка eSIM по ссылке. */
export type EsimMobileOS = 'ios' | 'android' | null;

/**
 * detectEsimOS — платформа для universal link. tgPlatform — `WebApp.platform`
 * (AuthService.tgPlatform): в Mini App он точнее userAgent, а его непустое
 * НЕмобильное значение (tdesktop/macos/weba) означает desktop — там ставить
 * eSIM некуда. Вне Telegram платформа определяется по userAgent.
 *
 * iPadOS 13+ представляется как Macintosh — планшет с eSIM в этой ветке
 * получит только QR; ловить его по maxTouchPoints не стали, кейс краевой.
 */
export function detectEsimOS(tgPlatform: string | null): EsimMobileOS {
  if (tgPlatform === 'ios') return 'ios';
  if (tgPlatform === 'android' || tgPlatform === 'android_x') return 'android';
  if (tgPlatform) return null;
  if (typeof navigator === 'undefined') return null;
  const ua = navigator.userAgent;
  if (/iPhone|iPad|iPod/i.test(ua)) return 'ios';
  if (/Android/i.test(ua)) return 'android';
  return null;
}

/**
 * esimActivationLink — universal link установки для этой ОС; пусто, когда
 * ставить некуда (desktop) или кода нет. LPA-строка подставляется КАК ЕСТЬ:
 * `$` и `:` в query легальны, а percent-кодирование обработчики ОС не
 * разбирают (в примерах вендоров ссылка тоже нераскодированная).
 */
export function esimActivationLink(lpa: string | null | undefined, os: EsimMobileOS): string {
  const code = (lpa ?? '').trim();
  if (!code || !os) return '';
  const host = os === 'ios' ? 'esimsetup.apple.com' : 'esimsetup.android.com';
  return `https://${host}/esim_qrcode_provisioning?carddata=${code}`;
}
