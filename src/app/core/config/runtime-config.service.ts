import { HttpClient } from '@angular/common/http';
import { Injectable, PLATFORM_ID, inject, signal } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { firstValueFrom, timeout } from 'rxjs';

// Локальная копия потолка из api.service.ts: ApiService сюда не инжектится
// (циклическая зависимость — он сам читает RuntimeConfigService), а запрос
// ниже блокирует provideAppInitializer — без таймаута повисший /payment/info
// оставлял бы приложение на вечном splash-спиннере.
const BOOT_REQUEST_TIMEOUT_MS = 30_000;

// Палитра бренда — ключи совпадают с CSS-переменными --color-* в _tokens.scss
// и со структурой backend/internal/brand.Colors.
export interface BrandColors {
  primary: string;
  on_primary: string;
  ink: string;
  canvas: string;
  muted: string;
  hairline: string;
  surface: string;
  surface_card: string;
}

export interface BrandAnalytics {
  matomo_url?: string;
  matomo_site_id?: string;
  yandex_metrika_id?: string;
}

// Brand — единый JSON-конфиг внешнего вида, его читают backend и frontend
// из одного и того же URL (BRAND_CONFIG_URL). См. brand-config.example.json
// в корне монорепо для эталонной структуры.
export interface Brand {
  service_name: string;
  web_base_url: string;
  // Базовый URL публичного лендинга бренда (https://catcard.app и т.п.) —
  // там живут legal-страницы (/legal/…), на которые ссылается чекаут.
  // Поле каноническое, синхронизировано с backend internal/brand.Brand.
  landing_base_url?: string;
  logo_url: string;
  // favicon_url — необязательное; если пусто, на старте fallback'имся на logo_url
  // (см. RuntimeConfigService.applyFavicon). docker-entrypoint / sync-brand-config
  // в этом случае копируют скачанный logo, чтобы не дёргать внешний CDN дважды.
  favicon_url?: string;
  // favicon_png_url — runtime-only поле, в brand.json не пишется. Заполняется
  // docker-entrypoint/sync-brand-config когда favicon — SVG: рядом со .svg
  // кладётся PNG 256×256 для Safari/iOS (там SVG favicon игнорируется) и для
  // apple-touch-icon (PNG-only). applyFavicon добавляет оба <link>.
  favicon_png_url?: string;
  support_bot_url: string;
  knowledge_base_url: string;
  telegram_bot_username: string;
  colors: BrandColors;
  analytics: BrandAnalytics;
}

// Чат поддержки — технический параметр (как apiBaseUrl), НЕ часть brand.json:
// задаётся env-переменной CHATWOOT_HOST при старте контейнера
// (docker-entrypoint.sh) или dev-сервера (sync-brand-config.mjs). host — домен
// НАШЕГО чат-прокси cc-gochatwoot (https://chat.<домен>), а не реального
// Chatwoot. Пустое значение = веб-чат выключен, профиль показывает TG-ссылку.
export interface ChatwootConfig {
  host: string;
}

export interface RuntimeConfig {
  apiBaseUrl: string;
  brand: Brand;
  chatwoot: ChatwootConfig;
}

export interface PaymentInfo {
  receive_currency: string;
  support_bot_url?: string;
  knowledge_base_url?: string;
  /** Режим верификации, см. backend VERIFICATION_MODE. В simple фронт не
   *  рисует verification-banner/section и не делает gate перед покупкой. */
  verification_mode?: 'simple' | 'strict';
}

// Дефолтный brand на случай если runtime-config.js не загрузился (например,
// в Karma-тестах). Цвета совпадают с дефолтами _tokens.scss (язык лендинга
// hochuplachu, #FED136), чтобы UI не выглядел сломанным. Производные оттенки
// (hover/active/soft/градиент) в токенах считаются через color-mix() от этих
// восьми ключей — бренд с другим primary получает свои производные сам.
const defaultBrand: Brand = {
  service_name: 'Хочу плачу',
  web_base_url: typeof location !== 'undefined' ? location.origin : '',
  landing_base_url: '',
  logo_url: '/assets/logo.png',
  favicon_url: '',
  favicon_png_url: '',
  support_bot_url: '',
  knowledge_base_url: '',
  telegram_bot_username: '',
  colors: {
    primary: '#fed136',
    on_primary: '#3d2000',
    ink: '#212529',
    canvas: '#f8f9fa',
    muted: '#6c757d',
    hairline: '#dee2e6',
    surface: '#ffffff',
    surface_card: '#f1f3f5',
  },
  analytics: {},
};

const defaultChatwoot: ChatwootConfig = {
  host: '',
};

const defaults: RuntimeConfig = {
  apiBaseUrl: '/api/v1',
  brand: defaultBrand,
  chatwoot: defaultChatwoot,
};

@Injectable({ providedIn: 'root' })
export class RuntimeConfigService {
  private readonly platformId = inject(PLATFORM_ID);
  private readonly http = inject(HttpClient);

  readonly config: RuntimeConfig;
  readonly payment = signal<PaymentInfo | null>(null);

  constructor() {
    // Читаем window.__APP_CONFIG__, который выставляет /assets/runtime-config.js
    // синхронным <script> в <head> до парсинга <body> — значит к моменту
    // конструктора сервиса значения уже доступны.
    const src = isPlatformBrowser(this.platformId)
      ? (window as unknown as {
          __APP_CONFIG__?: { apiBaseUrl?: string; brand?: Partial<Brand>; chatwoot?: Partial<ChatwootConfig> };
        }).__APP_CONFIG__
      : undefined;
    const cfg = src ?? {};
    const inb = cfg.brand ?? {};
    const merged: RuntimeConfig = {
      apiBaseUrl: cfg.apiBaseUrl ?? defaults.apiBaseUrl,
      // Глубокий merge: пустые/отсутствующие ключи в JSON наследуют дефолт,
      // чтобы частично заполненный brand.json не оставлял UI без цвета.
      brand: {
        ...defaultBrand,
        ...inb,
        colors: { ...defaultBrand.colors, ...(inb.colors ?? {}) },
        analytics: { ...defaultBrand.analytics, ...(inb.analytics ?? {}) },
      },
      chatwoot: { ...defaultChatwoot, ...(cfg.chatwoot ?? {}) },
    };
    this.config = merged;
  }

