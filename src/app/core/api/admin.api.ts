import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { ApiService } from './api.service';
import { CardProduct } from './cards.api';
import { ReferralConfig, ReferralPayoutRow, ReferralPendingSum } from './referral.api';
import { UserRole } from '../auth/auth.service';

/** Тип продукта (провайдеры, заявки, методы оплаты, промокоды). */
export type ProductType = 'card' | 'esim' | 'service';

/** Русские подписи типов продуктов (селекторы/колонки админки). */
export const PRODUCT_TYPE_LABELS: Record<string, string> = {
  card: 'Карты',
  esim: 'eSIM',
  service: 'Сервисы',
  any: 'Любой',
};

export interface PromoCode {
  id?: string;
  created_at?: string;
  code: string;
  discount_amount: number;
  /** Тип скидки: amount — абсолютная в валюте кода (дефолт, пусто у легаси),
   *  percent — discount_amount хранит процент (0–100] от цены операции,
   *  сам размер скидки бэк округляет до целых при применении. */
  discount_type?: 'amount' | 'percent';
  discount_currency: string;
  scope: string;
  /** Тип продукта кода: any | card | esim | service. Задаётся ТОЛЬКО при
   *  создании — PATCH-whitelist бэка это поле не принимает. */
  product_type?: string;
  max_usages: number;
  usage_count: number;
  expires_at?: string;
  active: boolean;
  /** Минимальная сумма операции (в валюте кода), от которой код применим. 0 = без порога. */
  min_amount?: number;
  /** Ограничение по карт-продуктам: список id, пусто/null = все продукты. */
  product_ids?: string[] | null;
  /** manual — создан руками; auto — сгенерирован шагом retention-плана. */
  origin?: string;
  plan_id?: string | null;
  step_id?: string | null;
  /** Для кого сгенерирован auto-код (информационно, применение не ограничивает). */
  generated_for_user_id?: string | null;
  /** Привязка к реф-программе: id партнёра-получателя. Применение кода юзером
   *  без пригласившего постоянно привязывает его к партнёру (как реф-ссылка);
   *  премия партнёру — с каждой оплаченной карты. Пустая строка в PATCH =
   *  снять привязку. Получатель обязан быть назначенным партнёром (гейт бэка). */
  referral_user_id?: string | null;
}

/** Краткая карточка юзера в обогащённых ответах (map id → инфо). */
export interface AdminUserBrief {
  email?: string | null;
  first_name?: string;
  last_name?: string;
  username?: string;
  telegram_id?: number | null;
}

export interface PartnerConfig {
  id?: string;
  user_id: string;
  // user_* — поля связанного пользователя, бэк обогащает JOIN'ом в ListPartners,
  // чтобы админ не смотрел на голый ULID. Создание партнёра по-прежнему по
  // email пользователя — см. createPartner.
  user_email?: string;
  user_first_name?: string;
  user_last_name?: string;
  user_username?: string;
  telegram_id?: number;
  // user_blocked_referral — текущее состояние блокировки реф-программы у
  // связанного юзера. Меняется через PATCH /admin/users/:id (см. updateUser).
  user_blocked_referral?: boolean;
  amount: number;
  currency: string;
  level: number;
  comment: string;
  created_at?: string;
  updated_at?: string;
}

export interface AdminUser {
  id: string;
  created_at: string;
  email?: string;
  telegram_id?: number;
  first_name: string;
  last_name: string;
  username?: string;
  /** Роль: user | moderator | admin. Меняется через PATCH (только админом). */
  role: UserRole;
  email_notifications_enabled: boolean;
  referral_type: string;
  referral_code: string;
  // Три независимых блокирующих флага. PATCH допускает любую комбинацию.
  // Эффекты — см. backend (services/auth_service.go, order_service.go,
  // referral_service.go) и CLAUDE.md.
  blocked_login?: boolean;
  blocked_cards?: boolean;
  blocked_referral?: boolean;
}

export interface AdminCard {
  id: string;
  created_at: string;
  updated_at: string;
  user_id: string;
  user_email?: string;
  user_first_name?: string;
  user_last_name?: string;
  card_product_id: string;
  product_name?: string;
  last4: string;
  status: string;
  balance: number;
  cardholder: string;
  expiry_month: number;
  expiry_year: number;
  service_expires_at?: string | null;
  /** true — карта заморожена админ-действием (точечно или блокировкой юзера);
   *  false при status=frozen означает заморозку по истёкшему обслуживанию. */
  frozen_by_admin?: boolean;
  /** BIN, под который карта выпущена (снапшот на карте). Пусто у legacy-карт
   *  до мульти-BIN — трактуется как первый BIN продукта. */
  issuer_bin_id?: string;
  issuer_country?: string;
}

export interface AdminCardsResponse {
  items: AdminCard[];
  total: number;
  page: number;
  page_size: number;
}

/** Промо-поля строки админ-списка заявок — общие для всех типов продукта.
 *  Отвечают на «оформлено по промокоду или нет» и «на сколько скидка».
 *  Сам код бэк отдаёт ТОЛЬКО role=admin — у модератора поле отсутствует. */
export interface AdminPromoInfo {
  /** Заявка оформлена по промокоду. */
  promo_applied?: boolean;
  /** Размер скидки в discount_currency (0 — промокода не было). */
  discount_amount?: number;
  /** Валюта скидки: прайс продукта у выпусков, валюта пополнения у топапов. */
  discount_currency?: string;
  /** Сам промокод (admin-only). */
  promo_code?: string;
}

/** Заявка на выпуск карты (admin-список). */
export interface AdminOrder extends AdminPromoInfo {
  /** Присутствует только в union-режиме (product_type=all). */
  product_type?: string;
  id: string;
  created_at: string;
  user_id: string;
  user_email?: string;
  user_first_name?: string;
  user_last_name?: string;
  card_product_id: string;
  product_name?: string;
  status: string; // pending_payment | paid | issued | failed | cancelled | ...
  failure_reason?: string | null;
  amount_issue: number;
  amount_payment: number;
  payment_currency: string;
  provider: string;
  /** Id remote-заявки у провайдера оплаты (cc → номер заявки coincat). */
  coincat_order_id?: string | null;
  paid_at?: string | null;
}

