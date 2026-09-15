import { Injectable, inject, signal } from '@angular/core';
import { Observable, tap } from 'rxjs';
import { ApiService } from './api.service';

/** Один BIN выпуска карт-продукта (элемент CardProduct.bins). */
export interface ProductBin {
  /** ID BIN'а у card-issuer'а (Buvei cardBinId из GET /card-bins). */
  bin_id: string;
  /** Страна выпуска BIN (ISO alpha-2: HK/SG/GB) — по ней billing-диалог
   *  показывает захардкоженный адрес-заглушку для карт этого BIN'а.
   *  Пусто/неизвестно — адрес не показывается (fail-closed). */
  country: string;
  /** Человекочитаемое имя для админки (диалог замены). Пусто — показывается bin_id. */
  label?: string;
}

/** Провайдер-привязка выпуска карт-продукта (элемент CardProduct.providers).
 *  Порядок значим: активный провайдер = первый включённый в provider_states,
 *  его BIN — дефолт всех новых выпусков. */
export interface CardProviderRef {
  /** Код провайдера из реестра бэка (сейчас buvei). */
  provider: string;
  bin_id: string;
  country: string;
  label?: string;
}

/** BIN'ы продукта: источник правды — providers (bins из API больше не
 *  отдаётся, оставлен legacy-fallback на окно деплоя старого бэка). */
export function productBins(p: Pick<CardProduct, 'providers' | 'bins'> | null | undefined): ProductBin[] {
  if (!p) return [];
  const refs = p.providers ?? [];
  if (refs.length) return refs.map((r) => ({ bin_id: r.bin_id, country: r.country, label: r.label }));
  return p.bins ?? [];
}

export interface CardProduct {
  id: string;
  name: string;
  description: string;
  deposit_fee_pct: number;
  issue_price: number;
  issue_currency: string;
  /** Годовое обслуживание в issue_currency. 0 = обслуживание бесплатно. */
  annual_service_fee: number;
  /** Срок действия карты в годах. Справочное поле каталога (реальный expiry
   *  выпущенной карты приходит от issuer'а). 0 = не задан — строка «Срок
   *  действия» в условиях не показывается. */
  validity_years: number;
  card_currency: string;
  /** LEGACY: BIN'ы выпуска. Бэк с фичей eSIM это поле больше НЕ отдаёт
   *  (источник правды — providers); оставлено для окна деплоя старого бэка.
   *  Читать через productBins(). */
  bins?: ProductBin[] | null;
  /** Провайдер-привязки выпуска; порядок значим: ПЕРВАЯ — дефолт новых
   *  выпусков, остальные доступны админ-операции «Заменить карту». Пустой
   *  список — выпуск карт по продукту падает card.failed. */
  providers?: CardProviderRef[] | null;
  perks: [string, string][] | null;
  lists: string[][] | null;
  forbidden: string[] | null;
  /** Фон самой пластиковой карты (URL картинки). Применяется через cover. */
  image_url: string;
  /** CSS-фон карты-визуала (hex, gradient, или пресет blue/dark/gold). */
  gradient: string;
  /** Фон страницы продукта (URL картинки). */
  bg_image_url: string;
  /** CSS-фон страницы продукта (fallback или замена картинки). */
  bg_gradient: string;
  /** Цвет заголовка (H) на странице продукта. CSS-color, обычно hex. */
  heading_color: string;
  /** Цвет основного текста (Body) на странице продукта. */
  body_color: string;
  /** Цвет CTA-кнопки и акцентов на странице продукта. */
  cta_color: string;
  /** Иконки 1-го уровня — мелкие plate-бейджи (платёжные системы). */
  tier1_attrs: string[] | null;
  /** Иконки 2-го уровня — большие круглые (сервисы). */
  tier2_attrs: string[] | null;
  sort_order: number;
  /** Если true — выпуск этой карты временно закрыт. Карточка не показывается
   *  в каталоге Home (фильтр availableProducts) и Product-detail (CTA меняется
   *  на disabled). Backend всё равно вернёт продукт через listProducts/getProduct,
   *  чтобы карусели уже выпущенных карт могли резолвить картинку/градиент. */
  disable_purchase: boolean;
  /** Если true — пополнения карт этого продукта запрещены. Home рисует под
   *  картой плашку «Ограниченное использование» и делает кнопку «Пополнить»
   *  неактивной. Topup-страница показывает stub вместо формы. */
  disable_topup: boolean;
  /** Минимальная сумма одного пополнения в card_currency. 0 = без ограничения. */
  min_topup_amount: number;
  /** Лимит покупок по карте за календарный месяц в card_currency. 0 = без лимита. */
  monthly_purchase_limit: number;
  /** Фикс. стоимость одной транзакции в card_currency (комбинируется с tx_fee_pct). */
  tx_fee_fixed: number;
  /** Процент стоимости одной транзакции (0.02 = 2%). */
  tx_fee_pct: number;
  /** Фикс. стоимость отмены транзакции в card_currency. */
  refund_fee_fixed: number;
  /** Процент стоимости отмены транзакции. */
  refund_fee_pct: number;
}

export interface UserCard {
  id: string;
  card_product_id: string;
  last4: string;
  expiry_month: number;
  expiry_year: number;
  balance: number;
  status: string;
  /** ISO-дата окончания оплаченного года обслуживания. null/undefined =
   * обслуживание для продукта не настроено (фича отключена для этой карты). */
  service_expires_at?: string | null;
  /** Страна BIN'а, под который карта реально выпущена (снапшот на карте) —
   * у продукта BIN'ов может быть несколько. Пусто у legacy-карт — фолбэк на
   * первый BIN продукта (см. home.binCountryOf). */
  issuer_country?: string;
}

export interface CardDetails {
  pan: string;
  cvv: string;
  expiry_month: number;
  expiry_year: number;
}

@Injectable({ providedIn: 'root' })
export class CardsApi {
  private readonly api = inject(ApiService);

  // Глобальный кэш карт пользователя — заполняется первым успешным
  // myCards()-вызовом (обычно из app-shell). Любая другая страница
  // (history, topup, ...) читает этот signal сразу, не дожидаясь своей
  // HTTP-загрузки — и параллельно может перезапросить, чтобы освежить.
  readonly cardsCache = signal<UserCard[]>([]);

  listProducts(): Observable<{ products: CardProduct[] }> { return this.api.get('/cards/products'); }
  getProduct(id: string): Observable<CardProduct> { return this.api.get(`/cards/products/${id}`); }
  myCards(): Observable<{ cards: UserCard[] }> {
    return this.api.get<{ cards: UserCard[] }>('/cards').pipe(
      tap((r) => this.cardsCache.set(r?.cards ?? [])),
    );
  }
  getCard(id: string): Observable<UserCard> { return this.api.get(`/cards/${id}`); }
  details(id: string): Observable<CardDetails> { return this.api.post(`/cards/${id}/details`, {}); }
}
