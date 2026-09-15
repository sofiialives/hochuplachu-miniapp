import { HttpInterceptorFn, HttpResponse } from '@angular/common/http';
import { isDevMode } from '@angular/core';
import { of } from 'rxjs';

// ЗАЧЕМ ЭТОТ ФАЙЛ:
// Бэкенд для бренда «Хочу Плачу!» сейчас отдаёт coming_soon для eSIM и
// Сервисов (нет активных провайдеров/привязки в админке — см. разбор в чате).
// Чтобы не гонять доступы у бэкенд-команды ради вёрстки/редизайна, здесь
// лежат моки конкретно этих ручек. Работает ТОЛЬКО в dev-сборке
// (isDevMode() === false в production build — Angular сам это гарантирует,
// поэтому в собранном на прод сайте этот код никогда не сработает) и только
// если явно включено через localStorage (см. включение ниже).
//
// Как включить/выключить, не трогая код:
//   В консоли браузера (на localhost): localStorage.setItem('mockCatalog', '1')
//   Выключить:                          localStorage.removeItem('mockCatalog')
//   Потом обновить страницу.
//
// Как отключить совсем: убрать mockCatalogInterceptor из withInterceptors([...])
// в app.config.ts — один функциональный интерцептор, больше нигде не завязан.

const TOKEN_KEY = 'hp.token';

function mockEnabled(): boolean {
  if (!isDevMode()) return false;
  try {
    return localStorage.getItem('mockCatalog') === '1';
  } catch {
    return false; // SSR/приватный режим без localStorage — просто не мокаем
  }
}

// AuthService.bootstrap() делает запрос /auth/me ТОЛЬКО если в localStorage
// уже лежит токен (иначе срабатывает ранний return, и запроса вообще не
// будет — мок ответа на /auth/me сам по себе тогда бесполезен). Поэтому
// подкладываем фейковый токен ещё на уровне модуля — до того, как
// AuthService успеет проверить localStorage. Один раз, не перезаписывает
// существующий (мало ли реальный токен уже есть от прошлой сессии).
if (mockEnabled()) {
  try {
    if (!localStorage.getItem(TOKEN_KEY)) localStorage.setItem(TOKEN_KEY, 'mock-token');
  } catch {
    /* noop */
  }
}

// envelope — фронт всегда ждёт { ok, data } (см. ApiEnvelope в api.service.ts),
// реальный HTTP-слой это разворачивает сам, поэтому мок обязан повторить форму.
function envelope<T>(data: T): { ok: true; data: T } {
  return { ok: true, data };
}

// email_linked: false и email: undefined — специально, чтобы в профиле
// появилась кнопка «Войти по email» (см. needsEmailLogin() в profile.page.ts,
// она смотрит именно на email_linked, а не на наличие telegram_id).
const MOCK_USER = {
  id: 'mock-user-1',
  telegram_id: 123456789,
  email: undefined,
  email_linked: false,
  can_relink_email: true,
  first_name: 'Тест',
  last_name: 'Тестов',
  username: 'testuser',
  photo_url: '',
  role: 'user' as const,
  email_notifications_enabled: true,
  bot_can_write: true,
  referral_code: 'MOCKREF',
  referral_type: 'ref' as const,
  referral_bonus_applied: true,
};

const MOCK_ESIM_PRODUCTS = [
  {
    id: 'mock-esim-tr-7d', name: 'Турция, 7 дней', description: '3 ГБ, локальный номер не входит',
    country_code: 'TR', country_name: 'Турция', days: 7, data_mb: 3000,
    issue_price: 590, issue_currency: 'RUB', disable_purchase: false, sort_order: 1,
  },
  {
    id: 'mock-esim-eu-14d', name: 'Европа, 14 дней', description: 'Покрытие 30+ стран, 5 ГБ',
    country_code: '', country_name: '', days: 14, data_mb: 5000,
    issue_price: 1290, issue_currency: 'RUB', disable_purchase: false, sort_order: 2,
    region_code: 'europe', region_name: 'Европа', locations: ['DE', 'FR', 'IT', 'ES', 'PT'],
  },
  {
    id: 'mock-esim-th-10d', name: 'Таиланд, 10 дней', description: 'Безлимитный интернет',
    country_code: 'TH', country_name: 'Таиланд', days: 10, data_mb: 0,
    issue_price: 990, issue_currency: 'RUB', disable_purchase: false, sort_order: 3,
  },
];

