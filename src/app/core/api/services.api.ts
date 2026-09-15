import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { ApiService, SLOW_REQUEST_TIMEOUT_MS } from './api.service';
import { BillStatus, PaymentFields } from './orders.api';

/** Вид сервис-продукта — различается тем, что вводит покупатель и что получает:
 *  account_topup — логин + сумма/количество (Steam, Telegram Stars);
 *  gift_card — выбор номинала БЕЗ логина, на выходе код активации;
 *  subscription — логин + выбор ПЛАНА (Telegram Premium), кода нет. */
export type ServiceKind = 'account_topup' | 'gift_card' | 'subscription';

/** Виду нужен логин аккаунта (пополнение, подписка). */
export function serviceNeedsLogin(kind: ServiceKind | undefined): boolean {
  return kind === 'account_topup' || kind === 'subscription';
}

/** Покупатель выбирает позицию из списка: номинал гифткарты, план подписки. */
export function serviceHasDenominations(kind: ServiceKind | undefined): boolean {
  return kind === 'gift_card' || kind === 'subscription';
}

/** Номинал гифткарты (элемент denominations; providers-ext сюда не тянем). */
export interface ServiceDenomination {
  id: string;
  /** Имя номинала у поставщика («1 Year Adobe Acrobat AI Assistant»). Номиналом
   *  бывает не сумма, а сам товар — тогда `value` бессмысленно. Пусто —
   *  показываем `value` с валютой номиналов, как у обычных гифткарт. */
  label?: string;
  value: number;
  price: number;
  disabled?: boolean;
}

/** Страница каталога (GET /services/products): продукты + сколько всего. */
export interface ServiceProductsPage {
  products: ServiceProduct[];
  total: number;
  has_more: boolean;
}

/** Слаг сервиса, который витрина показывает отдельным блоком (решение
 *  оператора: пополнение Steam — главный сервис каталога). Продукта с таким
 *  слагом нет — блока просто не будет, остальная витрина не меняется. */
export const HERO_SERVICE_SLUG = 'steam';

/** Сервис-продукт (GET /services/products; только с резолвящимся провайдером). */
export interface ServiceProduct {
  id: string;
  kind: ServiceKind;
  name: string;
  slug: string;
  description: string;
  icon_url: string;
  /** Steam — большой блок на витрине. */
  featured: boolean;
  sort_order: number;
  disable_purchase: boolean;
  /** Валюта цен (RUB | USDT — режим как у карт). */
  issue_currency: string;
  // account_topup:
  /** Валюта зачисления (RUB для Steam) либо код единицы товара (XTR у звёзд). */
  amount_currency: string;
  /** Подпись ЕДИНИЦЫ зачисления («⭐»). Непусто = пополнение ШТУЧНОЕ:
   *  покупатель вводит количество (целое), а не сумму денег. */
  amount_unit: string;
  /** Подпись поля ввода («Количество звёзд»); пусто = подпись по умолчанию. */
  amount_label: string;
  /** Цена ОДНОЙ единицы зачисления в валюте прайса; >0 = цена считается
   *  умножением, а не комиссией (см. topupPayFor). */
  unit_price: number;
  /** Границы в единицах зачисления (у штучных — в штуках). */
  min_amount: number;
  max_amount: number;
  fee_pct: number;
  amount_presets: number[] | null;
  login_label: string;
  login_hint: string;
  /** Обязательная приставка логина («@» у ника Telegram, пусто у логина Steam):
   *  поле ввода подставляет её само и выбрасывает лишние вхождения. */
  login_prefix: string;
  // gift_card / subscription:
  denom_currency: string;
  /** Номиналы гифткарты либо планы подписки («12 месяцев»). */
  denominations: ServiceDenomination[] | null;
}

/** Сервис-заявка (EnrichServiceOrder). Статусы: pending_payment|pending_kyc|
 *  paid|processing|completed|failed|refunded|cancelled. Коды наружу не
 *  отдаются — только codes_issued (сами коды через POST /codes). */