/** eSIM-выпуск (GET /admin/orders?product_type=esim). Статусы:
 *  pending_payment|pending_kyc|paid|issued|failed|refunded|cancelled. */
export interface AdminEsimOrder extends AdminPromoInfo {
  product_type?: string;
  id: string;
  created_at: string;
  user_id: string;
  user_email?: string;
  user_first_name?: string;
  user_last_name?: string;
  esim_product_id: string;
  /** Снапшот имени тарифа на заявке. */
  product_name?: string;
  /** Провайдер ВЫПУСКА (снапшот резолва; не путать с платёжным provider). */
  issuer_provider?: string;
  /** Адрес доставки письма с QR (снапшот на заявке). */
  email?: string;
  status: string;
  failure_reason?: string | null;
  amount_issue: number;
  issue_currency: string;
  amount_payment: number;
  payment_currency: string;
  /** Платёжный провайдер (cc | kassaai | platega | enot). */
  provider: string;
  coincat_order_id?: string | null;
  paid_at?: string | null;
  /** Счётчик попыток выпуска (admin-retry инкрементирует). */
  attempt?: number;
}

/** eSIM-recharge (GET /admin/topups?product_type=esim). Статусы:
 *  pending_payment|pending_kyc|paid|done|failed|refunded|cancelled. */
export interface AdminEsimRecharge extends AdminPromoInfo {
  product_type?: string;
  id: string;
  created_at: string;
  user_id: string;
  user_email?: string;
  user_first_name?: string;
  user_last_name?: string;
  esim_id: string;
  esim_product_id: string;
  issuer_provider?: string;
  status: string;
  failure_reason?: string | null;
  amount: number;
  currency: string;
  amount_payment: number;
  payment_currency: string;
  provider: string;
  coincat_order_id?: string | null;
  paid_at?: string | null;
}

/** Сервис-заказ (GET /admin/topups?product_type=service). Статусы:
 *  pending_payment|pending_kyc|paid|processing|completed|failed|refunded|cancelled. */
export interface AdminServiceOrder extends AdminPromoInfo {
  product_type?: string;
  id: string;
  created_at: string;
  user_id: string;
  user_email?: string;
  user_first_name?: string;
  user_last_name?: string;
  service_product_id: string;
  product_name?: string;
  kind: 'account_topup' | 'gift_card' | string;
  issuer_provider?: string;
  /** Id заказа у провайдера из событий (ord-N у fzr, uuid у PW). */
  provider_order_id?: string;
  // account_topup:
  login?: string;
  amount?: number;
  amount_currency?: string;
  // gift_card:
  denomination_id?: string;
  denom_value?: number;
  denom_currency?: string;
  /** «К оплате» (нетто после промо) в валюте цен продукта. */
  price: number;
  price_currency: string;
  /** Код гифткарты выдан (сами коды в списки не отдаются). */
  codes_issued?: boolean;
  status: string;
  failure_reason?: string | null;
  amount_payment: number;
  payment_currency: string;
  provider: string;
  coincat_order_id?: string | null;
  paid_at?: string | null;
  attempt?: number;
}

/** Пополнение карты (admin-список). */
export interface AdminTopup extends AdminPromoInfo {
  id: string;
  created_at: string;
  user_id: string;
  user_email?: string;
  user_first_name?: string;
  user_last_name?: string;
  card_id: string;
  card_last4?: string;
  status: string; // pending_payment | paid | topped_up | failed | ...
  failure_reason?: string | null;
  amount: number;
  currency: string;
  amount_payment: number;
  payment_currency: string;
  provider: string;
  /** Id remote-заявки у провайдера оплаты (cc → номер заявки coincat). */
  coincat_order_id?: string | null;
  paid_at?: string | null;
}

export interface AdminListResponse<T> {
  items: T[];
  total: number;
  page: number;
  page_size: number;
}

/** Транзакция по карте (движение) в разрезе пользователя (admin deep-link). */
export interface AdminTransaction {
  id: string;
  card_id: string;
  /** last4 карты, к которой относится движение (подтягивает бэк). */
  card_last4?: string;
  kind: string;
  amount: number;
  currency: string;
  description: string;
  raw_currency_amount?: number;
  raw_currency?: string;
  fee_amount?: number;
  status: string;
  happened_at: string;
}

/** Ответ /admin/users/:id/transactions: профиль владельца + его транзакции. */
export interface AdminUserTransactionsResponse {
  user: {
    id: string;
    email?: string;
    first_name: string;
    last_name: string;
    telegram_id?: number;
  };
  items: AdminTransaction[];
}

/** Строка общего списка /admin/transactions: движение + владелец карты. */
export interface AdminTransactionRow extends AdminTransaction {
  user_id: string;
  user_email?: string;
  user_first_name?: string;
  user_last_name?: string;
}

export interface AdminTransactionsQuery {
  page?: number;
  page_size?: number;
  /** Точечный фильтр по владельцу (выбор в фильтре «Пользователь»). */
  user_id?: string;
}

/** Ответ /admin/transactions; user приходит только при фильтре user_id —
 *  для chip'а фильтра (в т.ч. когда у пользователя ноль транзакций). */
export interface AdminTransactionsResponse extends AdminListResponse<AdminTransactionRow> {
  user?: AdminUserTransactionsResponse['user'];
}

export interface AdminOrdersQuery {
  page?: number;
  page_size?: number;
  status?: string;
  q?: string;
  /** card (дефолт бэка) | esim | service | all — фильтр типа продукта. */
  product_type?: string;
}

// ----- Провайдеры продуктов + каталоги (eSIM / Сервисы) -----

/** Провайдер типа продукта из GET /admin/providers/meta. */
export interface ProviderMeta {
  code: string;
  title: string;
  /** Тумблер provider_states (лениво создаётся включённым). */
  enabled: boolean;
  can_validate_login?: boolean;
  topup_currencies?: string[] | null;
  /** Виды сервис-продуктов, которые провайдер исполняет (account_topup /
   *  gift_card). Пусто = сервис-команды не принимает. */
  service_kinds?: string[] | null;
  /** SERVICE_URL провайдер-сервиса задан на бэке — каталог-прокси доступен. */
  configured?: boolean;
  /** card — тумблер в этой итерации не показывается (fail-open секции). */
  read_only?: boolean;
}

