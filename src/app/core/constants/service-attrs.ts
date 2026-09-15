// Список доступных ключей сервис-иконок, общий для админки и страницы
// продукта. Файл иконки кладётся в `public/assets/services/{key}.svg`.
// Backend хранит выбранный набор в CardProduct.tier1_attrs / tier2_attrs.

export const SERVICE_ATTR_KEYS = [
  'googlepay',
  'applepay',
  'appstore',
  'netflix',
  'chatgpt',
  'nanobanana',
  'gemini',
  'midjourney',
  'uber',
  'bolt',
  'grab',
  'airbnb',
  'booking',
  'trip',
  'miro',
  'amazon',
  'zoom',
] as const;

export type ServiceAttr = (typeof SERVICE_ATTR_KEYS)[number];

/** Человекочитаемое имя для подписи под иконкой и для select-чекбоксов. */
export const SERVICE_ATTR_LABELS: Record<ServiceAttr, string> = {
  googlepay: 'Google Pay',
  applepay: 'Apple Pay',
  appstore: 'App Store',
  netflix: 'Netflix',
  chatgpt: 'ChatGPT',
  nanobanana: 'Nano Banana',
  gemini: 'Gemini',
  midjourney: 'Midjourney',
  uber: 'Uber',
  bolt: 'Bolt',
  grab: 'Grab',
  airbnb: 'Airbnb',
  booking: 'Booking',
  trip: 'Trip.com',
  miro: 'Miro',
  amazon: 'Amazon',
  zoom: 'Zoom',
};

/** URL иконки в assets для рендеринга в шаблонах. */
export function serviceAttrIcon(key: string): string {
  return `/assets/services/${key}.svg`;
}

/** Возвращает только валидные ключи из произвольного массива (для безопасного
 *  рендера, если в БД оказался устаревший/незнакомый ключ). */
export function filterServiceAttrs(items: readonly string[] | null | undefined): ServiceAttr[] {
  if (!items) return [];
  const allowed = new Set<string>(SERVICE_ATTR_KEYS);
  return items.filter((k): k is ServiceAttr => allowed.has(k));
}
