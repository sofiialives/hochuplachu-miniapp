import { HttpInterceptorFn, HttpResponse } from '@angular/common/http';
import { of } from 'rxjs';

// ЗАЧЕМ ЭТОТ ФАЙЛ:
// Бэкенд для бренда «Хочу Плачу!» сейчас отдаёт coming_soon для eSIM и
// Сервисов (нет активных провайдеров/привязки в админке — см. разбор в чате).
// Чтобы не гонять доступы у бэкенд-команды ради вёрстки/редизайна, здесь
// лежат моки конкретно этих ручек.
//
// Мок включён ВСЕГДА, безусловно — этот деплой отдельный, специально
// для команды, чтобы у всех сразу были одни и те же мок-данные без
// ручных действий в консоли браузера (никакого localStorage-флага и
// dev/production-проверок больше нет). Если когда-нибудь этот же код
// понадобится и на РЕАЛЬНОМ проде для настоящих пользователей — тогда
// нужно будет вернуть переключатель или просто убрать
// mockCatalogInterceptor из withInterceptors([...]) в app.config.ts (один
// функциональный интерцептор, больше нигде не завязан) для того деплоя.

const TOKEN_KEY = 'hp.token';

function mockEnabled(): boolean {
  return true;
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

// email_linked: true — иначе EmailLinkDialog в app-shell.ts всплывает
// автоматически поверх ЛЮБОЙ страницы, как только в /cards появляется хотя
// бы одна карта (needsEmailLink = cards.length > 0 && !email_linked) — а с
// добавлением мок-выпущенной карты (MOCK_USER_CARDS) это условие всегда
// истинно. Раньше здесь было false — специально, чтобы в профиле была
// видна кнопка «Войти по email» (needsEmailLogin() в profile.page.ts) — но
// это конфликтует с показом выпущенной карты. Если понадобится снова
// посмотреть кнопку «Войти по email» в профиле — верните false здесь И
// уберите/закомментируйте MOCK_USER_CARDS ниже (или очистите её до []),
// иначе модалка будет всплывать сразу при заходе в приложение.
const MOCK_USER = {
  id: 'mock-user-1',
  telegram_id: 123456789,
  email: 'test@hochuplachu.mock',
  email_linked: true,
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

// MOCK_ESIM_PRODUCTS — по несколько тарифов на КАЖДОЕ направление из
// MOCK_ESIM_DIRECTIONS (страны + регион 'asia'), иначе клик на направление,
// для которого тарифов не было (AE/US/GB/DE/FR/IT/ES/JP/CN, регион 'asia'),
// показывал бы «Для этого направления пока нет тарифов» — интерцептор ниже
// фильтрует по ?direction= (country_code либо region_code), так что пустой
// список выглядел бы как настоящий баг витрины, а не как недостающий мок.
const MOCK_ESIM_PRODUCTS = [
  {
    id: 'mock-esim-tr-7d', name: 'Турция, 7 дней', description: '3 ГБ, локальный номер не входит',
    country_code: 'TR', country_name: 'Турция', days: 7, data_mb: 3000,
    issue_price: 590, issue_currency: 'RUB', disable_purchase: false, sort_order: 1,
  },
  {
    id: 'mock-esim-tr-30d', name: 'Турция, 30 дней', description: 'Безлимитный интернет',
    country_code: 'TR', country_name: 'Турция', days: 30, data_mb: 0,
    issue_price: 1490, issue_currency: 'RUB', disable_purchase: false, sort_order: 2,
  },
  {
    id: 'mock-esim-eu-14d', name: 'Европа, 14 дней', description: 'Покрытие 30+ стран, 5 ГБ',
    country_code: '', country_name: '', days: 14, data_mb: 5000,
    issue_price: 1290, issue_currency: 'RUB', disable_purchase: false, sort_order: 3,
    region_code: 'europe', region_name: 'Европа', locations: ['DE', 'FR', 'IT', 'ES', 'PT'],
  },
  {
    id: 'mock-esim-th-10d', name: 'Таиланд, 10 дней', description: 'Безлимитный интернет',
    country_code: 'TH', country_name: 'Таиланд', days: 10, data_mb: 0,
    issue_price: 990, issue_currency: 'RUB', disable_purchase: false, sort_order: 4,
  },
  {
    id: 'mock-esim-ae-7d', name: 'ОАЭ, 7 дней', description: '5 ГБ, локальный номер не входит',
    country_code: 'AE', country_name: 'ОАЭ', days: 7, data_mb: 5000,
    issue_price: 790, issue_currency: 'RUB', disable_purchase: false, sort_order: 5,
  },
  {
    id: 'mock-esim-us-7d', name: 'США, 7 дней', description: '5 ГБ, локальный номер не входит',
    country_code: 'US', country_name: 'США', days: 7, data_mb: 5000,
    issue_price: 1490, issue_currency: 'RUB', disable_purchase: false, sort_order: 6,
  },
  {
    id: 'mock-esim-us-30d', name: 'США, 30 дней', description: 'Безлимитный интернет',
    country_code: 'US', country_name: 'США', days: 30, data_mb: 0,
    issue_price: 2990, issue_currency: 'RUB', disable_purchase: false, sort_order: 7,
  },
  {
    id: 'mock-esim-gb-7d', name: 'Великобритания, 7 дней', description: '5 ГБ',
    country_code: 'GB', country_name: 'Великобритания', days: 7, data_mb: 5000,
    issue_price: 1290, issue_currency: 'RUB', disable_purchase: false, sort_order: 8,
  },
  {
    id: 'mock-esim-de-7d', name: 'Германия, 7 дней', description: '5 ГБ',
    country_code: 'DE', country_name: 'Германия', days: 7, data_mb: 5000,
    issue_price: 990, issue_currency: 'RUB', disable_purchase: false, sort_order: 9,
  },
  {
    id: 'mock-esim-fr-7d', name: 'Франция, 7 дней', description: '5 ГБ',
    country_code: 'FR', country_name: 'Франция', days: 7, data_mb: 5000,
    issue_price: 990, issue_currency: 'RUB', disable_purchase: false, sort_order: 10,
  },
  {
    id: 'mock-esim-it-7d', name: 'Италия, 7 дней', description: '3 ГБ',
    country_code: 'IT', country_name: 'Италия', days: 7, data_mb: 3000,
    issue_price: 890, issue_currency: 'RUB', disable_purchase: false, sort_order: 11,
  },
  {
    id: 'mock-esim-es-7d', name: 'Испания, 7 дней', description: '3 ГБ',
    country_code: 'ES', country_name: 'Испания', days: 7, data_mb: 3000,
    issue_price: 890, issue_currency: 'RUB', disable_purchase: false, sort_order: 12,
  },
  {
    id: 'mock-esim-jp-10d', name: 'Япония, 10 дней', description: 'Безлимитный интернет',
    country_code: 'JP', country_name: 'Япония', days: 10, data_mb: 0,
    issue_price: 1690, issue_currency: 'RUB', disable_purchase: false, sort_order: 13,
  },
  {
    id: 'mock-esim-cn-10d', name: 'Китай, 10 дней', description: '5 ГБ, с обходом блокировок',
    country_code: 'CN', country_name: 'Китай', days: 10, data_mb: 5000,
    issue_price: 1150, issue_currency: 'RUB', disable_purchase: false, sort_order: 14,
  },
  {
    id: 'mock-esim-asia-14d', name: 'Азия, 14 дней', description: 'Покрытие 18 стран, 5 ГБ',
    country_code: '', country_name: '', days: 14, data_mb: 5000,
    issue_price: 1150, issue_currency: 'RUB', disable_purchase: false, sort_order: 15,
    region_code: 'asia', region_name: 'Азия', locations: ['TH', 'JP', 'CN', 'SG', 'MY'],
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

// MOCK_PROFILE_ORDERS — единая история заказов «Мои заказы» (профиль).
// Покрывает все типы из ProfileOrderItem.type, чтобы на странице сразу было
// видно и разные статусы (оплачен/ожидает/ошибка/возврат), и разные
// заголовки/иконки-статусы (titleOf/toneOf в orders.page.ts). Привязана к
// MOCK_USER_CARDS[0]/MOCK_CARD_PRODUCTS/MOCK_SERVICE_PRODUCTS — открытие
// заказа ведёт на реальные (мок) сущности, а не в никуда.
const MOCK_PROFILE_ORDERS = [
  {
    type: 'card_order', id: 'mock-order-card-1', created_at: '2026-09-18T09:20:00Z',
    status: 'issued', card_product_id: 'mock-card-premium',
    amount_payment: 2999, payment_currency: 'RUB_SBP',
  },
  {
    type: 'topup', id: 'mock-order-topup-1', created_at: '2026-09-19T14:05:00Z',
    status: 'topped_up', card_id: 'mock-user-card-1',
    amount: 200, currency: 'USD', amount_payment: 20800, payment_currency: 'RUB_SBP',
  },
  {
    type: 'topup', id: 'mock-order-topup-2', created_at: '2026-09-20T11:40:00Z',
    status: 'pending_payment', card_id: 'mock-user-card-1',
    amount: 50, currency: 'USD', amount_payment: 5200, payment_currency: 'RUB_SBP',
  },
  {
    type: 'esim_order', id: 'mock-order-esim-1', created_at: '2026-09-15T18:00:00Z',
    status: 'issued', esim_product_id: 'mock-esim-tr-7d', product_name: 'Турция, 7 дней',
    amount_payment: 590, payment_currency: 'RUB_SBP',
  },
  {
    type: 'service_order', id: 'mock-order-svc-1', created_at: '2026-09-17T08:30:00Z',
    status: 'completed', service_product_id: 'mock-svc-tg-stars', product_name: 'Telegram Stars',
    kind: 'account_topup', codes_issued: false,
    amount: 100, currency: 'XTR', amount_payment: 180, payment_currency: 'RUB_SBP',
  },
  {
    type: 'service_order', id: 'mock-order-svc-2', created_at: '2026-09-12T20:15:00Z',
    status: 'failed', service_product_id: 'mock-svc-netflix', product_name: 'Netflix',
    kind: 'gift_card', codes_issued: false,
    amount_payment: 1490, payment_currency: 'RUB_SBP',
  },
  {
    type: 'renewal', id: 'mock-order-renewal-1', created_at: '2026-09-05T10:00:00Z',
    status: 'refunded', card_id: 'mock-user-card-1',
    amount_payment: 990, payment_currency: 'RUB_SBP', discount_amount: 100,
  },
];

const MOCK_REFERRAL_CONFIG = { referrer_reward: 200, referee_bonus: 100, currency: 'RUB' };

// Курсы способов оплаты для /payment/methods (scope=issue|topup,
// product_type=card|esim|service) — ИМЕННО эта ручка кормит
// CurrencyService.issueMethods(), от которого зависит <app-rate-quote>
// («Курс пополнения» на карточке продукта/каталоге). Раньше этой ручки в
// моке не было вообще — запрос улетал в реальный (недоступный в этом
// деплое) бэкенд, падал, issueMethods() так и оставался пустым, и
// app-rate-quote просто не рендерился (`@if (quotes().length > 0)`) —
// отсюда была видна только статичная подпись «Курс пополнения», а сам
// курс — никогда. rate здесь — «сколько получатель получает за 1 юнит
// receive-валюты» (см. previewRate/RateQuoteComponent): у RUB_SBP это
// ~1/курс₽, у USDT_TRX — курс, близкий к 1.
const MOCK_PAYMENT_METHODS = [
  {
    id: 'RUB_SBP', currency_short_name: 'RUB', short_name: 'RUB', name: 'СБП',
    symbol: '₽', type: 'fiat', rate: 0.0104, provider: 'kassaai', available: true,
  },
  {
    id: 'USDT_TRX', currency_short_name: 'USDT', short_name: 'USDT', name: 'USDT (TRC20)',
    symbol: '$', type: 'crypto', rate: 0.99, provider: 'cc', available: true,
  },
];

// Карты — отдельная от catalog/sections ручка (та управляет только видимостью
// разделов на главной, а сам список карточек для покупки едет отдельно).
// gradient принимает пресеты blue/dark/gold (см. комментарий в CardProduct)
// либо произвольный CSS-фон — тут беру пресеты, чтобы визуально сразу было
// видно разницу между тремя продуктами без реальных картинок карт.
const MOCK_CARD_PRODUCTS = [
  {
    id: 'mock-card-travel',
    name: 'Карта для путешествий',
    description: 'С возможностью привзяать Apple Pay и Google Pay.',
    deposit_fee_pct: 3,
    issue_price: 2999, issue_currency: 'RUB',
    annual_service_fee: 0,
    validity_years: 2,
    card_currency: 'USD',
    providers: [{ provider: 'buvei', bin_id: 'mock-bin-travel', country: 'HK', label: 'Travel BIN' }],
    perks: [
      ['Плати картой оффлайн', 'Поддержка Apple Pay и Google Pay'],
      ['ОПЛАТА СЕРВИСОВ В APP STORE И ICLOUD', 'Поддержка Apple Pay и Google Pay'],
      ['ОПЛАТА СЕРВИСОВ В APP STORE И ICLOUD', 'Поддержка Apple Pay и Google Pay'],
    ],
    lists: [['Booking.com', 'Airbnb', 'Skyscanner', 'Aviasales']],
    forbidden: null,
    image_url: '', gradient: 'gold',
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
    description: 'С возможностью привзяать Apple Pay и Google Pay',
    deposit_fee_pct: 3,
    issue_price: "2999", issue_currency: 'RUB',
    annual_service_fee: 0,
    validity_years: 2,
    card_currency: 'USD',
    providers: [{ provider: 'buvei', bin_id: 'mock-bin-subs', country: 'SG', label: 'Subscriptions BIN' }],
    perks: [
      ['Плати картой оффлайн', 'Поддержка Apple Pay и Google Pay'],
      ['ОПЛАТА СЕРВИСОВ В APP STORE И ICLOUD', 'Поддержка Apple Pay и Google Pay'],
      ['ОПЛАТА СЕРВИСОВ В APP STORE И ICLOUD', 'Поддержка Apple Pay и Google Pay'],
    ],
    lists: [['Netflix', 'Spotify', 'ChatGPT Plus', 'YouTube Premium']],
    forbidden: null,
    image_url: '', gradient: 'dark',
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
    issue_price: 2999, issue_currency: 'RUB',
    annual_service_fee: 990,
    validity_years: 5,
    card_currency: 'USD',
    providers: [{ provider: 'buvei', bin_id: 'mock-bin-premium', country: 'GB', label: 'Premium BIN' }],
    perks: [
      ['Плати картой оффлайн', 'Поддержка Apple Pay и Google Pay'],
      ['ОПЛАТА СЕРВИСОВ В APP STORE И ICLOUD', 'Поддержка Apple Pay и Google Pay'],
      ['ОПЛАТА СЕРВИСОВ В APP STORE И ICLOUD', 'Поддержка Apple Pay и Google Pay'],
    ],
    lists: [['Любые зарубежные сервисы', 'Премиум-поддержка']],
    forbidden: null,
    image_url: '', gradient: 'dark',
    bg_image_url: '', bg_gradient: 'rgba(54, 45, 39, 1)',
    heading_color: 'rgba(255, 255, 255, 1)', body_color: 'rgba(255, 255, 255, 1)', cta_color: 'rgba(255, 186, 38, 1)',
    // Раньше tier2_attrs был пустым ([]) — под 6 плашек (как на макете
    // Premium-карты: Booking, Airbnb, Netflix, ChatGPT, Uber, Amazon) моков
    // не было и посмотреть раскладку с 6 иконками было нельзя.
    tier1_attrs: ['visa'], tier2_attrs: ['booking', 'airbnb'],
    sort_order: 0,
    disable_purchase: false, disable_topup: false,
    min_topup_amount: 0, monthly_purchase_limit: 500000,
    tx_fee_fixed: 0, tx_fee_pct: 0,
    refund_fee_fixed: 0, refund_fee_pct: 0,
  },
];

// Уже выпущенная карта пользователя — чтобы посмотреть, как выглядит
// состояние "карта уже выпущена" (главная /cards, детали карты, пополнение
// и т.д.), а не только каталог для выпуска новой. Привязана к продукту
// mock-card-premium — можно сменить card_product_id на любой другой id из
// MOCK_CARD_PRODUCTS, чтобы посмотреть с другим дизайном/цветом карты.
const MOCK_USER_CARDS = [
  {
    id: 'mock-user-card-1',
    card_product_id: 'mock-card-premium',
    last4: '4242',
    expiry_month: 9,
    expiry_year: 2030,
    balance: 12480,
    status: 'active',
    service_expires_at: '2027-09-20T00:00:00Z',
    issuer_country: 'GB',
  },
];

export const mockCatalogInterceptor: HttpInterceptorFn = (req, next) => {
  if (!mockEnabled() || req.method !== 'GET') return next(req);

  const { pathname, searchParams } = new URL(req.url, 'http://mock.local');

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

  // GET /esim/products/:id — один тариф (не список). Без этой ветки
  // esim-checkout.page.ts (EsimApi.product(id)) улетал в реальный бэкенд,
  // 404-ился и показывал «Тариф не найден или временно недоступен» на
  // ЛЮБОМ переходе к оплате тарифа — общий список ниже (endsWith
  // '/esim/products') на этот путь не реагирует, чекаут был мёртвой веткой.
  const esimProductMatch = pathname.match(/\/esim\/products\/([^/]+)$/);
  if (esimProductMatch) {
    const id = decodeURIComponent(esimProductMatch[1]);
    const product = MOCK_ESIM_PRODUCTS.find((p) => p.id === id);
    if (product) {
      return of(new HttpResponse({ status: 200, body: envelope({ product }) }));
    }
    return of(new HttpResponse({ status: 404, body: envelope({ error: 'not_found' }) }));
  }

  if (pathname.endsWith('/esim/products')) {
    // direction — ISO-2 страны либо код региона (см. EsimApi.products);
    // без параметра (общий каталог) отдаём всё целиком.
    const direction = searchParams.get('direction');
    const products = direction
      ? MOCK_ESIM_PRODUCTS.filter((p) => p.country_code === direction || p.region_code === direction)
      : MOCK_ESIM_PRODUCTS;
    return of(new HttpResponse({ status: 200, body: envelope({ products }) }));
  }

  if (pathname.endsWith('/esim/directions')) {
    return of(new HttpResponse({ status: 200, body: envelope(MOCK_ESIM_DIRECTIONS) }));
  }

  if (pathname.endsWith('/esim/my')) {
    return of(new HttpResponse({ status: 200, body: envelope({ esims: [] }) }));
  }

  // GET /payment/methods?scope=issue|topup&product_type=card|esim|service —
  // курсы способов оплаты. Отдаём один и тот же мок-набор независимо от
  // query-параметров: CurrencyService.issueMethods() кладёт сюда только
  // ответ scope=issue&product_type=card, но остальные страницы (topup,
  // checkout) читают эту же ручку под другим scope/product_type — им тоже
  // нужен непустой список, а не 404/сеть.
  if (pathname.endsWith('/payment/methods')) {
    return of(
      new HttpResponse({
        status: 200,
        body: envelope({ methods: MOCK_PAYMENT_METHODS, receive_currency: 'USD' }),
      }),
    );
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

  // GET /cards/:id — карточка ОДНОЙ уже выпущенной карты пользователя (не
  // каталог продуктов — та ветка выше уже отработала бы и вернулась). Нужен,
  // чтобы можно было открыть детали уже выпущенной мок-карты, а не только
  // увидеть её в списке на главной.
  const userCardMatch = pathname.match(/\/cards\/([^/]+)$/);
  if (userCardMatch && userCardMatch[1] !== 'products') {
    const id = decodeURIComponent(userCardMatch[1]);
    const card = MOCK_USER_CARDS.find((c) => c.id === id);
    if (card) {
      return of(new HttpResponse({ status: 200, body: envelope(card) }));
    }
    return of(new HttpResponse({ status: 404, body: envelope({ error: 'not_found' }) }));
  }

  // Точное совпадение по хвосту пути, а не просто includes: иначе задело бы
  // и /cards/products (каталог, отдельная ветка выше), и /cards/:id
  // (конкретную выпущенную карту, тоже отдельная ветка выше). endsWith('/cards')
  // ни на что из этого не среагирует — их пути заканчиваются иначе.
  // cards: MOCK_USER_CARDS — чтобы сразу видеть состояние "карта уже
  // выпущена" на главной, а не только пустой каталог для выпуска новой.
  if (pathname.endsWith('/cards')) {
    return of(new HttpResponse({ status: 200, body: envelope({ cards: MOCK_USER_CARDS }) }));
  }

  // GET /profile/orders?page=&page_size= — единая история заказов в
  // профиле (см. MOCK_PROFILE_ORDERS выше). Пагинация по page/page_size —
  // ProfileOrdersPage дозагружает страницами через «Показать ещё».
  if (pathname.endsWith('/profile/orders')) {
    const page = Number(searchParams.get('page') ?? 1) || 1;
    const pageSize = Number(searchParams.get('page_size') ?? 25) || 25;
    const start = (page - 1) * pageSize;
    const items = MOCK_PROFILE_ORDERS.slice(start, start + pageSize);
    return of(
      new HttpResponse({
        status: 200,
        body: envelope({ items, total: MOCK_PROFILE_ORDERS.length, page, page_size: pageSize }),
      }),
    );
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