export interface ProvidersMeta {
  product_types: Record<string, ProviderMeta[]>;
}

/** Нормализованный элемент каталога провайдера ([{id, label, meta}]).
 *  id может быть составным JSON-ext (fzr), meta несёт price/stock/min/max. */
export interface ProviderCatalogItem {
  id: string;
  label: string;
  meta?: Record<string, unknown>;
}

/** Провайдер-привязка eSIM-продукта (элемент providers, порядок = приоритет). */
export interface EsimProviderRef {
  provider: string;
  /** id плана на стороне провайдера (селект из каталог-прокси). */
  plan_id: string;
  label?: string;
  /** Цена плана у провайдера на момент привязки (защита от роста цены). */
  price_usd_snapshot?: number;
}

/** eSIM-тариф (admin CRUD /admin/esim/products). */
export interface AdminEsimProduct {
  id?: string;
  created_at?: string;
  name: string;
  description: string;
  /** ISO-2; пусто = глобальный тариф. */
  country_code: string;
  country_name: string;
  days: number;
  /** Объём трафика в МБ; 0 = безлимит. */
  data_mb: number;
  issue_price: number;
  issue_currency: string;
  providers: EsimProviderRef[] | null;
  disable_purchase: boolean;
  sort_order: number;
  /** Режим цены: static — задана руками, dynamic — считается из
   *  себестоимости провайдера, курса и наценки (прайс тогда всегда RUB). */
  pricing_mode?: PricingMode;
  /** Наценка в процентах (только dynamic). */
  markup_pct?: number;
  /** Себестоимость плана у активного провайдера, USD (снапшот пересчёта). */
  cost_usd?: number;
  /** Когда цена пересчитывалась в последний раз. */
  price_updated_at?: string | null;
  /** Код провайдера, чей импорт создал позицию (пусто = заведена руками). */
  imported_from?: string;
}

/** Провайдер-привязка сервис-продукта: ext — снапшот идентификаторов
 *  провайдера (PW: {service_id}; fzr: составной JSON-ext каталога). */
export interface ServiceProviderRef {
  provider: string;
  ext?: Record<string, string>;
}

/** Номинал гифткарты (элемент denominations сервис-продукта). */
export interface AdminServiceDenomination {
  id: string;
  /** Имя позиции у поставщика («1 Year Adobe Acrobat AI Assistant», «12 месяцев»).
   *  Форма его не редактирует — приносит импорт, бэкенд мержит при PATCH. */
  label?: string;
  value: number;
  price: number;
  /** map[provider]ext номинала (у fzr пара category_id+card_id на номинал). */
  providers?: Record<string, Record<string, string>>;
  disabled?: boolean;
  /** Себестоимость номинала у провайдера, USD (снапшот пересчёта цен). */
  cost_usd?: number;
}

/** Сервис-продукт (admin CRUD /admin/services/products). */
export interface AdminServiceProduct {
  id?: string;
  created_at?: string;
  kind: 'account_topup' | 'gift_card' | 'subscription';
  name: string;
  slug: string;
  description: string;
  icon_url: string;
  featured: boolean;
  sort_order: number;
  disable_purchase: boolean;
  /** Валюта цен (RUB | USDT — режим как у карт). */
  issue_currency: string;
  providers: ServiceProviderRef[] | null;
  // account_topup:
  amount_currency: string;
  /** Подпись единицы зачисления («⭐») — непусто у ШТУЧНЫХ пополнений. */
  amount_unit?: string;
  /** Подпись поля ввода на витрине («Количество звёзд»). */
  amount_label?: string;
  /** Себестоимость единицы у провайдера и её цена в прайсе — считает импорт и
   *  тикер, форма их не редактирует (read-only, как cost_usd у номиналов). */
  unit_cost_usd?: number;
  unit_price?: number;
  min_amount: number;
  max_amount: number;
  fee_pct: number;
  amount_presets: number[] | null;
  login_label: string;
  login_hint: string;
  /** Обязательная приставка логина («@» у ника Telegram) — витрина подставляет
   *  её сама и выбрасывает лишние вхождения. Пусто = приставки нет (Steam). */
  login_prefix?: string;
  // gift_card / subscription:
  denom_currency: string;
  /** Номиналы гифткарты либо планы подписки («12 месяцев», value = месяцы). */
  denominations: AdminServiceDenomination[] | null;
  /** Режим цены. У gift_card считается цена номинала, у account_topup — цена
   *  ЕДИНИЦЫ зачисления (unit_price) из её себестоимости. */
  pricing_mode?: PricingMode;
  markup_pct?: number;
  price_updated_at?: string | null;
  imported_from?: string;
}

/** Режим ценообразования продукта (карты — всегда static, режима не имеют). */
export type PricingMode = 'static' | 'dynamic';

/** Прогон импорта каталога провайдера (product_import_jobs). */
export interface ProductImportJob {
  id: string;
  created_at?: string;
  product_type: 'esim' | 'service';
  provider: string;
  vertical?: string;
  markup_pct: number;
  status: 'running' | 'done' | 'failed';
  total: number;
  processed: number;
  created: number;
  updated: number;
  skipped: number;
  disabled: number;
  failed: number;
  error?: string;
  started_at?: string;
  finished_at?: string;
}

/** Итог пересчёта цен (POST /admin/pricing/refresh). */
export interface PricingStats {
  scanned: number;
  updated: number;
  skipped: number;
}

/** Ответ предпросмотра массовой операции. */
export interface BulkPreview<T> {
  products: T[];
  total: number;
  /** Потолок бэкенда: набор больше него применить нельзя. */
  limit: number;
}

/** Результат применения массовой операции. */
export interface BulkResult {
  matched: number;
  updated?: number;
  deleted?: number;
}

/** Краткая карточка продукта для мультиселектов (GET /admin/products/brief). */
export interface ProductBrief {
  id: string;
  name: string;
}

/** Пагинация промокодов. Раздел «Карты» передаёт большой page_size, чтобы
 *  получить полный список для выпадашки-фильтра «Промокод». */