export interface ServiceOrder extends PaymentFields {
  id: string;
  created_at: string;
  service_product_id: string;
  product_name: string;
  kind: ServiceKind;
  status: string;
  price: number;
  price_currency: string;
  codes_issued: boolean;
  // account_topup:
  login?: string;
  amount?: number;
  amount_currency?: string;
  /** Снапшот подписи единицы зачисления («⭐») на момент покупки. */
  amount_unit?: string;
  fee_amount?: number;
  // fee_pct — наш процент из продукта: строка «К зачислению» на заявке
  // показывает оплату за его вычетом, как и форма покупки.
  fee_pct?: number;
  // gift_card / subscription:
  denomination_id?: string;
  /** Снапшот имени номинала/плана на момент покупки (см. ServiceDenomination.label). */
  denom_label?: string;
  denom_value?: number;
  denom_currency?: string;
  quantity?: number;
}

export interface ServiceOrderRequest {
  service_product_id: string;
  payment_currency: string;
  promo_code?: string;
  // account_topup:
  login?: string;
  amount?: number;
  // gift_card / subscription (у подписки уезжает ВМЕСТЕ с login):
  denomination_id?: string;
  requisites_from?: Record<string, string>;
  matomo_cid?: string;
  utm?: Record<string, string>;
}

@Injectable({ providedIn: 'root' })
export class ServicesApi {
  private readonly api = inject(ApiService);

  /** Страница каталога сервисов. Поиск и порядок — на бэкенде: каталог
   *  отдаётся порциями, и фильтровать пришедшую порцию значило бы искать
   *  в ней, а не в каталоге. */
  products(opts: { q?: string; limit?: number; offset?: number } = {}): Observable<ServiceProductsPage> {
    return this.api.get('/services/products', {
      q: opts.q?.trim() || undefined,
      limit: opts.limit,
      offset: opts.offset,
    });
  }
  productBySlug(slug: string): Observable<{ product: ServiceProduct }> {
    return this.api.get(`/services/products/${encodeURIComponent(slug)}`);
  }
  /** Публичная проверка логина: провайдер без capability отвечает
   *  {valid:true, checked:false}; ошибка транспорта у бэка — то же. */
  validateLogin(serviceProductId: string, login: string): Observable<{ valid: boolean; checked: boolean }> {
    return this.api.post('/services/validate-login', { service_product_id: serviceProductId, login });
  }

  createOrder(body: ServiceOrderRequest): Observable<{ order: ServiceOrder }> {
    return this.api.post('/services/orders', body, SLOW_REQUEST_TIMEOUT_MS);
  }
  getOrder(id: string): Observable<{ order: ServiceOrder }> { return this.api.get(`/services/orders/${id}`); }
  rescheduleOrder(id: string): Observable<{ order: ServiceOrder }> {
    return this.api.post(`/services/orders/${id}/reschedule`, {}, SLOW_REQUEST_TIMEOUT_MS);
  }
  cancelOrder(id: string): Observable<unknown> { return this.api.post(`/services/orders/${id}/cancel`, {}); }
  uploadOrderBill(id: string, file: File): Observable<{ ok: boolean }> {
    return this.api.postMultipart(`/services/orders/${id}/bill`, billForm(file));
  }
  orderBillStatus(id: string): Observable<{ status: BillStatus }> { return this.api.get(`/services/orders/${id}/bill`); }

  /** Коды активации гифткарты (владелец, rate-limit, audit-лог бэка). */
  codes(id: string): Observable<{ codes: string[] }> { return this.api.post(`/services/orders/${id}/codes`, {}); }
}

function billForm(file: File): FormData {
  const fd = new FormData();
  fd.append('file', file, file.name);
  return fd;
}