const MOCK_ESIM_DIRECTIONS = {
  countries: [
    { code: 'TR', name: 'Турция', flag: 'tr', min_price: 590, currency: 'RUB', plans: 3, popular: true },
    { code: 'TH', name: 'Таиланд', flag: 'th', min_price: 990, currency: 'RUB', plans: 2, popular: true },
    { code: 'AE', name: 'ОАЭ', flag: 'ae', min_price: 790, currency: 'RUB', plans: 2 },
    { code: 'US', name: 'США', flag: 'us', min_price: 1490, currency: 'RUB', plans: 4, popular: true },
    { code: 'GB', name: 'Великобритания', flag: 'gb', min_price: 1290, currency: 'RUB', plans: 3 },
    { code: 'DE', name: 'Германия', flag: 'de', min_price: 990, currency: 'RUB', plans: 3, popular: true },
    { code: 'FR', name: 'Франция', flag: 'fr', min_price: 990, currency: 'RUB', plans: 3 },
    { code: 'IT', name: 'Италия', flag: 'it', min_price: 890, currency: 'RUB', plans: 2 },
    { code: 'ES', name: 'Испания', flag: 'es', min_price: 890, currency: 'RUB', plans: 2, popular: true },
    { code: 'JP', name: 'Япония', flag: 'jp', min_price: 1690, currency: 'RUB', plans: 3 },
    { code: 'CN', name: 'Китай', flag: 'cn', min_price: 1150, currency: 'RUB', plans: 4, popular: true },
  ],
  regions: [
    { code: 'europe', name: 'Европа', emoji: '🇪🇺', min_price: 1290, currency: 'RUB', plans: 4, countries: 30, popular: true },
    { code: 'asia', name: 'Азия', emoji: '🌏', min_price: 1150, currency: 'RUB', plans: 3, countries: 18 },
  ],
};

