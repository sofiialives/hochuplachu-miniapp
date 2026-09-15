import { Injectable, PLATFORM_ID, computed, inject, signal } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { Observable, firstValueFrom, of, tap, catchError, map } from 'rxjs';
import { ApiService } from '../api/api.service';
import { RuntimeConfigService } from '../config/runtime-config.service';
import { AnalyticsService } from '../analytics/analytics.service';
import { parseStartParam } from './start-param';

/** Роль учётки. user — обычный (default); moderator — админ-панель с
 *  ограничениями (не видит админов и их карты); admin — полный доступ. */
export type UserRole = 'user' | 'moderator' | 'admin';

export interface User {
  id: string;
  telegram_id?: number;
  email?: string;
  email_linked: boolean;
  can_relink_email: boolean;
  first_name: string;
  last_name: string;
  username?: string;
  photo_url?: string;
  role: UserRole;
  email_notifications_enabled: boolean;
  bot_can_write: boolean;
  referral_code: string;
  referral_type: 'ref' | 'partner';
  /** ID рефовода, если пользователь зарегистрирован по реф-ссылке. */
  referred_by_id?: string;
  /** true после оформления первой карты — приветственный бонус уже потрачен. */
  referral_bonus_applied: boolean;
  /** ISO-timestamp когда показали welcome-диалог; используется чтобы не показывать повторно на других устройствах. */
  referral_welcome_seen_at?: string;
}

const TOKEN_KEY = 'hp.token';
const REF_KEY = 'hp.ref';

/** Ответ /auth/email/verify: либо готовая сессия, либо ожидание
 *  подтверждения входа в Telegram (у аккаунта привязан TG). */
export interface VerifyCodeResult {
  token?: string;
  user?: User;
  telegram_confirm?: boolean;
  approval_token?: string;
  expires_in?: number;
}

/** Ответ поллинга /auth/email/approval/poll. */
export interface ApprovalPollResult {
  status: 'pending' | 'approved' | 'denied' | 'expired';
  token?: string;
  user?: User;
}

// Минимальный тип window.Telegram.WebApp — перечисляем только то, что реально
// используем. Полный тип из @telegram-apps/sdk не тянем ради нескольких полей.
interface TelegramInset {
  top?: number;
  right?: number;
  bottom?: number;
  left?: number;
}

interface TelegramWebApp {
  initData?: string;
  initDataUnsafe?: { start_param?: string };
  ready?: () => void;
  expand?: () => void;
  requestFullscreen?: () => void;
  disableVerticalSwipes?: () => void;
  setHeaderColor?: (c: string) => void;
  setBackgroundColor?: (c: string) => void;
  setBottomBarColor?: (c: string) => void;
  platform?: string;
  isFullscreen?: boolean;
  // safeAreaInset — вырез устройства (notch/status bar); contentSafeAreaInset —
  // полоса оверлей-бара Telegram в fullscreen (плавающие «×»/«⋮»).
  safeAreaInset?: TelegramInset;
  contentSafeAreaInset?: TelegramInset;
  onEvent?: (event: string, cb: () => void) => void;
}