/** Позиции к показу (номиналы гифткарты, планы подписки): без disabled,
 *  ЧИСЛЕННАЯ сортировка по value (лексикографическая у донора — баг, дизайн §0). */
export function visibleDenominations(p: ServiceProduct | null | undefined): ServiceDenomination[] {
  return (p?.denominations ?? [])
    .filter((d) => !d.disabled)
    .sort((a, b) => a.value - b.value);
}

/** Подпись номинала: имя товара от поставщика, иначе сумма с валютой номиналов.
 *  У части гифткарт номинал — это сам товар («1 Year Adobe Acrobat AI
 *  Assistant»), и разобранное из его имени число («1») ничего не значит. */
export function denominationLabel(
  d: Pick<ServiceDenomination, 'label' | 'value'>,
  denomCurrency: string,
  money: (v: number, c: string) => string,
): string {
  const label = (d.label ?? '').trim();
  return label || money(d.value, denomCurrency);
}

/** Параметры расчёта цены пополнения (подмножество продукта). */
export type TopupPricing = Pick<ServiceProduct, 'fee_pct' | 'unit_price' | 'amount_unit' | 'issue_currency'>;

/** Рублёвый прайс: считанная цена пополнения — целое число рублей (см.
 *  wholeTopupPrice). Крипто-прайс считается до копейки — там дробная часть и
 *  есть цена. */
function wholePriceCurrency(currency: string): boolean {
  return (currency ?? '').toUpperCase() === 'RUB';
}

/** wholeTopupPrice — ЗЕРКАЛО одноимённой функции бэка (models.go): рублёвая
 *  цена пополнения — вниз до целого рубля (копейки в ней артефакт умножения, а
 *  не цена), крипто-прайс — до копейки. Допуск 1e-9 гасит двоичную дробь. */
function wholeTopupPrice(v: number, currency: string): number {
  if (!wholePriceCurrency(currency)) return Math.round(v * 100) / 100;
  return Math.floor(v + 1e-9);
}

/** Штучное пополнение: зачисляется товар (звёзды), а не деньги — покупатель
 *  вводит КОЛИЧЕСТВО, и оно обязано быть целым. */
export function isUnitTopup(p: Pick<ServiceProduct, 'amount_unit'> | null | undefined): boolean {
  return !!p?.amount_unit;
}

/** Комиссия account_topup: round(amount × fee_pct) / 100 — зеркало бэка. */
export function topupFee(amount: number, feePct: number): number {
  return Math.round(amount * feePct) / 100;
}

// topupPayFor — цена пополнения по количеству/сумме зачисления. ЗЕРКАЛО
// ServiceProduct.TopupPrice (Go): при известной цене единицы — умножение
// (штучный товар и импортированные пополнения, где курс провайдера уже зашит
// в цену единицы), иначе историческая формула «сумма + комиссия».
export function topupPayFor(credited: number, p: TopupPricing): number {
  if (p.unit_price > 0) return wholeTopupPrice(credited * p.unit_price, p.issue_currency);
  return Math.round((credited + topupFee(credited, p.fee_pct)) * 100) / 100;
}