const MOCK_SERVICE_PRODUCTS = [
  {
    id: 'mock-svc-steam', kind: 'account_topup', name: 'Steam', slug: 'steam',
    description: 'Пополнение баланса Steam-кошелька', icon_url: '/assets/mock/steam.svg',
    featured: true, sort_order: 1, disable_purchase: false,
    issue_currency: 'RUB', amount_currency: 'RUB', amount_unit: '', amount_label: 'Сумма пополнения',
    unit_price: 0, min_amount: 300, max_amount: 30000, fee_pct: 5, amount_presets: [500, 1000, 2000, 5000],
    login_label: 'Логин Steam', login_hint: 'Как в профиле, без @', login_prefix: '',
    denom_currency: '', denominations: null,
  },
  {
    id: 'mock-svc-tg-stars', kind: 'account_topup', name: 'Telegram Stars', slug: 'telegram-stars',
    description: 'Звёзды для подарков и оплаты внутри Telegram', icon_url: '/assets/mock/tg-stars.svg',
    featured: true, sort_order: 2, disable_purchase: false,
    issue_currency: 'RUB', amount_currency: 'XTR', amount_unit: '⭐', amount_label: 'Количество звёзд',
    unit_price: 1.8, min_amount: 50, max_amount: 5000, fee_pct: 0, amount_presets: [50, 100, 500, 1000],
    login_label: 'Username в Telegram', login_hint: 'Без @', login_prefix: '@',
    denom_currency: '', denominations: null,
  },
  {
    id: 'mock-svc-tg-premium', kind: 'subscription', name: 'Telegram Premium', slug: 'telegram-premium',
    description: 'Расширенные возможности Telegram', icon_url: '/assets/mock/tg-premium.svg',
    featured: true, sort_order: 3, disable_purchase: false,
    issue_currency: 'RUB', amount_currency: '', amount_unit: '', amount_label: '',
    unit_price: 0, min_amount: 0, max_amount: 0, fee_pct: 0, amount_presets: null,
    login_label: 'Username в Telegram', login_hint: 'Без @', login_prefix: '@',
    denom_currency: 'RUB',
    denominations: [
      { id: 'p3', label: '3 месяца', value: 3, price: 1990 },
      { id: 'p6', label: '6 месяцев', value: 6, price: 3490 },
      { id: 'p12', label: '12 месяцев', value: 12, price: 5990 },
    ],
  },
  {
    id: 'mock-svc-google-play', kind: 'gift_card', name: 'Google Play', slug: 'google-play',
    description: 'Подарочная карта Google Play', icon_url: '/assets/mock/google-play.svg',
    featured: false, sort_order: 4, disable_purchase: false,
    issue_currency: 'RUB', amount_currency: '', amount_unit: '', amount_label: '',
    unit_price: 0, min_amount: 0, max_amount: 0, fee_pct: 0, amount_presets: null,
    login_label: '', login_hint: '', login_prefix: '',
    denom_currency: 'USD',
    denominations: [
      { id: 'd10', value: 10, price: 990 },
      { id: 'd25', value: 25, price: 2390 },
      { id: 'd50', value: 50, price: 4690 },
    ],
  },
  {
    id: 'mock-svc-netflix', kind: 'subscription', name: 'Netflix', slug: 'netflix',
    description: 'Подписка на Netflix', icon_url: '/assets/mock/netflix.svg',
    featured: false, sort_order: 5, disable_purchase: false,
    issue_currency: 'RUB', amount_currency: '', amount_unit: '', amount_label: '',
    unit_price: 0, min_amount: 0, max_amount: 0, fee_pct: 0, amount_presets: null,
    login_label: 'Email аккаунта Netflix', login_hint: '', login_prefix: '',
    denom_currency: 'RUB',
    denominations: [
      { id: 'basic', label: 'Basic, 1 месяц', value: 1, price: 990 },
      { id: 'standard', label: 'Standard, 1 месяц', value: 1, price: 1490 },
      { id: 'premium', label: 'Premium, 1 месяц', value: 1, price: 1990 },
    ],
  },
  {
    id: 'mock-svc-spotify', kind: 'subscription', name: 'Spotify Premium', slug: 'spotify-premium',
    description: 'Музыка без рекламы и офлайн', icon_url: '/assets/mock/spotify.svg',
    featured: false, sort_order: 6, disable_purchase: false,
    issue_currency: 'RUB', amount_currency: '', amount_unit: '', amount_label: '',
    unit_price: 0, min_amount: 0, max_amount: 0, fee_pct: 0, amount_presets: null,
    login_label: 'Email аккаунта Spotify', login_hint: '', login_prefix: '',
    denom_currency: 'RUB',
    denominations: [
      { id: 's1', label: '1 месяц', value: 1, price: 590 },
      { id: 's3', label: '3 месяца', value: 3, price: 1590 },
      { id: 's12', label: '12 месяцев', value: 12, price: 5490 },
    ],
  },
  {
    id: 'mock-svc-psn', kind: 'gift_card', name: 'PlayStation Store', slug: 'playstation-store',
    description: 'Подарочная карта PlayStation Store', icon_url: '/assets/mock/psn.svg',
    featured: false, sort_order: 7, disable_purchase: false,
    issue_currency: 'RUB', amount_currency: '', amount_unit: '', amount_label: '',
    unit_price: 0, min_amount: 0, max_amount: 0, fee_pct: 0, amount_presets: null,
    login_label: '', login_hint: '', login_prefix: '',
    denom_currency: 'USD',
    denominations: [
      { id: 'ps10', value: 10, price: 1090 },
      { id: 'ps25', value: 25, price: 2590 },
      { id: 'ps50', value: 50, price: 4990 },
    ],
  },
];

