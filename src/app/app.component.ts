import { Component, DestroyRef, OnDestroy, OnInit, PLATFORM_ID, inject } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { NavigationEnd, Router, RouterOutlet } from '@angular/router';
import { Location } from '@angular/common';
import { filter, take } from 'rxjs/operators';
import { ToastsView } from './features/common/toasts.view';
import { AuthService } from './core/auth/auth.service';

// Минимальный type-stub Telegram.WebApp.BackButton — мы трогаем только
// эти три метода, остальное игнорируем чтобы не тянуть @types/telegram.
interface TgBackButton {
  show?: () => void;
  hide?: () => void;
  onClick?: (cb: () => void) => void;
  offClick?: (cb: () => void) => void;
}
interface TgWebApp { BackButton?: TgBackButton; platform?: string }

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [RouterOutlet, ToastsView],
  template: `<router-outlet />
    <app-toasts />`,
  styles: [`
    :host { display: flex; flex: 1; flex-direction: column; min-height: 100vh; }
  `],
})
export class AppComponent implements OnInit, OnDestroy {
  private readonly router = inject(Router);
  private readonly location = inject(Location);
  private readonly auth = inject(AuthService);
  private readonly platformId = inject(PLATFORM_ID);
  private readonly destroyRef = inject(DestroyRef);

  // Хендлер клика по нативной Telegram BackButton. Храним в поле, чтобы
  // в ngOnDestroy можно было точно тот же ref передать в offClick.
  private readonly onBackClick = (): void => { this.location.back(); };

  ngOnInit(): void {
    if (!isPlatformBrowser(this.platformId)) return;
    // Splash снимаем после первого NavigationEnd — к этому моменту route уже
    // отрезолвлен (включая authGuard, который ждал auth.bootstrap()) и первая
    // страница отрисована. До NavigationEnd может быть редирект /  → /login
    // через authGuard, и убрав splash раньше, мы показали бы пустой
    // router-outlet. AppInitializer (auth.bootstrap + loadPaymentInfo) тоже
    // уже отработал — иначе bootstrapApplication не зарезолвился бы.
    this.router.events
      .pipe(
        filter((e): e is NavigationEnd => e instanceof NavigationEnd),
        take(1),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe(() => this.hideSplash());

    // BackButton — только в мобильном TG. На desktop / web заменяет
    // системный «×», что нежелательно.
    if (!this.auth.isTelegramMobile()) return;
    const wa = (window as unknown as { Telegram?: { WebApp?: TgWebApp } }).Telegram?.WebApp;
    const bb = wa?.BackButton;
    if (!bb) return;
    bb.onClick?.(this.onBackClick);
    // Стартовое состояние выставляем сразу: на корневом маршруте кнопки
    // быть не должно (закрытие mini app — обязанность системного «×»).
    this.syncBackButton(bb, this.router.url);
    this.router.events
      .pipe(filter((e): e is NavigationEnd => e instanceof NavigationEnd), takeUntilDestroyed(this.destroyRef))
      .subscribe((e) => this.syncBackButton(bb, e.urlAfterRedirects));
  }

  // hideSplash — ставит класс .app-ready на <html>; CSS-правило в index.html
  // запускает opacity-переход. После окончания transition элемент полностью
  // удаляется из DOM, чтобы не висел невидимым над контентом и не ел клики
  // даже теоретически (хотя pointer-events: none уже стоит).
  private hideSplash(): void {
    const splash = document.getElementById('app-splash');
    if (!splash) return;
    document.documentElement.classList.add('app-ready');
    splash.addEventListener(
      'transitionend',
      () => splash.remove(),
      { once: true },
    );
    // Фолбэк на случай, если transitionend не выстрелит (prefers-reduced-motion,
    // ranged display-mode и т.п. — браузер может скипнуть событие).
    setTimeout(() => splash.remove(), 800);
  }

  ngOnDestroy(): void {
    if (!isPlatformBrowser(this.platformId)) return;
    const wa = (window as unknown as { Telegram?: { WebApp?: TgWebApp } }).Telegram?.WebApp;
    wa?.BackButton?.offClick?.(this.onBackClick);
    wa?.BackButton?.hide?.();
  }

  // syncBackButton — показываем нативную BackButton везде, кроме корня
  // ("/" с любыми query-params). На корне Telegram оставляет системный
  // «×» для закрытия Mini App — заменять его нашим back бессмысленно.
  private syncBackButton(bb: TgBackButton, url: string): void {
    const path = url.split('?')[0];
    if (path === '/' || path === '') bb.hide?.();
    else bb.show?.();
  }
}