export interface AdminPromoQuery {
  page?: number;
  page_size?: number;
  /** Вкладки раздела: manual (ручные) | auto (сгенерированные планами). */
  origin?: string;
  /** Авто-коды, сгенерированные для конкретного юзера. */
  user_id?: string;
}

/** Ответ /admin/promo: items + карта users для колонок «для кого» (auto-коды)
 *  и «Партнёр» (реф-привязка referral_user_id). */
export interface AdminPromoResponse extends AdminListResponse<PromoCode> {
  users?: Record<string, AdminUserBrief>;
}

// ----- Retention-планы -----

// ----- Методы оплаты (раздел «Методы оплаты», admin-only) -----

export interface PaymentMethodCondition {
  type: string;
}

export interface AdminPaymentMethod {
  id: string;
  /** issue — покупка карты; topup — пополнение и продление. */
  scope: 'issue' | 'topup';
  /** '' = глобальная строка (все типы); card|esim|service — переопределение
   *  по валюте для типа (override enabled=false скрывает валюту для типа).
   *  Порядок sort_order хранится per (scope, product_type). */
  product_type: string;
  currency_id: string;
  provider: 'cc' | 'kassaai' | 'platega' | 'enot';
  enabled: boolean;
  /** Условия доступности (И). Пусто/null = доступен безусловно. */
  conditions: PaymentMethodCondition[] | null;
  /** Серая подпись на отключённой валюте («включится, когда …»). */
  condition_note: string;
  sort_order: number;
}

export interface PaymentConditionTypeMeta {
  type: string;
  label: string;
  description: string;
}

export interface PaymentMethodsMeta {
  condition_types: PaymentConditionTypeMeta[];
  providers: { id: string; label: string }[];
  scopes: { id: string; label: string }[];
  /** '' = Глобально | card | esim | service. */
  product_types?: { id: string; label: string }[];
  currencies: { id: string; name: string }[];
}

export interface RetentionPlan {
  id: string;
  created_at: string;
  updated_at?: string;
  name: string;
  active: boolean;
  interval_minutes: number;
  /** Защита входа: не впускать юзеров, получавших уведомления других планов последние N минут (0 = выключена). */
  entry_guard_minutes?: number;
  last_run_at?: string | null;
}

export interface RetentionPlanRow {
  plan: RetentionPlan;
  steps_count: number;
  users_count: number;
}

/** Инлайн-условие отбора в шаге плана (элемент RetentionStep.conditions). */
export interface RetentionStepCondition {
  type: string;
  params?: { elapsed_minutes?: number } | null;
}

/** Параметры действия шага — контейнер всех типов (см. RetentionTypeMeta). */
export interface RetentionActionParams {
  // notify
  text?: string;
  subject?: string;
  button_text?: string;
  button_reply?: string;
  button_url?: string;
  // create_promo
  output_param?: string;
  discount_amount?: number;
  discount_currency?: string;
  scope?: string;
  /** Тип продукта кода: card | esim | service | any (пусто = card). */
  product_type?: string;
  max_usages?: number;
  min_amount?: number;
  expires_minutes?: number;
  product_ids?: string[];
  // deactivate_promo (код не удаляется — деактивируется, остаётся для статистики воронки)
  input_param?: string;
}

export interface RetentionStep {
  id?: string;
  plan_id?: string;
  position?: number;
  name?: string;
  /** Тумблер шага: выключенный шаг пропускается воркером (как будто шага нет). */
  active?: boolean;
  /** Условия отбора (объединяются по И); задаются инлайн, отдельной сущности нет. */
  conditions?: RetentionStepCondition[] | null;
  action_type: string;
  action_params?: RetentionActionParams | null;
}

export interface RetentionParamSpec {
  key: string;
  label: string;
  kind: string; // duration|text|richtext|number|currency|scope|products|param_name|param_ref
  required?: boolean;
}

export interface RetentionTypeMeta {
  type: string;
  label: string;
  description: string;
  params?: RetentionParamSpec[];
}

/** Системный параметр плейсхолдеров: доступен в любом плане без настройки шагами. */
export interface RetentionSystemParam {
  name: string;
  label: string;
  description: string;
}

export interface RetentionMeta {
  condition_types: RetentionTypeMeta[];
  action_types: RetentionTypeMeta[];
  system_params?: RetentionSystemParam[];
}

export interface RetentionTestState {
  progress?: {
    id: string;
    last_position: number;
    params?: Record<string, string> | null;
    last_step_at?: string;
  } | null;
  /** 1-based позиция следующего шага; 0 = все шаги пройдены. */
  next_position: number;
  steps_total: number;
}

// ----- Журнал уведомлений («Логирование») -----

export interface NotificationLogRow {
  id: string;
  created_at: string;
  user_id: string;
  channel: string; // telegram | email
  kind: string;
  recipient: string;
  subject?: string;
  body: string;
  source: string; // system | plan
  plan_id?: string | null;
  step_id?: string | null;
  success: boolean;
  error?: string;
}

export interface AdminNotificationsQuery {
  page?: number;
  page_size?: number;
  user_id?: string;
  source?: string;
  q?: string;
}

export interface AdminNotificationsResponse extends AdminListResponse<NotificationLogRow> {
  users?: Record<string, AdminUserBrief>;
}

export interface AdminPartnersQuery {
  page?: number;
  page_size?: number;
  /** case-insensitive подстрока: email/имя/username/referral_code/comment. */
  q?: string;
}

/** Заявка партнёра на вывод реальных денег (Партнёры → Заявки). */
export interface AdminWithdrawal {
  id: string;
  created_at: string;
  user_id: string;
  amount: number;
  currency: string;
  /** Реквизиты для выплаты — свободный текст партнёра. */
  requisites: string;
  status: 'pending' | 'paid' | 'rejected';
  resolved_by?: string;
  resolved_at?: string;
  admin_comment?: string;
}

export interface AdminWithdrawalsQuery {
  page?: number;
  page_size?: number;
  /** pending | paid | rejected; пусто = все. */
  status?: string;
}