const MOCK_REFERRAL_INFO = {
  code: 'MOCKREF',
  link: 'https://hochuplachu.com/r/MOCKREF',
  tg_link: 'https://t.me/hochuplachuBot?start=MOCKREF',
  stats: { invited: 3, paid_cards: 2, total_payout: 400, currency: 'RUB' },
  reward: { amount: 200, currency: 'RUB' },
  referee_bonus: { amount: 100, currency: 'RUB' },
  bonus_available: 0,
};

const MOCK_REFERRAL_PAYOUTS = {
  payouts: [
    {
      id: 'mock-payout-1', created_at: '2026-08-20T10:00:00Z', paid_at: '2026-08-21T10:00:00Z',
      amount: 200, currency: 'RUB', status: 'paid' as const, partner_override: false,
    },
    {
      id: 'mock-payout-2', created_at: '2026-08-28T10:00:00Z',
      amount: 200, currency: 'RUB', status: 'pending' as const, partner_override: false,
    },
  ],
  pending: [{ currency: 'RUB', amount: 200, count: 1 }],
};

const MOCK_REFERRAL_WITHDRAWALS = { items: [] };

const MOCK_REFERRAL_CONFIG = { referrer_reward: 200, referee_bonus: 100, currency: 'RUB' };

// Карты — отдельная от catalog/sections ручка (та управляет только видимостью
// разделов на главной, а сам список карточек для покупки едет отдельно).
// gradient принимает пресеты blue/dark/gold (см. комментарий в CardProduct)
// либо произвольный CSS-фон — тут беру пресеты, чтобы визуально сразу было
// видно разницу между тремя продуктами без реальных картинок карт.
const MOCK_CARD_PRODUCTS = [
  {
    id: 'mock-card-travel',
    name: 'Карта для путешествий',
    description: 'Платите картой в поездках без ограничений — работает там, где обычные карты блокируют.',
    deposit_fee_pct: 3,
    issue_price: 990, issue_currency: 'RUB',
    annual_service_fee: 0,
    validity_years: 3,
    card_currency: 'USD',
    providers: [{ provider: 'buvei', bin_id: 'mock-bin-travel', country: 'HK', label: 'Travel BIN' }],
    perks: [
      ['✈️', 'Работает в 190+ странах'],
      ['🏨', 'Оплата отелей и авиабилетов без комиссии банка'],
      ['🔄', 'Мгновенное пополнение'],
    ],
    lists: [['Booking.com', 'Airbnb', 'Skyscanner', 'Aviasales']],
    forbidden: null,
    image_url: 'assets/mock/card-travel.png', gradient: 'gold',
    bg_image_url: '', bg_gradient: 'rgba(255, 245, 222, 1)',
    heading_color: 'rgba(0, 0, 0, 1)', body_color: 'rgba(0, 0, 0, 1)', cta_color: 'rgba(255, 186, 38, 1)',
    tier1_attrs: ['visa'], tier2_attrs: ['booking', 'airbnb'],
    sort_order: 1,
    disable_purchase: false, disable_topup: false,
    min_topup_amount: 500, monthly_purchase_limit: 0,
    tx_fee_fixed: 0, tx_fee_pct: 0.02,
    refund_fee_fixed: 0, refund_fee_pct: 0,
  },
  {
    id: 'mock-card-subs',
    name: 'Карта для подписок',
    description: 'Оплачивайте зарубежные подписки — Netflix, Spotify, ChatGPT — без танцев с бубном.',
    deposit_fee_pct: 3,
    issue_price: 490, issue_currency: 'RUB',
    annual_service_fee: 0,
    validity_years: 3,
    card_currency: 'USD',
    providers: [{ provider: 'buvei', bin_id: 'mock-bin-subs', country: 'SG', label: 'Subscriptions BIN' }],
    perks: [
      ['🔁', 'Держит регулярные платежи без блокировок'],
      ['💳', 'Минимальный порог пополнения'],
      ['🌍', 'Принимается везде, где нужен зарубежный биллинг'],
    ],
    lists: [['Netflix', 'Spotify', 'ChatGPT Plus', 'YouTube Premium']],
    forbidden: null,
    image_url: 'assets/mock/card-subs.png', gradient: 'dark',
    bg_image_url: '', bg_gradient: 'rgba(22, 22, 22, 1)',
    heading_color: '#ffffff', body_color: '#ffffff', cta_color: 'rgba(255, 186, 38, 1)',
    tier1_attrs: ['mastercard'], tier2_attrs: ['netflix', 'spotify'],
    sort_order: 2,
    disable_purchase: false, disable_topup: false,
    min_topup_amount: 300, monthly_purchase_limit: 0,
    tx_fee_fixed: 0, tx_fee_pct: 0.02,
    refund_fee_fixed: 0, refund_fee_pct: 0,
  },
  {
    id: 'mock-card-premium',
    name: 'Карта Premium',
    description: 'Повышенные лимиты, приоритетная поддержка и нулевая комиссия на пополнение.',
    deposit_fee_pct: 0,
    issue_price: 2990, issue_currency: 'RUB',
    annual_service_fee: 990,
    validity_years: 5,
    card_currency: 'USD',
    providers: [{ provider: 'buvei', bin_id: 'mock-bin-premium', country: 'GB', label: 'Premium BIN' }],
    perks: [
      ['👑', 'Без комиссии на пополнение'],
      ['📈', 'Повышенный месячный лимит покупок'],
      ['🎧', 'Приоритетная поддержка 24/7'],
    ],
    lists: [['Любые зарубежные сервисы', 'Премиум-поддержка']],
    forbidden: null,
    image_url: 'assets/mock/card-premium.png', gradient: 'dark',
    bg_image_url: '', bg_gradient: 'rgba(54, 45, 39, 1)',
    heading_color: 'rgba(255, 255, 255, 1)', body_color: 'rgba(255, 255, 255, 1)', cta_color: 'rgba(255, 186, 38, 1)',
    tier1_attrs: ['visa'], tier2_attrs: [],
    sort_order: 0,
    disable_purchase: false, disable_topup: false,
    min_topup_amount: 0, monthly_purchase_limit: 500000,
    tx_fee_fixed: 0, tx_fee_pct: 0,
    refund_fee_fixed: 0, refund_fee_pct: 0,
  },
];