  get brand(): Brand { return this.config.brand; }

  get chatwoot(): ChatwootConfig { return this.config.chatwoot; }

  async loadPaymentInfo(): Promise<void> {
    if (!isPlatformBrowser(this.platformId)) return;
    try {
      const r = await firstValueFrom(
        this.http
          .get<{ ok: boolean; data: PaymentInfo }>(this.config.apiBaseUrl.replace(/\/$/, '') + '/payment/info')
          .pipe(timeout(BOOT_REQUEST_TIMEOUT_MS)),
      );
      if (r?.data) this.payment.set(r.data);
    } catch {
      // оставляем payment=null; UI рендерится в нейтральном стиле
    }
  }

  /** Режим верификации (simple|strict). Дефолт simple если /payment/info
   *  ещё не загружен или backend не вернул поле. */
  get verificationMode(): 'simple' | 'strict' {
    return this.payment()?.verification_mode ?? 'simple';
  }

  // Ставит <title> и <meta name="description"> из brand.service_name.
  // Fallback для dev / Karma-тестов: inline-bootstrap в runtime-config.js
  // (синхронный <script> в <head> после <title>) делает то же самое раньше —
  // до Angular bootstrap'а, поэтому вкладка не мигает старым названием. Здесь
  // повторяем идемпотентно на случай, когда bootstrap не отработал.
  // Строка описания продублирована в inline-bootstrap'ах (sync-brand-config.mjs
  // + docker-entrypoint.sh) — держите их синхронными.
  applyDocumentMeta(): void {
    if (!isPlatformBrowser(this.platformId)) return;
    const name = (this.brand.service_name || '').trim();
    if (!name) return;
    document.title = name;
    const desc = `${name} — выпуск виртуальных карт и пополнения для оплаты зарубежных сервисов`;
    let md = document.head.querySelector<HTMLMetaElement>('meta[name="description"]');
    if (!md) {
      md = document.createElement('meta');
      md.setAttribute('name', 'description');
      document.head.appendChild(md);
    }
    md.setAttribute('content', desc);
  }

  // Применяет цвета бренда как CSS-переменные --color-{key} к html. Ключи —
  // те же, что в `_tokens.scss`, например `primary` → `--color-primary`.
  applyThemeFromConfig(): void {
    if (!isPlatformBrowser(this.platformId)) return;
    const root = document.documentElement;
    for (const [k, v] of Object.entries(this.brand.colors)) {
      if (v) root.style.setProperty(`--color-${k.replace(/_/g, '-')}`, v as string);
    }
  }

  // Перезаписывает <link rel="icon"> в <head>. Источник — brand.favicon_url
  // (если задан) или brand.logo_url как fallback. Удаляет все существующие
  // rel=icon / rel=shortcut icon / rel=apple-touch-icon, чтобы браузер не
  // продолжал показывать старую иконку из дефолтных /favicon-*.png в index.html.
  //
  // Если основной favicon — SVG, дополнительно добавляются ссылки на PNG
  // (brand.favicon_png_url, растеризуется в entrypoint/sync). Safari/iOS
  // игнорируют SVG-favicon и apple-touch-icon хочет PNG — поэтому держим оба.
  applyFavicon(): void {
    if (!isPlatformBrowser(this.platformId)) return;
    // runtime-config.js уже выполнил тот же блок до Angular bootstrap'а —
    // повторная работа заставила бы браузер заново запросить иконку. Флаг
    // ставит inline-функция в конце runtime-config.js.
    if (document.head.getAttribute('data-favicon-applied') === '1') return;
    const url = (this.brand.favicon_url || this.brand.logo_url || '').trim();
    if (!url) return;
    const head = document.head;
    head.querySelectorAll('link[rel~="icon"], link[rel="apple-touch-icon"]').forEach((el) => el.remove());

    const isSvg = /\.svg(?:[?#]|$)/i.test(url);
    const pngFallback = (this.brand.favicon_png_url || '').trim();

    const addLink = (rel: string, href: string, type?: string) => {
      const link = document.createElement('link');
      link.rel = rel;
      link.href = href;
      if (type) link.type = type;
      head.appendChild(link);
    };

    const mimeFor = (u: string): string | undefined => {
      const m = u.toLowerCase().match(/\.(png|jpg|jpeg|svg|webp|ico)(?:[?#]|$)/);
      if (!m) return undefined;
      const t = m[1];
      return t === 'svg' ? 'image/svg+xml' : t === 'ico' ? 'image/x-icon' : `image/${t === 'jpg' ? 'jpeg' : t}`;
    };

    addLink('icon', url, mimeFor(url));
    if (isSvg && pngFallback) {
      // Safari выберет первую подходящую <link> — но он же игнорирует svg-тип,
      // поэтому добавляем PNG. apple-touch-icon — отдельный тег.
      addLink('icon', pngFallback, 'image/png');
      addLink('apple-touch-icon', pngFallback);
    } else if (!isSvg) {
      // PNG/JPG/ICO — годятся для apple-touch-icon как есть.
      addLink('apple-touch-icon', url);
    }
  }
}
