import { Injectable, PLATFORM_ID, inject } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { RuntimeConfigService } from '../config/runtime-config.service';
import { parseStartParam } from '../auth/start-param';

declare const _paq: unknown[] | undefined;
declare const ym: ((id: string | number, command: string, ...args: unknown[]) => void) | undefined;

// Персист Matomo User ID (внутренний ULID юзера) между сессиями — см. блок
// «User ID» ниже. Чистится только явным logout (AuthService → clearUserId).
const UID_KEY = 'hp.matomo_uid';

@Injectable({ providedIn: 'root' })
export class AnalyticsService {
  private readonly platformId = inject(PLATFORM_ID);
  private readonly cfg = inject(RuntimeConfigService);

  bootstrap(): void {
    if (!isPlatformBrowser(this.platformId)) return;
    // Порядок важен: UTM собираем из ОБОИХ источников (URL + Telegram
    // start_param) ДО loadMatomo(), потому что кампанию нужно выставить в
    // трекер до первого trackPageView. captureTelegramUtm критичен для Mini
    // App, где меток в URL нет — они в start_param (его AuthService разбирает
    // позже и асинхронно, уже после ухода pageview → атрибуция бы потерялась).
    this.captureUtm();
    this.captureTelegramUtm();
    this.loadMatomo();
    this.loadYandex();
  }