@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly api = inject(ApiService);
  private readonly platformId = inject(PLATFORM_ID);
  private readonly cfg = inject(RuntimeConfigService);
  private readonly analytics = inject(AnalyticsService);

  readonly user = signal<User | null>(null);
  readonly token = signal<string | null>(null);
  readonly bootstrapped = signal(false);
  readonly initData = signal<string | null>(null);
  // tgPlatform — null когда не Telegram WebApp или ещё не bootstrap'нулись.
  // Используется в BackBar и других UI-компонентах чтобы решить, мобильный
  // ли это TG-клиент: на mobile полагаемся на нативную WebApp.BackButton.
  readonly tgPlatform = signal<string | null>(null);

  readonly isAuthenticated = computed(() => this.user() !== null);
  /** Доступ в админ-панель: admin или moderator. */
  readonly isStaff = computed(() => {
    const role = this.user()?.role;
    return role === 'admin' || role === 'moderator';
  });
  readonly isTelegram = computed(() => this.initData() !== null);
  readonly isTelegramMobile = computed(() => {
    const p = this.tgPlatform();
    return p === 'android' || p === 'android_x' || p === 'ios';
  });

  async bootstrap(): Promise<void> {
    if (this.bootstrapped()) return;
    if (!isPlatformBrowser(this.platformId)) {
      this.bootstrapped.set(true);
      return;
    }
    this.captureRefFromUrl();
    const wa = (window as unknown as {
      Telegram?: { WebApp?: TelegramWebApp };
    }).Telegram?.WebApp;
    if (wa && wa.initData) {
      this.initData.set(wa.initData);
      this.tgPlatform.set(wa.platform ?? null);
      this.consumeStartParam(wa.initDataUnsafe?.start_param);
      wa.ready?.();
      // Cream-фон Mini App — светлый. Передаём цвет canvas Telegram'у:
      // setHeaderColor красит топ-бар (а в fullscreen — overlay поверх
      // status bar) в наш cream, чтобы клиент выбрал тёмные иконки
      // (battery/time/signal). setBackgroundColor — цвет overscroll'a за
      // краями контента. setBottomBarColor — нижняя зона на iOS под
      // home-indicator. Версии: setHeaderColor с 6.1 (hex с 6.9),
      // setBackgroundColor с 6.1, setBottomBarColor с 7.10.
      const bg = this.cfg.brand.colors.canvas;
      try { wa.setHeaderColor?.(bg); } catch { /* noop */ }
      try { wa.setBackgroundColor?.(bg); } catch { /* noop */ }
      try { wa.setBottomBarColor?.(bg); } catch { /* noop */ }
      // Fullscreen / expand применяем ТОЛЬКО на мобильных. На desktop /
      // web expand() растягивает окно Mini App на всю доступную высоту
      // окна Telegram — это нам не нужно, контент рассчитан на узкий
      // mobile-фрейм. Платформы по докам: android | android_x | ios —
      // мобильные; macos | tdesktop | weba | webk | unknown — нет.
      if (this.isTelegramMobile()) {
        // requestFullscreen — Bot API 8.0+ (окт. 2024), убирает верхний бар
        // Telegram. expand() — fallback для клиентов до 8.0 (тоже max-height,
        // но в пределах фрейма). disableVerticalSwipes блокирует свёртывание
        // окна свайпом вниз во время скролла каталога. Ошибки глотаем —
        // методы факультативные, ломать bootstrap из-за них нельзя.
        try { wa.requestFullscreen?.(); } catch { /* старый клиент */ }
        try { wa.expand?.(); } catch { /* noop */ }
        try { wa.disableVerticalSwipes?.(); } catch { /* noop */ }
        this.bindTelegramSafeAreas(wa);
      }
    }
    const stored = localStorage.getItem(TOKEN_KEY);
    if (stored) this.token.set(stored);
    if (!this.token() && !this.initData()) {
      this.bootstrapped.set(true);
      return;
    }
    // Mini App: первое открытие через initData → обмениваем initData на
    // bearer-токен и сохраняем в localStorage. На последующих reload'ах
    // (в т.ч. когда Telegram не отдаёт свежий initData) авторизация
    // продолжит работать по bearer'у. Если bearer уже есть — пропускаем
    // обмен, не плодим новые токены.
    if (this.initData() && !this.token()) {
      try {
        const ex = await firstValueFrom(
          this.api.post<{ token: string; user: User }>('/auth/telegram/exchange', {}),
        );
        this.setToken(ex.token);
        this.user.set(ex.user);
        // User ID в Matomo — при каждом установлении сессии (склейка визита
        // с серверной конверсией, см. AnalyticsService.setUserId).
        this.analytics.setUserId(ex.user.id);
        this.bootstrapped.set(true);
        return;
      } catch {
        // Если exchange упал (5xx / network) — не блокируем bootstrap,
        // дальше попробуем /auth/me на голом initData как раньше.
      }
    }
    try {
      const resp = await firstValueFrom(this.api.get<{ user: User }>('/auth/me'));
      this.user.set(resp.user);
      this.analytics.setUserId(resp.user.id);
    } catch (err: unknown) {
      // Сносим токен ТОЛЬКО на 401 (сессия реально истекла / отозвана).
      // На 5xx / CORS / network / timeout — токен оставляем, чтобы юзер
      // не выпадал из приложения при транзитивных сбоях бекенда.
      this.user.set(null);
      const status = (err as { status?: number } | null)?.status;
      if (status === 401) {
        this.token.set(null);
        localStorage.removeItem(TOKEN_KEY);
      }
    } finally {
      this.bootstrapped.set(true);
    }
  }

  // bindTelegramSafeAreas — публикует safe-area зоны Telegram как CSS-переменные
  // на <html>, чтобы UI мог зарезервировать под них место. В fullscreen-режиме
  // (Bot API 8.0+) контент Mini App тянется под системный status bar И под
  // оверлей-бар Telegram (плавающие «×»/«⋮» сверху). CSS env(safe-area-inset-*)
  // знает только про вырез устройства, но НЕ про оверлей-бар Telegram — без
  // этих переменных верхний бар с логотипом уезжал под кнопки Telegram
  // («иконка за экраном сверху»). Значения приходят асинхронно (fullscreen-
  // переход не мгновенный), поэтому переопубликовываем их по событиям
  // safeAreaChanged / contentSafeAreaChanged / fullscreenChanged — тем же
  // способом, что и coincat frontend.
  private bindTelegramSafeAreas(wa: TelegramWebApp): void {
    const root = document.documentElement;
    const apply = (): void => {
      this.applyInsetVars(root, '--tg-safe-area-inset', wa.safeAreaInset);
      this.applyInsetVars(root, '--tg-content-safe-area-inset', wa.contentSafeAreaInset);
    };
    apply();
    try {
      wa.onEvent?.('safeAreaChanged', apply);
      wa.onEvent?.('contentSafeAreaChanged', apply);
      wa.onEvent?.('fullscreenChanged', apply);
    } catch {
      // старые клиенты без onEvent — остаётся первичный apply()
    }
  }

  private applyInsetVars(root: HTMLElement, prefix: string, inset: TelegramInset | undefined): void {
    const px = (v: number | undefined): string => `${Number(v) || 0}px`;
    root.style.setProperty(`${prefix}-top`, px(inset?.top));
    root.style.setProperty(`${prefix}-right`, px(inset?.right));
    root.style.setProperty(`${prefix}-bottom`, px(inset?.bottom));
    root.style.setProperty(`${prefix}-left`, px(inset?.left));
  }

  setToken(token: string): void {
    this.token.set(token);
    if (isPlatformBrowser(this.platformId)) localStorage.setItem(TOKEN_KEY, token);
  }

  storeRef(code: string): void {
    if (isPlatformBrowser(this.platformId)) localStorage.setItem(REF_KEY, code);
  }

  // captureRefFromUrl — реф-код из query-строки web-захода. Раньше его ловил
  // только роут `/r/:refCode` (он же редиректил на «/»), но с лендинга кнопка
  // покупки ведёт СРАЗУ на чекаут выбранной карты — сегмент `/r/{code}` туда
  // не приделать, поэтому лендинг кладёт код в обычный `?ref=`. Обе точки
  // входа пишут в один и тот же `hp.ref` (last-touch). utm_* из этого же URL
  // ловит AnalyticsService.captureUtm.
  private captureRefFromUrl(): void {
    try {
      const code = new URLSearchParams(location.search).get('ref');
      if (code && code.trim()) this.storeRef(code.trim());
    } catch {
      /* приватный режим / нет location — реф просто не сохранится */
    }
  }

  // consumeStartParam — разбирает Telegram start_param (формат описан в
  // ./start-param.ts) и распределяет содержимое: ref складываем в localStorage
  // (как при web-заходе /r/:refCode — обе точки входа сходятся в hp.ref),
  // utm_* отдаём AnalyticsService для записи в
  // first_touch / last (теми же ключами, что URL UTM). Backend независимо
  // парсит payload.StartParam и привязывает рефа при FindOrCreateByTelegram —
  // фронту он нужен в основном для последующего email-flow и аналитики.
  private consumeStartParam(raw: string | undefined): void {
    const parsed = parseStartParam(raw);
    if (parsed['ref']) this.storeRef(parsed['ref']);
    const utm: Record<string, string> = {};
    for (const [k, v] of Object.entries(parsed)) {
      if (k.startsWith('utm_') && v) utm[k] = v;
    }
    this.analytics.mergeUtm(utm);
  }

  readRef(): string | null {
    if (!isPlatformBrowser(this.platformId)) return null;
    return localStorage.getItem(REF_KEY);
  }

  clearRef(): void {
    if (isPlatformBrowser(this.platformId)) localStorage.removeItem(REF_KEY);
  }

  requestCode(email: string): Observable<unknown> {
    return this.api.post('/auth/email/request', { email, ref: this.readRef() ?? '' });
  }

  verifyCode(email: string, code: string): Observable<VerifyCodeResult> {
    return this.api.post<VerifyCodeResult>('/auth/email/verify', {
      email,
      code,
      ref: this.readRef() ?? '',
    }).pipe(
      tap((res) => {
        // При telegram_confirm сессии ещё нет — токен придёт из pollApproval.
        if (res.token && res.user) {
          this.setToken(res.token);
          this.user.set(res.user);
          // Логин mid-визита (гость пришёл с UTM, авторизовался по email):
          // setUserId+ping доклеивают uid к уже идущему визиту.
          this.analytics.setUserId(res.user.id);
          this.clearRef();
        }
      }),
    );
  }

  /** Опрос статуса telegram-подтверждения входа; на approved backend один раз
   *  отдаёт bearer — сохраняем его как обычную сессию. */
  pollApproval(approvalToken: string): Observable<ApprovalPollResult> {
    return this.api.post<ApprovalPollResult>('/auth/email/approval/poll', {
      token: approvalToken,
    }).pipe(
      tap((res) => {
        if (res.status === 'approved' && res.token && res.user) {
          this.setToken(res.token);
          this.user.set(res.user);
          this.analytics.setUserId(res.user.id);
          this.clearRef();
        }
      }),
    );
  }

  requestLink(email: string): Observable<unknown> {
    return this.api.post('/auth/email/link', { email });
  }

  confirmLink(email: string, code: string): Observable<{ user: User }> {
    return this.api.post<{ user: User }>('/auth/email/link/confirm', { email, code }).pipe(
      tap((res) => this.user.set(res.user)),
    );
  }

  refreshMe(): Observable<User | null> {
    return this.api.get<{ user: User }>('/auth/me').pipe(
      tap((res) => this.user.set(res.user)),
      catchError(() => of(null)),
      map(() => this.user()),
    );
  }

  logout(): void {
    this.token.set(null);
    this.user.set(null);
    this.analytics.clearUserId();
    if (isPlatformBrowser(this.platformId)) localStorage.removeItem(TOKEN_KEY);
  }
}