export interface AdminWithdrawalsResponse extends AdminListResponse<AdminWithdrawal> {
  users?: Record<string, AdminUserBrief>;
}

export interface AdminUsersQuery {
  page?: number;
  page_size?: number;
  /** поиск: email/имя/username или точный telegram_id. */
  q?: string;
}

export interface AdminCardsQuery {
  page?: number;
  page_size?: number;
  status?: string;
  card_product_id?: string;
  promo_code_id?: string;
  /** Точечный фильтр по владельцу (deep-link «Карты» из раздела «Пользователи»). */
  user_id?: string;
  q?: string;
}

/** Ответ точечной заморозки/разморозки одной карты. */
export interface AdminCardStatus {
  id: string;
  status: string;
  frozen_by_admin: boolean;
}

/** Остаток кошелька issuer-аккаунта (GET /admin/balance). Сумма — в валюте
 *  кошелька провайдера (USD), не в валютах карт-продуктов. free_card_slots —
 *  свободные лоты выпуска карт из KYC-пула issuer'а (1 KYC даёт квоту карт,
 *  по умолчанию 3); null/отсутствует — issuer старой версии либо счётчик
 *  недоступен, строка в плашке не рисуется. */
export interface IssuerBalance {
  balance: number;
  currency: string;
  free_card_slots?: number | null;
}

@Injectable({ providedIn: 'root' })
export class AdminApi {
  private readonly api = inject(ApiService);
  listProducts(): Observable<{ products: CardProduct[] }> { return this.api.get('/admin/cards/products'); }
  createProduct(body: Partial<CardProduct>): Observable<CardProduct> { return this.api.post('/admin/cards/products', body); }
  updateProduct(id: string, body: Partial<CardProduct>): Observable<CardProduct> { return this.api.patch(`/admin/cards/products/${id}`, body); }
  deleteProduct(id: string): Observable<unknown> { return this.api.delete(`/admin/cards/products/${id}`); }

  /** Промокоды с пагинацией page/page_size (единый стиль с cards/orders).
   *  Раздел «Карты» тянет полный список для фильтра одним запросом с большим
   *  page_size (см. cards-admin.page.ts). */
  listPromo(query: AdminPromoQuery = {}): Observable<AdminPromoResponse> {
    const params = this.pageParams(query);
    if (query.origin) params['origin'] = query.origin;
    if (query.user_id) params['user_id'] = query.user_id;
    return this.api.get('/admin/promo', params);
  }
  createPromo(body: Partial<PromoCode>): Observable<PromoCode> { return this.api.post('/admin/promo', body); }
  updatePromo(id: string, body: Partial<PromoCode>): Observable<PromoCode> { return this.api.patch(`/admin/promo/${id}`, body); }
  deletePromo(id: string): Observable<unknown> { return this.api.delete(`/admin/promo/${id}`); }

  // ----- Методы оплаты -----

  /** Справочник для форм раздела «Методы оплаты»: типы условий доступности,
   *  провайдеры, scope и валюты (активные направления coincat). */
  paymentMethodsMeta(): Observable<PaymentMethodsMeta> { return this.api.get('/admin/payment-methods/meta'); }
  listPaymentMethods(): Observable<{ methods: AdminPaymentMethod[] }> { return this.api.get('/admin/payment-methods'); }
  createPaymentMethod(body: Partial<AdminPaymentMethod>): Observable<{ method: AdminPaymentMethod }> {
    return this.api.post('/admin/payment-methods', body);
  }
  updatePaymentMethod(id: string, body: Partial<AdminPaymentMethod>): Observable<{ method: AdminPaymentMethod }> {
    return this.api.patch(`/admin/payment-methods/${id}`, body);
  }
  deletePaymentMethod(id: string): Observable<unknown> { return this.api.delete(`/admin/payment-methods/${id}`); }

  // ----- Retention-планы -----

  /** Справочник типов кондишенов и действий — формы строятся динамически. */
  retentionMeta(): Observable<RetentionMeta> { return this.api.get('/admin/retention/meta'); }

  listRetentionPlans(): Observable<{ items: RetentionPlanRow[] }> { return this.api.get('/admin/retention/plans'); }
  createRetentionPlan(body: { name: string; interval_minutes: number }): Observable<RetentionPlan> {
    return this.api.post('/admin/retention/plans', body);
  }
  getRetentionPlan(id: string): Observable<{ plan: RetentionPlan; steps: RetentionStep[] }> {
    return this.api.get(`/admin/retention/plans/${id}`);
  }
  updateRetentionPlan(id: string, body: Partial<Pick<RetentionPlan, 'name' | 'interval_minutes' | 'entry_guard_minutes' | 'active'>>): Observable<RetentionPlan> {
    return this.api.patch(`/admin/retention/plans/${id}`, body);
  }
  deleteRetentionPlan(id: string): Observable<unknown> { return this.api.delete(`/admin/retention/plans/${id}`); }

  createRetentionStep(planId: string, body: Partial<RetentionStep>): Observable<RetentionStep> {
    return this.api.post(`/admin/retention/plans/${planId}/steps`, body);
  }
  updateRetentionStep(id: string, body: Partial<RetentionStep>): Observable<RetentionStep> {
    return this.api.patch(`/admin/retention/steps/${id}`, body);
  }
  deleteRetentionStep(id: string): Observable<unknown> { return this.api.delete(`/admin/retention/steps/${id}`); }
  /** Полный новый порядок шагов плана (все id). */
  reorderRetentionSteps(planId: string, ids: string[]): Observable<{ steps: RetentionStep[] }> {
    return this.api.post(`/admin/retention/plans/${planId}/steps/reorder`, { ids });
  }

  /** Тест-режим: состояние прогона плана по конкретному юзеру. */
  retentionTestState(planId: string, userId: string): Observable<RetentionTestState> {
    return this.api.get(`/admin/retention/plans/${planId}/test`, { user_id: userId });
  }
  /** Тест-режим: выполнить следующий шаг (кондишены не проверяются, отправки
   *  реальные). */
  retentionTestStep(planId: string, userId: string): Observable<RetentionTestState> {
    return this.api.post(`/admin/retention/plans/${planId}/test/step`, { user_id: userId });
  }
  /** Тест-режим: сброс прогресса тест-прогона. */
  retentionTestReset(planId: string, userId: string): Observable<unknown> {
    return this.api.delete(`/admin/retention/plans/${planId}/test?user_id=${encodeURIComponent(userId)}`);
  }