  private captureUtm(): void {
    const params = new URLSearchParams(window.location.search);
    const utm: Record<string, string> = {};
    ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term'].forEach((k) => {
      const v = params.get(k);
      if (v) utm[k] = v;
    });
    this.mergeUtm(utm);
  }

  // captureTelegramUtm — UTM из Telegram start_param для Mini App. Читаем его
  // синхронно из window.Telegram.WebApp (SDK подключён синхронным <script> в
  // index.html, поэтому на старте appInitializer он уже доступен), парсим тем
  // же start-param.ts, что и AuthService, и складываем через mergeUtm.
  // Дублирует разбор из AuthService.consumeStartParam НАМЕРЕННО: аналитике
  // метки нужны здесь и сейчас (до trackPageView), а auth.bootstrap отрабатывает
  // позже и асинхронно. mergeUtm идемпотентен (first_touch пишется один раз),
  // поэтому двойной вызов безвреден. ref тут не трогаем — это зона AuthService.
  private captureTelegramUtm(): void {
    const wa = (window as unknown as {
      Telegram?: { WebApp?: { initDataUnsafe?: { start_param?: string } } };
    }).Telegram?.WebApp;
    const parsed = parseStartParam(wa?.initDataUnsafe?.start_param);
    const utm: Record<string, string> = {};
    for (const [k, v] of Object.entries(parsed)) {
      if (k.startsWith('utm_') && v) utm[k] = v;
    }
    this.mergeUtm(utm);
  }

  // mergeUtm — общая точка приёма UTM для разных источников: query-string
  // (captureUtm), Telegram start_param (AuthService.bootstrap), будущие
  // дип-линки. first_touch фиксируется один раз и больше не перезаписывается,
  // last — каждый заход. Принимает уже-отфильтрованный набор utm_*.
  mergeUtm(utm: Record<string, string>): void {
    if (!isPlatformBrowser(this.platformId)) return;
    if (Object.keys(utm).length === 0) return;
    if (!localStorage.getItem('hp.utm_first_touch')) {
      localStorage.setItem('hp.utm_first_touch', JSON.stringify(utm));
    }
    localStorage.setItem('hp.utm_last', JSON.stringify(utm));
  }

  // paq — очередь клиентского Matomo-трекера (создаём при первом обращении;
  // matomo.js разбирает её после загрузки, поэтому пуши безопасны в любой
  // момент). null — аналитика в brand.json не настроена, все вызовы no-op.
  private paq(): unknown[][] | null {
    if (!this.cfg.brand.analytics.matomo_url || !this.cfg.brand.analytics.matomo_site_id) return null;
    const w = window as unknown as { _paq?: unknown[][] };
    w._paq = w._paq ?? [];
    return w._paq;
  }

  private loadMatomo(): void {
    const url = this.cfg.brand.analytics.matomo_url;
    const siteId = this.cfg.brand.analytics.matomo_site_id;
    const _paq = this.paq();
    if (!url || !siteId || !_paq) return;
    // User ID прошлой сессии — тоже ДО первого trackPageView: у вернувшегося
    // юзера визит должен нести uid с первого же хита, иначе он останется
    // анонимным и не склеится с серверной конверсией (ping уже идущий визит
    // такого юзера не подхватывает — см. блок «User ID» ниже).
    const uid = this.readPersistedUserId();
    if (uid) {
      this.lastUserId = uid;
      _paq.push(['setUserId', uid]);
    }
    // Кампания ДОЛЖНА встать в трекер до первого trackPageView, иначе pageview
    // уйдёт без атрибуции. setTrackerUrl/setSiteId Matomo применяет первыми
    // независимо от позиции в очереди, а setCustomUrl/setCampaign*/
    // setCustomVariable — строго по порядку, поэтому они идут выше trackPageView.
    this.applyMatomoCampaign(_paq);
    _paq.push(['trackPageView']);
    _paq.push(['enableLinkTracking']);
    _paq.push(['setTrackerUrl', url + '/matomo.php']);
    _paq.push(['setSiteId', siteId]);
    const g = document.createElement('script');
    g.async = true;
    g.src = url.replace(/\/$/, '') + '/matomo.js';
    document.head.appendChild(g);
  }

  // applyMatomoCampaign — прокидывает кампанию из UTM в КЛИЕНТСКИЙ Matomo, чтобы
  // pageview этого визита нёс источник (иначе кампания в Matomo появлялась
  // только на серверной ecommerce-конверсии от backend при paid, а клиентские
  // визиты/воронка до покупки шли без атрибуции).
  //
  // Matomo из коробки читает кампанию только из URL страницы (utm_campaign/
  // utm_term с разделителями =/&). В Telegram Mini App их там нет — метки
  // приходят в start_param в формате "utm_source-telegram--utm_campaign-...".
  // Поэтому:
  //   1) явно фиксируем ключи кампании (не полагаясь на серверный
  //      Config.campaignNameKeys, который админ мог переопределить);
  //   2) подсовываем восстановленный URL через setCustomUrl — из него Matomo
  //      считывает кампанию и сам вырезает utm-параметры из page URL после
  //      атрибуции;
  //   3) source/medium дублируем в visit-scope custom variables (слоты 5/6) —
  //      теми же слотами, что серверная конверсия (analytics_client.go), чтобы
  //      клиентский визит и backend-покупка сходились по источнику.
  // Берём first-touch (getUtm), как и backend (User.UTMFirstTouch) — иначе
  // визит и конверсия одного юзера разошлись бы по кампании. Всё ставится ДО
  // trackPageView (см. loadMatomo). Нет utm_campaign — no-op.
  private applyMatomoCampaign(paq: unknown[][]): void {
    const utm = this.getUtm();
    if (!utm['utm_campaign']) return;
    paq.push(['setCampaignNameKey', 'utm_campaign']);
    paq.push(['setCampaignKeywordKey', 'utm_term']);
    if (utm['utm_source']) paq.push(['setCustomVariable', 5, 'utm_source', utm['utm_source'], 'visit']);
    if (utm['utm_medium']) paq.push(['setCustomVariable', 6, 'utm_medium', utm['utm_medium'], 'visit']);
    paq.push(['setCustomUrl', this.buildCampaignUrl(utm)]);
  }

  // buildCampaignUrl — чистый URL текущей страницы (origin + path) с добавленными
  // utm-параметрами и БЕЗ служебных query Telegram (tgWebApp*), чтобы Matomo
  // увидел кампанию и не тащил телеграмный мусор в page-отчёты.
  private buildCampaignUrl(utm: Record<string, string>): string {
    const base = window.location.origin + window.location.pathname;
    const qs = new URLSearchParams();
    ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term'].forEach((k) => {
      if (utm[k]) qs.set(k, utm[k]);
    });
    const q = qs.toString();
    return q ? base + '?' + q : base;
  }

  private loadYandex(): void {
    const id = this.cfg.brand.analytics.yandex_metrika_id;
    if (!id) return;
    const g = document.createElement('script');
    g.async = true;
    g.innerHTML = `
      (function(m,e,t,r,i,k,a){m[i]=m[i]||function(){(m[i].a=m[i].a||[]).push(arguments)};
      m[i].l=1*new Date();
      for (var j = 0; j < document.scripts.length; j++) {if (document.scripts[j].src === r) { return; }}
      k=e.createElement(t),a=e.getElementsByTagName(t)[0],k.async=1,k.src=r,a.parentNode.insertBefore(k,a)})
      (window, document, "script", "https://mc.yandex.ru/metrika/tag.js", "ym");
      ym(${id}, "init", {clickmap:true, trackLinks:true, accurateTrackBounce:true, ecommerce:"dataLayer"});
    `;
    document.head.appendChild(g);
  }

  // ── Конверсии ───────────────────────────────────────────────────────────
  //
  // ВАЖНО: событие «покупка» должно фиксироваться в момент РЕАЛЬНОЙ оплаты, а
  // не создания заявки. Поэтому здесь больше НЕТ trackCardPurchase/trackTopUp,
  // которые раньше стреляли из checkout/topup сразу после /orders/issue (до
  // оплаты). Разделение как в coincat:
  //   • Matomo-покупка + выручка — серверные (backend шлёт Matomo ecommerce
  //     при переходе заявки в paid; visitor id прокидываем через
  //     getMatomoVisitorId в теле создания заявки для атрибуции).
  //   • Яндекс.Метрика — клиентская цель, но её вызывают ТОЛЬКО в точке
  //     реального завершения: payment.page при isPaid(), либо checkout/topup для
  //     мгновенно-оплаченных (free / промокод покрыл всё). Выручку в цель не
  //     кладём — она живёт в серверном Matomo (ключ revenue в reachGoal-params
  //     Метрика как ценность цели без спец-настройки всё равно не учитывает).

  // reachGoalCardPurchase — Яндекс-цель «карта куплена», идемпотентно по orderId.
  // Дедуп персистентный (localStorage): повторный заход на страницу оплаты
  // (кнопка «назад», back-stack Mini App, закладка) НЕ задваивает конверсию —
  // component-lifetime-флага мало, т.к. при revisit создаётся новый инстанс.
  reachGoalCardPurchase(orderId: string): void {
    this.reachGoalOnce('card_purchase', 'order:' + orderId);
  }

  // reachGoalTopUp — Яндекс-цель «пополнение оплачено», идемпотентно по topupId.
  reachGoalTopUp(topupId: string): void {
    this.reachGoalOnce('topup_success', 'topup:' + topupId);
  }

  private reachGoalOnce(goal: string, dedupKey: string): void {
    if (!isPlatformBrowser(this.platformId)) return;
    const k = 'hp.goal_sent.' + dedupKey;
    try {
      if (localStorage.getItem(k)) return;
      localStorage.setItem(k, '1');
    } catch {
      // приватный режим / недоступный storage — пусть цель выстрелит (в худшем
      // случае задвоится при revisit, что лучше полной потери конверсии).
    }
    const id = this.cfg.brand.analytics.yandex_metrika_id;
    if (id && typeof ym !== 'undefined') {
      ym(id, 'reachGoal', goal);
    }
  }

  // getUtm — метки первого касания (hp.utm_first_touch, fallback hp.utm_last)
  // из localStorage для проброса на backend при создании заявки. Backend
  // сохраняет их на юзере и атрибутирует серверную конверсию к кампании. Это
  // единственный способ донести utm Telegram Mini App (там метки приходят в
  // start_param → mergeUtm → localStorage, минуя URL, который читают счётчики).
  getUtm(): Record<string, string> {
    if (!isPlatformBrowser(this.platformId)) return {};
    try {
      const raw = localStorage.getItem('hp.utm_first_touch') || localStorage.getItem('hp.utm_last');
      if (!raw) return {};
      const o = JSON.parse(raw);
      return o && typeof o === 'object' ? (o as Record<string, string>) : {};
    } catch {
      return {};
    }
  }

  // ── User ID (склейка клиентского визита с серверной конверсией) ─────────
  //
  // Backend шлёт серверную ecommerce-конверсию с uid = внутренний ULID юзера
  // (analytics_client.go: uid = PurchaseEvent.UserID). Matomo при дефолтном
  // enable_userid_overwrites_visitorid деривит visitor id из uid, игнорируя
  // клиентский _id, поэтому склейка возможна ТОЛЬКО когда клиентские хиты несут
  // тот же uid. Стратегия из двух частей (как в coincat: matomo_uid в
  // localStorage + setUserId на старте):
  //   1) uid персистится (hp.matomo_uid) и ставится в loadMatomo ДО первого
  //      trackPageView — в каждой следующей сессии визит живёт под uid-визитёром
  //      с первого же хита, и серверная конверсия попадает прямо в него.
  //   2) при логине посреди анонимного визита setUserId шлёт setUserId+ping:
  //      SPA не трекает route-переходы, и без немедленного хита uid не доехал бы
  //      до Matomo до следующей перезагрузки. Ping «захватывает» идущий
  //      анонимный визит (Matomo матчит его по fingerprint и переписывает
  //      visitor id) — это работает в первую идентифицированную сессию юзера;
  //      у вернувшегося юзера ping идущий анонимный визит НЕ подхватывает
  //      (github.com/matomo-org/matomo/issues/19927) — эти сессии закрывает
  //      пункт 1.
  //
  // setUserId вызывается из AuthService при КАЖДОМ установлении сессии:
  // bootstrap (Telegram exchange / bearer + /auth/me) и оба email-флоу
  // (verifyCode, pollApproval) — в т.ч. когда юзер пришёл с UTM ещё гостем и
  // авторизовался позже по email: кампания уже висит на визите
  // (applyMatomoCampaign), а uid доклеивается этим вызовом. Идемпотентно по
  // значению: повторные вызовы с тем же id лишних ping'ов не шлют.
  setUserId(userId: string): void {
    if (!isPlatformBrowser(this.platformId)) return;
    if (!userId) return;
    try {
      localStorage.setItem(UID_KEY, userId);
    } catch {
      // приватный режим — останется только mid-визит-склейка через ping
    }
    if (userId === this.lastUserId) return;
    const paq = this.paq();
    if (!paq) return;
    this.lastUserId = userId;
    paq.push(['setUserId', userId]);
    paq.push(['ping']);
  }

  // clearUserId — сброс User ID при logout (включая персист), чтобы дальнейшие
  // гостевые хиты и следующие сессии не приписывались разлогиненному аккаунту.
  clearUserId(): void {
    if (!isPlatformBrowser(this.platformId)) return;
    this.lastUserId = null;
    try {
      localStorage.removeItem(UID_KEY);
    } catch {
      // noop
    }
    this.paq()?.push(['resetUserId']);
  }

  private lastUserId: string | null = null;

  private readPersistedUserId(): string {
    try {
      return localStorage.getItem(UID_KEY) ?? '';
    } catch {
      return '';
    }
  }

  // getMatomoVisitorId — 16-hex visitor id Matomo-трекера для серверной
  // атрибуции конверсии. Читается асинхронно (Matomo исполняет запушенную в
  // _paq функцию с трекером как this); при незагруженном/выключенном Matomo
  // или таймауте возвращает '' — backend в этом случае деривит _id из user_id.
  getMatomoVisitorId(timeoutMs = 800): Promise<string> {
    if (!isPlatformBrowser(this.platformId)) return Promise.resolve('');
    if (!this.cfg.brand.analytics.matomo_url || typeof _paq === 'undefined') {
      return Promise.resolve('');
    }
    return new Promise<string>((resolve) => {
      let done = false;
      const finish = (v: string): void => {
        if (done) return;
        done = true;
        resolve(v || '');
      };
      try {
        (_paq as unknown[]).push([
          function (this: { getVisitorId?: () => string }): void {
            finish(typeof this.getVisitorId === 'function' ? this.getVisitorId() : '');
          },
        ]);
      } catch {
        finish('');
      }
      setTimeout(() => finish(''), timeoutMs);
    });
  }
}
