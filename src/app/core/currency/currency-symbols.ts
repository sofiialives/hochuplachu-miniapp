// Зеркало coincat frontend currenciesSymbols.
export const CURRENCY_SYMBOLS: Record<string, string> = {
  RUB: '₽', USD: '$', EUR: '€', GBP: '£', UAH: '₴', KZT: '₸',
  BYN: 'Br', AMD: '֏', AZN: '₼', GEL: '₾', KGS: 'сом', TJS: 'SM',
  TMT: 'T', UZS: 'сум', MDL: 'L', TRY: '₺', CNY: '¥', INR: '₹',
  VND: '₫', THB: '฿', AED: 'د.إ', JPY: '¥', CHF: '₣', PLN: 'zł',
  HKD: 'HK$', SGD: 'S$',
  BTC: '₿', USDT: 'USDT', USDC: 'USDC', ETH: 'Ξ', LTC: 'Ł',
  BCH: 'BCH', XRP: 'XRP', BNB: 'BNB', DAI: 'DAI', DOT: 'DOT',
  TON: 'TON', TRX: 'TRX', SOL: 'SOL', MATIC: 'MATIC',
};

export function symbolFor(short: string | undefined | null): string {
  if (!short) return '';
  return CURRENCY_SYMBOLS[short.toUpperCase()] ?? short;
}

// PREFIX_SYMBOL_CURRENCIES — валюты, у которых по типографической конвенции
// символ ставится ПЕРЕД суммой и без пробела ($30, а не «30 $»). Зеркало
// backend utils.prefixSymbolCurrencies. Для остальных (₽, € и пр. в русском
// письме) символ идёт после суммы через пробел.
const PREFIX_SYMBOL_CURRENCIES = new Set(['USD']);

// isPrefixSymbolCurrency — нужен шаблонам, которые рисуют сумму и символ
// РАЗНЫМИ элементами (крупное число + мелкий символ рядом): им мало готовой
// строки formatAmount, надо знать, с какой стороны ставить символ.
export function isPrefixSymbolCurrency(currency: string | undefined | null): boolean {
  return PREFIX_SYMBOL_CURRENCIES.has((currency ?? '').toUpperCase());
}

// formatAmount — «сумма + валюта» с правильной позицией символа: для USD —
// «$30» (и «-$30» / «+$30» с сохранением ведущего знака), для остального —
// «30 ₽». value — уже отрендеренное значение суммы (число или строка),
// НЕ переформатируется. currency — короткий код валюты (USD, RUB, USDT...).
export function formatAmount(value: number | string | null | undefined, currency: string | undefined | null): string {
  const cur = (currency ?? '').toUpperCase();
  const s = value == null ? '' : String(value);
  if (PREFIX_SYMBOL_CURRENCIES.has(cur)) {
    const sym = CURRENCY_SYMBOLS[cur];
    const m = /^([+-])(.*)$/.exec(s); // вынести ведущий знак перед символом
    return m ? `${m[1]}${sym}${m[2]}` : `${sym}${s}`;
  }
  const sym = symbolFor(cur);
  return sym ? `${s} ${sym}` : s;
}

// Локализованные подписи типов перевода и брендов банков. Покрывает массовые
// случаи — для остального используется fallback "raw" имени.
const TYPE_LABELS: Record<string, string> = {
  CARD: 'Карта',
  SBP: 'СБП',
  WIRE: 'Банковский перевод',
  CASH: 'Наличные',
  TRX: 'Tron',
  ERC20: 'Ethereum (ERC-20)',
  BEP20: 'BNB Smart Chain (BEP-20)',
  POLYGON: 'Polygon',
  TON: 'TON',
  SOL: 'Solana',
  COINCAT: 'CoinCat',
  WISE: 'Wise',
  REVOLUT: 'Revolut',
  PAYPAL: 'PayPal',
  IZI: 'IZI Bank',
};

const BANK_LABELS: Record<string, string> = {
  SBER: 'Сбер',
  TINKOFF: 'Т-Банк (Тинькофф)',
  ALFA: 'Альфа-Банк',
  VTB: 'ВТБ',
  GAZPROM: 'Газпромбанк',
  RAIFFEISEN: 'Райффайзен',
  RAYF: 'Райффайзен',
  AVANGARD: 'Авангард',
  OZON: 'Ozon Банк',
  MTSBANK: 'МТС Банк',
  ROSSELKHOZ: 'Россельхозбанк',
  POCHTA: 'Почта Банк',
  YANDEX: 'Яндекс Pay',
  PRIVAT: 'ПриватБанк',
  MONO: 'Monobank',
  RFB: 'Райффайзен (UA)',
  USB: 'Universal Bank',
  ABANK: 'A-Bank',
  KASPI: 'Kaspi',
  FORTE: 'ForteBank',
  FREEDOM: 'Freedom Finance',
  EURASIAN: 'Евразийский банк',
  ALATAU: 'Bank Alatau',
  BEREKE: 'Bereke Bank',
  CENTERCREDIT: 'Bank CenterCredit',
};

// CURRENCY_NAMES_RU — словарь локализованных имён валют по `id`. Зеркалит
// `currencies_names` из coincat/frontend assets/i18n/exchange/ru.json — только
// для тех id, которые мы реально показываем. Если id в словаре — берём отсюда;
// иначе fallback на `name` из currencier; иначе — авто-derived из id.
const CURRENCY_NAMES_RU: Record<string, string> = {
  RUB_SBP: 'СБП',
  UAH_CARD: 'Карта (гривна)',
  USDT_TRX: 'USDT (сеть TRC20)',
  USDT_COINCAT: 'CoinCat USDT',
  BTC: 'Bitcoin',
  LTC: 'Litecoin',
  TON: 'TON',
};

// currencyLabel — формирует человекочитаемое название валюты по приоритету:
// 1) локализованный словарь CURRENCY_NAMES_RU;
// 2) `name` от currencier (если задан);
// 3) fallback: BANK_LABELS / TYPE_LABELS / suffix / base.
export function currencyLabel(id: string, name?: string): string {
  if (id && CURRENCY_NAMES_RU[id]) return CURRENCY_NAMES_RU[id];
  if (name && name.trim()) return name.trim();
  if (!id) return '';
  const [base, suffixRaw = ''] = id.split('_');
  const [type, brand] = suffixRaw.split('.');
  if (brand && BANK_LABELS[brand.toUpperCase()]) return BANK_LABELS[brand.toUpperCase()];
  if (type && TYPE_LABELS[type.toUpperCase()]) return TYPE_LABELS[type.toUpperCase()];
  if (suffixRaw) return suffixRaw;
  return base.toUpperCase();
}
