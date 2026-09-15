import { formatAmount } from '../currency/currency-symbols';

// formatReferralAmount — единый форматер для сумм реф-программы.
// Правила:
//   - целое число форматируется без дробной части ("5"), нецелое — с двумя ("5.50")
//   - позиция символа валюты — общая с formatAmount: префикс без пробела для
//     USD («$5»), суффикс через пробел для остальных («5 ₽», «5 €»). USDT —
//     единственное исключение: отображаем долларом (исторически 1 USDT ≈ $1 —
//     у админа это «$5 другу», у пользователя — то же визуально).
//
// Используется во всех местах, где FE рендерит сумму бонуса/реварды: текст
// referral.dialog (условия), баннер «$10 вам, $5 другу», welcome-диалог,
// предпросмотр скидки на пополнении.
export function formatReferralAmount(amount: number, currency: string): string {
  const cur = (currency ?? '').toUpperCase();
  const value = formatNumber(amount);
  if (cur === 'USDT') return `$${value}`;
  return formatAmount(value, cur);
}

function formatNumber(n: number): string {
  if (!Number.isFinite(n)) return '0';
  if (Math.abs(n - Math.round(n)) < 1e-6) return String(Math.round(n));
  return n.toFixed(2);
}

// usdLikeCurrency — зеркало backend.bonusForUserInCurrency.usdLikeCurrency:
// USD ↔ USDT мы трактуем как одну валюту (1:1) при применении бонуса.
function usdLikeCurrency(c: string): boolean {
  const v = (c ?? '').trim().toUpperCase();
  return v === 'USD' || v === 'USDT';
}

// bonusApplicableTo — сколько бонуса применимо к карте, выпускаемой в валюте
// `cardCurrency`. Зеркало backend `OrderService.bonusForUserInCurrency`:
// прямое совпадение валют ИЛИ обе USD-like → bonus, иначе 0. Нужно FE чтобы
// нарисовать предпросмотр скидки до отправки заявки — backend применит ту же
// логику и вернёт финальную сумму.
export function bonusApplicableTo(bonus: number, bonusCurrency: string, cardCurrency: string): number {
  if (bonus <= 0) return 0;
  if (bonusCurrency && cardCurrency && bonusCurrency.toUpperCase() === cardCurrency.toUpperCase()) return bonus;
  if (usdLikeCurrency(bonusCurrency) && usdLikeCurrency(cardCurrency)) return bonus;
  return 0;
}