  /** Журнал отправленных уведомлений (пункт «Логирование», admin-only). */
  listNotifications(query: AdminNotificationsQuery = {}): Observable<AdminNotificationsResponse> {
    const params: Record<string, string | number | undefined> = {};
    if (query.page != null) params['page'] = query.page;
    if (query.page_size != null) params['page_size'] = query.page_size;
    if (query.user_id) params['user_id'] = query.user_id;
    if (query.source) params['source'] = query.source;
    if (query.q?.trim()) params['q'] = query.q.trim();
    return this.api.get('/admin/notifications', params);
  }

  listPartners(query: AdminPartnersQuery = {}): Observable<AdminListResponse<PartnerConfig>> {
    return this.api.get('/admin/partners', this.pageParams(query));
  }
  createPartner(body: { email: string; amount: number; currency: string; level?: number; comment?: string }): Observable<PartnerConfig> {
    return this.api.post('/admin/partners', body);
  }
  updatePartner(id: string, body: Partial<PartnerConfig>): Observable<PartnerConfig> { return this.api.patch(`/admin/partners/${id}`, body); }

  /** Заявки партнёров на вывод (новые сверху; опц. фильтр по статусу).
   *  users — карта id→инфо партнёра для колонки «Партнёр». */
  listPartnerWithdrawals(query: AdminWithdrawalsQuery = {}): Observable<AdminWithdrawalsResponse> {
    const params = this.pageParams(query);
    if (query.status) params['status'] = query.status;
    return this.api.get('/admin/partners/withdrawals', params);
  }
  /** «Выплачено»: оператор перевёл деньги по реквизитам вне системы. */
  markPartnerWithdrawalPaid(id: string, comment = ''): Observable<AdminWithdrawal> {
    return this.api.post(`/admin/partners/withdrawals/${id}/paid`, { comment });
  }
  /** «Отклонить»: начисления возвращаются партнёру в pending. */
  rejectPartnerWithdrawal(id: string, comment = ''): Observable<AdminWithdrawal> {
    return this.api.post(`/admin/partners/withdrawals/${id}/reject`, { comment });
  }

  listUsers(query: AdminUsersQuery = {}): Observable<AdminListResponse<AdminUser>> {
    return this.api.get('/admin/users', this.pageParams(query));
  }
  updateUser(id: string, body: Partial<AdminUser>): Observable<AdminUser> { return this.api.patch(`/admin/users/${id}`, body); }
  /** Транзакции по картам одного пользователя (deep-link «Транзакции» из
   *  «Пользователей»; единственный путь модератора к транзакциям). */
  listUserTransactions(userId: string): Observable<AdminUserTransactionsResponse> {
    return this.api.get(`/admin/users/${userId}/transactions`);
  }

  /** Общий список транзакций по картам всех пользователей (admin-only, пункт
   *  меню «Транзакции»): пагинация + опциональный фильтр по владельцу. */
  listTransactions(query: AdminTransactionsQuery = {}): Observable<AdminTransactionsResponse> {
    const params: Record<string, string | number | undefined> = {};
    if (query.page != null) params['page'] = query.page;
    if (query.page_size != null) params['page_size'] = query.page_size;
    if (query.user_id) params['user_id'] = query.user_id;
    return this.api.get('/admin/transactions', params);
  }

  listCards(query: AdminCardsQuery = {}): Observable<AdminCardsResponse> {
    const params: Record<string, string | number | undefined> = {};
    if (query.page != null) params['page'] = query.page;
    if (query.page_size != null) params['page_size'] = query.page_size;
    if (query.status) params['status'] = query.status;
    if (query.card_product_id) params['card_product_id'] = query.card_product_id;
    if (query.promo_code_id) params['promo_code_id'] = query.promo_code_id;
    if (query.user_id) params['user_id'] = query.user_id;
    if (query.q) params['q'] = query.q;
    return this.api.get('/admin/cards', params);
  }

  /** Точечная заморозка одной выпущенной карты (active → frozen). */
  freezeCard(id: string): Observable<AdminCardStatus> { return this.api.post(`/admin/cards/${id}/freeze`, {}); }
  /** Точечная разморозка одной выпущенной карты (frozen → active). */
  unfreezeCard(id: string): Observable<AdminCardStatus> { return this.api.post(`/admin/cards/${id}/unfreeze`, {}); }
  /** Замена карты (admin-only): старая удаляется (status=deleted + удаление у
   *  issuer'а), новая выпускается под выбранную провайдер-привязку
   *  {provider, issuer_bin_id} продукта (fail-closed валидация по
   *  CardProduct.providers), баланс переносится. order_id — заявка на
   *  перевыпуск (раздел «Заявки»). */
  replaceCard(id: string, provider: string, issuerBinId: string): Observable<{ id: string; status: string; order_id: string }> {
    return this.api.post(`/admin/cards/${id}/replace`, { provider, issuer_bin_id: issuerBinId });
  }
  /** Удаление карты (admin-only): как замена, но без перевыпуска — карта
   *  помечается deleted и удаляется у issuer'а; остаток уходит на кошелёк
   *  сервиса и пользователю не компенсируется. */
  deleteCard(id: string): Observable<{ id: string; status: string }> {
    return this.api.delete(`/admin/cards/${id}`);
  }
  /** Полный номер карты (admin + moderator; карты админов модератору — 404).
   *  Каждый просмотр backend пишет в audit-лог (admin.card.pan_view).
   *  CVV endpoint не отдаёт. */
  cardPan(id: string): Observable<{ pan: string }> {
    return this.api.post(`/admin/cards/${id}/details`, {});
  }