// topupCreditedFor — обратный расчёт: сколько ЗАЧИСЛИТСЯ, если пользователь
// платит `pay`. Контракт бэка обратный (он ждёт количество/сумму зачисления и
// сам считает цену), поэтому форма считает зачисление сама и шлёт его как
// amount. Округление ВНИЗ — гарантия, что итоговая цена (topupPayFor) никогда
// не превысит введённую сумму; у штучных округляем до целой единицы: пол-звезды
// провайдер не продаёт.
export function topupCreditedFor(pay: number, p: TopupPricing): number {
  if (!(pay > 0)) return 0;
  if (p.unit_price > 0) {
    // Цена сама округляется вниз до целого рубля, поэтому в оплату влезает
    // зачисление, чья ТОЧНАЯ цена доходит до целого рубля почти вплотную. Запас
    // обязателен: считая «в лоб» (pay / цена единицы), кнопка «1 000 ₽» дала бы
    // зачисление, урезанное до копейки вниз, а после floor'а цены — 999 ₽.
    // Считаем от ЦЕЛОЙ части оплаты (0,99 ₽ запаса), и тогда цена не превысит
    // введённое даже при вводе с копейками: floor(⌊pay⌋ + 0,99) = ⌊pay⌋.
    const room = wholePriceCurrency(p.issue_currency) ? Math.floor(pay) + 0.99 : pay;
    const units = room / p.unit_price;
    return p.amount_unit ? Math.floor(units) : Math.floor(units * 100 + 1e-6) / 100;
  }
  // Денежное пополнение: цена = зачисление + наценка, ОКРУГЛЁННАЯ до копейки
  // (`round(amount × fee_pct)/100` — канон бэка). Деление «в лоб» из-за этого
  // промахивается на копейку вниз: 100 ₽ при 3% давали зачисление 97,08 и цену
  // 99,99, хотя 97,09 стоит ровно 100,00. Поэтому подтягиваем зачисление вверх,
  // пока цена НЕ превышает введённое. Цена монотонна по зачислению, а
  // округление наценки сдвигает её не больше чем на копейку — двух шагов
  // хватает с запасом, потолок только страхует от вечного цикла.
  let credited = Math.floor((pay / (1 + p.fee_pct / 100)) * 100 + 1e-6) / 100;
  for (let i = 0; i < 3; i++) {
    const next = Math.round((credited + 0.01) * 100) / 100;
    if (topupPayFor(next, p) > pay + 1e-9) break;
    credited = next;
  }
  return credited;
}

/** Подпись зачисления: «1 000 ₽» либо «50 ⭐» у штучного пополнения. */
export function topupAmountLabel(
  amount: number,
  p: Pick<ServiceProduct, 'amount_unit' | 'amount_currency'>,
  money: (v: number, c: string) => string,
): string {
  return p.amount_unit ? `${amount} ${p.amount_unit}` : money(amount, p.amount_currency);
}

/** Сумма ЗАКАЗА: цена плюс скидка промокода обратно — то, что ввёл покупатель.
 *  `price` заявки — уже нетто к оплате и под 100% промокодом равен нулю, из-за
 *  чего и сумма, и «К зачислению» показывались нулями. */
export function orderGross(o: { price: number; discount_amount?: number }): number {
  return o.price + (o.discount_amount ?? 0);
}

// topupCreditedDisplay — строка «К зачислению» у ДЕНЕЖНОГО пополнения: введённая
// оплата минус НАШ процент. Это витринное правило, а не расчёт: сумма, которая
// реально ляжет на счёт, зависит от курса провайдера (задача уходит ему в
// долларах по нашему курсу закупки) и в валюте счёта покупателя всё равно
// другая — регион аккаунта сплошь и рядом не рублёвый. Поэтому здесь честнее
// показать «сколько ушло на пополнение за вычетом нашей комиссии», чем
// пересчитанную по чужому курсу оценку.
//
// Формулу заказа (topupPayFor / topupCreditedFor) это НЕ трогает: на бэкенд
// по-прежнему уходит расчётная сумма зачисления.
export function topupCreditedDisplay(pay: number, feePct: number): number {
  if (!(pay > 0)) return 0;
  return topupCreditedShown(pay * (1 - feePct / 100));
}

// topupCreditedShown — зачисление в том виде, в каком его читает пользователь:
// это оценка («~»), копейки в ней смысла не несут — курс на стороне сервиса и
// провайдера всё равно плавает. Округляем ВНИЗ, чтобы не обещать лишнего;
// у мелких сумм (крипто-режим) целые единицы слишком грубы — там сотые.
export function topupCreditedShown(credited: number): number {
  return credited >= 100 ? Math.floor(credited) : Math.floor(credited * 100) / 100;
}
