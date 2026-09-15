import { PaymentCurrency, PaymentCurrencyLevel } from './currency.service';

// Порт getLevelForOutSum из coincat-frontend (ExchangeResponse): выбирает
// корректный уровень из reverse_levels для заданной to-amount. Если уровней нет,
// либо to-amount выходит за пределы, возвращает ближайший / fallback на flat rate.
export function levelForOutSum(currency: PaymentCurrency, toAmount: number): PaymentCurrencyLevel | null {
  const levels = currency.reverse_levels ?? [];
  if (!levels.length) {
    return currency.rate > 0
      ? { min_amount: 0, max_amount: Number.POSITIVE_INFINITY, rate: currency.rate, fee: 0 }
      : null;
  }
  if (toAmount <= 0) return bestRate(levels);
  const best = bestRate(levels);
  if (best && toAmount >= best.min_amount && toAmount <= best.max_amount) return best;
  for (const l of levels) {
    if (toAmount >= l.min_amount && toAmount <= l.max_amount) return l;
  }
  const mx = maxByMax(levels);
  const mn = minByMin(levels);
  if (mx && toAmount > mx.max_amount) return mx;
  if (mn && toAmount < mn.min_amount) return mn;
  return mn;
}

function bestRate(levels: PaymentCurrencyLevel[]): PaymentCurrencyLevel | null {
  if (!levels.length) return null;
  return levels.reduce((b, l) => (l.rate > b.rate ? l : b), levels[0]);
}

function minByMin(levels: PaymentCurrencyLevel[]): PaymentCurrencyLevel | null {
  if (!levels.length) return null;
  return levels.reduce((b, l) => (l.min_amount < b.min_amount ? l : b), levels[0]);
}

function maxByMax(levels: PaymentCurrencyLevel[]): PaymentCurrencyLevel | null {
  if (!levels.length) return null;
  return levels.reduce((b, l) => (l.max_amount > b.max_amount ? l : b), levels[0]);
}

// fromAmountForTo — сколько в `currency` надо заплатить, чтобы получить toAmount
// в receive-валюте, с учётом уровневого rate и комиссии.
export function fromAmountForTo(currency: PaymentCurrency, toAmount: number): number | null {
  const lvl = levelForOutSum(currency, toAmount);
  if (!lvl || lvl.rate <= 0) return null;
  return (toAmount + lvl.fee) / lvl.rate;
}

// previewRate — отображаемый курс «1 X ≈ Y USDT» для конкретной to-amount
// (равно lvl.rate; при отсутствии уровней — flat rate).
export function previewRate(currency: PaymentCurrency, toAmount: number): number {
  const lvl = levelForOutSum(currency, toAmount);
  return lvl?.rate ?? currency.rate;
}

export interface CurrencyLimits {
  // ok=true означает, что toAmount попадает хотя бы в один reverse_level
  // (или у валюты нет уровней — она флэт без ограничений).
  ok: boolean;
  // Глобальный диапазон валюты — объединение всех уровней.
  // Используется как подсказка в UI: «доступно X — Y {symbol}».
  minAmount: number;
  maxAmount: number;
  // hasLimits=false означает флэт-валюту без min/max — подсказку не показываем.
  hasLimits: boolean;
}

// limitsForCurrency — глобальный диапазон одной валюты + флаг попадания
// toAmount в любой её уровень. Поверх levelForOutSum, который выбирает
// ближайший уровень даже при выходе за пределы, — этот хелпер чётко
// сигнализирует «не пройдёт».
export function limitsForCurrency(currency: PaymentCurrency, toAmount: number): CurrencyLimits {
  const levels = currency.reverse_levels ?? [];
  if (levels.length === 0) {
    return { ok: true, minAmount: 0, maxAmount: Number.POSITIVE_INFINITY, hasLimits: false };
  }
  let min = Number.POSITIVE_INFINITY;
  let max = 0;
  let ok = false;
  for (const l of levels) {
    if (l.min_amount < min) min = l.min_amount;
    if (l.max_amount > max) max = l.max_amount;
    if (toAmount >= l.min_amount && toAmount <= l.max_amount) ok = true;
  }
  return { ok, minAmount: min, maxAmount: max, hasLimits: true };
}

// limitsForCurrencyFrom — то же, но для from-суммы (сколько юзер платит в самой
// валюте оплаты): диапазоны берутся из levels (from-сторона). Нужен при
// рублёвом прайсе (issue_currency=RUB): счёт по рублёвому направлению
// выставляется ровно на цену, т.е. сумма известна именно во from-валюте.
export function limitsForCurrencyFrom(currency: PaymentCurrency, fromAmount: number): CurrencyLimits {
  const levels = currency.levels ?? [];
  if (levels.length === 0) {
    return { ok: true, minAmount: 0, maxAmount: Number.POSITIVE_INFINITY, hasLimits: false };
  }
  let min = Number.POSITIVE_INFINITY;
  let max = 0;
  let ok = false;
  for (const l of levels) {
    if (l.min_amount < min) min = l.min_amount;
    if (l.max_amount > max) max = l.max_amount;
    if (fromAmount >= l.min_amount && fromAmount <= l.max_amount) ok = true;
  }
  return { ok, minAmount: min, maxAmount: max, hasLimits: true };
}

// anyCurrencyAccepts — найдётся ли способ оплаты, который примет эту сумму.
// Используется на topup, чтобы не пускать пользователя в picker, если ни одна
// валюта не подходит.
export function anyCurrencyAccepts(currencies: PaymentCurrency[], toAmount: number): boolean {
  if (toAmount <= 0) return false;
  return currencies.some((c) => limitsForCurrency(c, toAmount).ok);
}

// rangeAcrossCurrencies — объединение диапазонов всех валют. Хорошо подходит
// для общей подсказки «Сумма пополнения от X до Y». Если хотя бы одна валюта
// без уровней — возвращает {0, +∞}, потому что флэт-валюта примет любую сумму.
export function rangeAcrossCurrencies(currencies: PaymentCurrency[]): { minAmount: number; maxAmount: number; hasLimits: boolean } {
  let min = Number.POSITIVE_INFINITY;
  let max = 0;
  let hasLimits = false;
  for (const cur of currencies) {
    const levels = cur.reverse_levels ?? [];
    if (levels.length === 0) {
      return { minAmount: 0, maxAmount: Number.POSITIVE_INFINITY, hasLimits: false };
    }
    hasLimits = true;
    for (const l of levels) {
      if (l.min_amount < min) min = l.min_amount;
      if (l.max_amount > max) max = l.max_amount;
    }
  }
  if (!hasLimits) return { minAmount: 0, maxAmount: Number.POSITIVE_INFINITY, hasLimits: false };
  return { minAmount: min, maxAmount: max, hasLimits: true };
}