  listOrders(query: AdminOrdersQuery = {}): Observable<AdminListResponse<AdminOrder>> {
    return this.api.get('/admin/orders', this.listParams(query));
  }
  /** eSIM-выпуски: тот же /admin/orders с product_type=esim. */
  listEsimOrders(query: AdminOrdersQuery = {}): Observable<AdminListResponse<AdminEsimOrder>> {
    return this.api.get('/admin/orders', this.listParams({ ...query, product_type: 'esim' }));
  }
  listTopups(query: AdminOrdersQuery = {}): Observable<AdminListResponse<AdminTopup>> {
    return this.api.get('/admin/topups', this.listParams(query));
  }
  /** eSIM-recharge: /admin/topups с product_type=esim. */
  listEsimRecharges(query: AdminOrdersQuery = {}): Observable<AdminListResponse<AdminEsimRecharge>> {
    return this.api.get('/admin/topups', this.listParams({ ...query, product_type: 'esim' }));
  }
  /** Сервис-заказы: /admin/topups с product_type=service. */
  listServiceOrders(query: AdminOrdersQuery = {}): Observable<AdminListResponse<AdminServiceOrder>> {
    return this.api.get('/admin/topups', this.listParams({ ...query, product_type: 'service' }));
  }
  /** Повторный выпуск по failed-заявке (деньги приняты, карта не выпущена). */
  retryOrder(id: string): Observable<unknown> { return this.api.post(`/admin/orders/${id}/retry`, {}); }
  /** Повторное зачисление по failed-пополнению. */
  retryTopup(id: string): Observable<unknown> { return this.api.post(`/admin/topups/${id}/retry`, {}); }
  /** Повторный выпуск eSIM (attempt+1 — новый ключ идемпотентности провайдера). */
  retryEsimOrder(id: string): Observable<unknown> { return this.api.post(`/admin/esim-orders/${id}/retry`, {}); }
  /** Повторный сервис-заказ (attempt+1). */
  retryServiceOrder(id: string): Observable<unknown> { return this.api.post(`/admin/service-orders/${id}/retry`, {}); }

  // ----- Провайдеры продуктов + каталоги -----

  /** Провайдеры per product_type: тумблеры provider_states + capabilities
   *  (card — read-only в этой итерации). */
  providersMeta(): Observable<ProvidersMeta> { return this.api.get('/admin/providers/meta'); }
  /** Тумблер провайдера для типа продукта. */
  setProviderEnabled(productType: string, provider: string, enabled: boolean):
    Observable<{ product_type: string; provider: string; enabled: boolean }> {
    return this.api.patch(`/admin/providers/${productType}/${provider}`, { enabled });
  }
  /** Каталог-прокси провайдер-сервиса, нормализовано [{id,label,meta}].
   *  q уходит серверу провайдера (buvei plans ~1500, fzr — тысячи SKU). */
  providerCatalog(productType: string, provider: string, q = '', country = ''):
    Observable<{ items: ProviderCatalogItem[] }> {
    const params: Record<string, string | undefined> = {};
    if (q) params['q'] = q;
    if (country) params['country'] = country;
    return this.api.get(`/admin/providers/${productType}/${provider}/catalog`, params);
  }

  // ----- eSIM-продукты -----

  /** q — поиск по названию/стране; написание роли не играет (бэкенд сжимает
   *  и запрос, и имя до букв с цифрами — «turkey 5 gb» = «turkey5gb»). */
  listEsimProducts(q = ''): Observable<{ products: AdminEsimProduct[] }> {
    return this.api.get('/admin/esim/products', { q: q.trim() || undefined });
  }
  createEsimProduct(body: Partial<AdminEsimProduct>): Observable<AdminEsimProduct> {
    return this.api.post('/admin/esim/products', body);
  }
  /** PATCH — строгий whitelist полей на бэке; шлём полный набор формы. */
  updateEsimProduct(id: string, body: Partial<AdminEsimProduct>): Observable<AdminEsimProduct> {
    return this.api.patch(`/admin/esim/products/${id}`, body);
  }
  deleteEsimProduct(id: string): Observable<unknown> { return this.api.delete(`/admin/esim/products/${id}`); }

  // ----- Сервис-продукты -----

  /** q — поиск по названию/слагу, тот же, что на витрине. */
  listServiceProducts(q = ''): Observable<{ products: AdminServiceProduct[] }> {
    return this.api.get('/admin/services/products', { q: q.trim() || undefined });
  }
  createServiceProduct(body: Partial<AdminServiceProduct>): Observable<AdminServiceProduct> {
    return this.api.post('/admin/services/products', body);
  }
  /** PATCH — whitelist на бэке; шлём полный набор whitelisted-полей формы. */
  updateServiceProduct(id: string, body: Partial<AdminServiceProduct>): Observable<AdminServiceProduct> {
    return this.api.patch(`/admin/services/products/${id}`, body);
  }
  deleteServiceProduct(id: string): Observable<unknown> { return this.api.delete(`/admin/services/products/${id}`); }

  // ----- Массовые операции по регулярке -----
  //
  // Фронт НИКОГДА не шлёт список id: он передаёт регулярку и изменённые поля,
  // а набор бэкенд строит сам — тем же правилом, что и для предпросмотра.

  bulkPreviewEsim(pattern: string, page = 1, pageSize = 20): Observable<BulkPreview<AdminEsimProduct>> {
    return this.api.post('/admin/esim/products/bulk/preview', { pattern, page, page_size: pageSize });
  }
  bulkUpdateEsim(pattern: string, patch: Partial<AdminEsimProduct>, expectedTotal: number): Observable<BulkResult> {
    return this.api.patch('/admin/esim/products/bulk', { pattern, patch, expected_total: expectedTotal });
  }
  bulkDeleteEsim(pattern: string, expectedTotal: number): Observable<BulkResult> {
    return this.api.post('/admin/esim/products/bulk/delete', { pattern, expected_total: expectedTotal });
  }
  bulkPreviewServices(pattern: string, page = 1, pageSize = 20): Observable<BulkPreview<AdminServiceProduct>> {
    return this.api.post('/admin/services/products/bulk/preview', { pattern, page, page_size: pageSize });
  }
  bulkUpdateServices(pattern: string, patch: Partial<AdminServiceProduct>, expectedTotal: number): Observable<BulkResult> {
    return this.api.patch('/admin/services/products/bulk', { pattern, patch, expected_total: expectedTotal });
  }
  bulkDeleteServices(pattern: string, expectedTotal: number): Observable<BulkResult> {
    return this.api.post('/admin/services/products/bulk/delete', { pattern, expected_total: expectedTotal });
  }