export const mockCatalogInterceptor: HttpInterceptorFn = (req, next) => {
  if (!mockEnabled() || req.method !== 'GET') return next(req);

  const { pathname } = new URL(req.url, 'http://mock.local');

  if (pathname.endsWith('/auth/me')) {
    return of(new HttpResponse({ status: 200, body: envelope({ user: MOCK_USER }) }));
  }

  if (pathname.endsWith('/catalog/sections')) {
    return of(
      new HttpResponse({
        status: 200,
        body: envelope({ sections: { cards: 'available', esim: 'available', services: 'available' } }),
      }),
    );
  }

  if (pathname.endsWith('/esim/products')) {
    return of(new HttpResponse({ status: 200, body: envelope({ products: MOCK_ESIM_PRODUCTS }) }));
  }

  if (pathname.endsWith('/esim/directions')) {
    return of(new HttpResponse({ status: 200, body: envelope(MOCK_ESIM_DIRECTIONS) }));
  }

  if (pathname.endsWith('/esim/my')) {
    return of(new HttpResponse({ status: 200, body: envelope({ esims: [] }) }));
  }

  // GET /services/products/:slug — карточка ОДНОГО сервиса (не список).
  // Раньше такого маршрута не было вообще: любой productBySlug() (hero-блок
  // Steam на главной/сервисах, страница деталей /services/:slug) падал —
  // мок обрабатывал только точный путь /services/products без хвоста,
  // а .../products/steam под endsWith('/services/products') не попадает.
  // Из-за этого страница деталей показывала «Сервис не найден» даже для
  // существующих слагов вроде steam.
  const svcDetailMatch = pathname.match(/\/services\/products\/([^/]+)$/);
  if (svcDetailMatch) {
    const slug = decodeURIComponent(svcDetailMatch[1]);
    const product = MOCK_SERVICE_PRODUCTS.find((p) => p.slug === slug);
    if (product) {
      return of(new HttpResponse({ status: 200, body: envelope({ product }) }));
    }
    return of(new HttpResponse({ status: 404, body: envelope({ error: 'not_found' }) }));
  }

  if (pathname.endsWith('/services/products')) {
    return of(
      new HttpResponse({
        status: 200,
        body: envelope({ products: MOCK_SERVICE_PRODUCTS, total: MOCK_SERVICE_PRODUCTS.length, has_more: false }),
      }),
    );
  }

  if (pathname.endsWith('/referral/info')) {
    return of(new HttpResponse({ status: 200, body: envelope(MOCK_REFERRAL_INFO) }));
  }

  if (pathname.endsWith('/referral/payouts')) {
    return of(new HttpResponse({ status: 200, body: envelope(MOCK_REFERRAL_PAYOUTS) }));
  }

  if (pathname.endsWith('/referral/withdrawals')) {
    return of(new HttpResponse({ status: 200, body: envelope(MOCK_REFERRAL_WITHDRAWALS) }));
  }

  if (pathname.endsWith('/referral/config')) {
    return of(new HttpResponse({ status: 200, body: envelope(MOCK_REFERRAL_CONFIG) }));
  }

  // GET /cards/products/:id — карточка ОДНОГО продукта (не список). Раньше
  // такого маршрута не было вообще: CardsApi.getProduct(id) (дёргается на
  // ProductDetailPage и на CheckoutPage) молча падал — мок реагировал
  // только на точный путь /cards/products без хвоста. На ProductDetailPage
  // это было незаметно (там product() падает обратно на список), а на
  // CheckoutPage фолбэка нет — оттого и белый экран на /cards/:id/checkout.
  const cardDetailMatch = pathname.match(/\/cards\/products\/([^/]+)$/);
  if (cardDetailMatch) {
    const id = decodeURIComponent(cardDetailMatch[1]);
    const product = MOCK_CARD_PRODUCTS.find((p) => p.id === id);
    // CardsApi.getProduct() отдаёт CardProduct БЕЗ обёртки {product:...}
    // (в отличие от ServicesApi.productBySlug выше) — product-detail.page.ts
    // обращается к полям результата напрямую (p.id, не p.product.id).
    if (product) {
      return of(new HttpResponse({ status: 200, body: envelope(product) }));
    }
    return of(new HttpResponse({ status: 404, body: envelope({ error: 'not_found' }) }));
  }

  if (pathname.endsWith('/cards/products')) {
    return of(new HttpResponse({ status: 200, body: envelope({ products: MOCK_CARD_PRODUCTS }) }));
  }

  // Точное совпадение по хвосту пути, а не просто includes: иначе задело бы
  // и /cards/products (каталог, отдельная ветка выше), и /cards/:id
  // (конкретную выпущенную карту). endsWith('/cards') ни на что из этого
  // не среагирует — их пути заканчиваются иначе.
  if (pathname.endsWith('/cards')) {
    return of(new HttpResponse({ status: 200, body: envelope({ cards: [] }) }));
  }

  if (pathname.endsWith('/payment/info')) {
    return of(
      new HttpResponse({
        status: 200,
        body: envelope({ receive_currency: 'RUB', verification_mode: 'simple' }),
      }),
    );
  }

  return next(req);
};