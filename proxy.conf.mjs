// dev-прокси для `ng serve`.
//
// Вынесен из JSON в JS ради одного: SDK Telegram Mini App теперь грузится со
// своего пути /js/telegram-web-app.js (в проде его отдаёт nginx, см.
// nginx.conf), поэтому наружу за ним ходит уже не браузер, а node внутри
// dev-сервера. Браузер уважает системные настройки прокси, node — нет: на
// машинах, где внешний трафик обязан идти через корпоративный HTTP-прокси,
// запрос к telegram.org висел до таймаута, и страница не открывалась вообще
// (тег в <head> синхронный).
//
// Поэтому: если в окружении задан HTTP(S)_PROXY — ходим через него. Если нет,
// или пакет-агент недоступен — идём напрямую, как раньше.

const proxyUrl =
  process.env.HTTPS_PROXY ||
  process.env.https_proxy ||
  process.env.HTTP_PROXY ||
  process.env.http_proxy;

let agent;
if (proxyUrl) {
  try {
    const { HttpsProxyAgent } = await import('https-proxy-agent');
    agent = new HttpsProxyAgent(proxyUrl);
  } catch {
    // агента нет — пробуем напрямую
  }
}

export default {
  '/js/telegram-web-app.js': {
    target: 'https://telegram.org',
    secure: true,
    changeOrigin: true,
    logLevel: 'warn',
    ...(agent ? { agent } : {}),
  },
  // Раньше тут был захардкожен адрес одноразового Cloudflare-туннеля
  // (nylon-widespread-cloth-authorities.trycloudflare.com) — такие туннели
  // живут только пока у кого-то открыта сессия, потом умирают и proxy падает
  // с ENOTFOUND. Теперь адрес берём из .env (API_PROXY_TARGET), с фолбэком
  // на локальный бэкенд по умолчанию. Если бэкенда сейчас нет вообще —
  // не страшно: ручки, покрытые mock-catalog.interceptor.ts (см. app.config.ts),
  // клиент вообще не пошлёт по сети — они перехватываются раньше, чем
  // запрос доходит до этого proxy.
  '/api': {
    target: process.env.API_PROXY_TARGET || 'http://localhost:8080',
    secure: false,
    changeOrigin: true,
    logLevel: 'warn',
  },
};