  // ----- Импорт каталога провайдера и пересчёт цен -----

  startProductImport(body: { product_type: 'esim' | 'service'; provider: string; markup_pct: number; vertical?: string }):
    Observable<ProductImportJob> {
    return this.api.post('/admin/products/import', body);
  }
  listProductImports(productType?: string): Observable<{ jobs: ProductImportJob[] }> {
    return this.api.get('/admin/products/import', productType ? { product_type: productType } : {});
  }
  getProductImport(id: string): Observable<ProductImportJob> { return this.api.get(`/admin/products/import/${id}`); }
  /** Немедленный пересчёт цен динамических продуктов (не дожидаясь тика). */
  refreshPricing(): Observable<PricingStats> { return this.api.post('/admin/pricing/refresh', {}); }

  /** Краткий список продуктов типа для мультиселектов (промокоды и т.п.). */
  productsBrief(productType: string): Observable<{ items: ProductBrief[] }> {
    return this.api.get('/admin/products/brief', { product_type: productType });
  }

  private listParams(query: AdminOrdersQuery): Record<string, string | number | undefined> {
    const params: Record<string, string | number | undefined> = {};
    if (query.page != null) params['page'] = query.page;
    if (query.page_size != null) params['page_size'] = query.page_size;
    if (query.status) params['status'] = query.status;
    if (query.q) params['q'] = query.q;
    if (query.product_type) params['product_type'] = query.product_type;
    return params;
  }

  // pageParams — общий сборщик для списков с пагинацией page/page_size + опц. q
  // (промо / партнёры / пользователи). Пустые значения не отправляем.
  private pageParams(query: { page?: number; page_size?: number; q?: string }): Record<string, string | number | undefined> {
    const params: Record<string, string | number | undefined> = {};
    if (query.page != null) params['page'] = query.page;
    if (query.page_size != null) params['page_size'] = query.page_size;
    if (query.q?.trim()) params['q'] = query.q.trim();
    return params;
  }

  stats(): Observable<{ users: number; cards: number; orders: number; orders_paid: number }> { return this.api.get('/admin/stats'); }

  /** Остаток кошелька issuer-аккаунта (деньги СЕРВИСА, с которых идут выпуск
   *  карт, funding пополнений и комиссии провайдера) — admin-only, ходит
   *  живьём в card-issuer. 502/503 = issuer недоступен или не настроен. */
  issuerBalance(): Observable<IssuerBalance> { return this.api.get('/admin/balance'); }

  getReferralConfig(): Observable<ReferralConfig> { return this.api.get('/admin/referral/config'); }
  updateReferralConfig(body: Partial<ReferralConfig>): Observable<ReferralConfig> {
    return this.api.patch('/admin/referral/config', body);
  }

  // ----- Referral / partners leaderboards -----

  /** Топ рефоводов с агрегатами: invited / paid_cards / total_paid / pending_amount.
   *  Сортировка фиксированная — total_paid DESC, invited DESC. Пагинация limit/offset.
   *  q — подстрока для поиска по email/имени/username/referral_code (case-insensitive). */
  referralLeaders(limit = 50, offset = 0, q = ''): Observable<LeadersResponse> {
    const params: Record<string, string | number> = { limit, offset };
    if (q.trim()) params['q'] = q.trim();
    return this.api.get('/admin/referral/leaders', params);
  }

  /** Детали конкретного рефовода: профиль + payouts + список приглашённых
   *  (каждый с last_ip / last_seen_at) + audit-log самого пользователя. */
  referralUserDetails(userId: string): Observable<LeaderDetailsResponse> {
    return this.api.get(`/admin/referral/users/${userId}/details`);
  }

  /** То же, что referralLeaders, но фильтр users.referral_type = 'partner'. */
  partnersLeaders(limit = 50, offset = 0, q = ''): Observable<LeadersResponse> {
    const params: Record<string, string | number> = { limit, offset };
    if (q.trim()) params['q'] = q.trim();
    return this.api.get('/admin/partners/leaders', params);
  }

  /** Детали партнёра — то же DTO, плюс гарантия что это партнёр (иначе 404). */
  partnerUserDetails(userId: string): Observable<LeaderDetailsResponse> {
    return this.api.get(`/admin/partners/users/${userId}/details`);
  }
}

// ----- DTO для лидербордов -----

export interface LeaderUser {
  id: string;
  email?: string;
  first_name: string;
  last_name: string;
  username?: string;
  telegram_id?: number;
  referral_code: string;
  referral_type: 'ref' | 'partner';
  created_at: string;
  role?: UserRole;
  email_linked?: boolean;
}

export interface LeaderPartnerConfig {
  amount: number;
  currency: string;
  level: number;
  comment: string;
  created_at?: string;
  updated_at?: string;
}

export interface LeaderRow {
  user: LeaderUser;
  invited: number;
  paid_cards: number;
  total_paid: number;
  pending_amount: number;
  currency: string;
  last_ip: string;
  last_user_agent: string;
  last_seen_at?: string;
  partner_config?: LeaderPartnerConfig;
}

export interface LeadersResponse {
  leaders: LeaderRow[];
  total: number;
  limit: number;
  offset: number;
}

export interface InvitedUserRow {
  id: string;
  email?: string;
  first_name: string;
  last_name: string;
  username?: string;
  telegram_id?: number;
  created_at: string;
  paid_cards: number;
  last_ip: string;
  last_user_agent: string;
  last_seen_at?: string;
}

export interface AuditLogEntry {
  id: string;
  created_at: string;
  user_id?: string;
  event: string;
  ip: string;
  user_agent: string;
  meta?: Record<string, unknown>;
}

export interface LeaderDetailsResponse {
  user: LeaderUser;
  stats: {
    invited: number;
    paid_cards: number;
    total_payout: number;
    currency: string;
    pending: ReferralPendingSum[];
  };
  partner_config?: LeaderPartnerConfig;
  payouts: ReferralPayoutRow[];
  invited: InvitedUserRow[];
  audit: AuditLogEntry[];
}
