import { ApplicationConfig, provideZonelessChangeDetection, provideAppInitializer, inject, isDevMode } from '@angular/core';
import { provideRouter, withComponentInputBinding, withPreloading, withViewTransitions } from '@angular/router';
import { provideHttpClient, withFetch, withInterceptors } from '@angular/common/http';
import { provideTransloco } from '@jsverse/transloco';

import { routes } from './app.routes';
import { authInterceptor } from './core/auth/auth.interceptor';
import { errorInterceptor } from './core/errors/error.interceptor';
import { mockCatalogInterceptor } from './core/api/mock-catalog.interceptor';
import { RuntimeConfigService } from './core/config/runtime-config.service';
import { TranslocoLoader } from './core/transloco-loader';
import { AnalyticsService } from './core/analytics/analytics.service';
import { AuthService } from './core/auth/auth.service';
import { SectionPreloadStrategy } from './core/routing/section-preload.strategy';
import { VerificationService } from './core/verification/verification.service';

export const appConfig: ApplicationConfig = {
  providers: [
    provideZonelessChangeDetection(),
    // withViewTransitions — «перетекания» между роутами через нативный
    // View Transitions API; сама анимация задана CSS'ом в global.scss
    // (::view-transition-old/new). Браузеры без поддержки просто не анимируют.
    // @angular/animations не используется (deprecated в v21) — всё движение CSS.
    // onViewTransitionCreated — пропускаем анимацию перехода на каталог
    // (data:{catalog:true}): снимок нового экрана снимается ДО того, как
    // асинхронный listProducts() успевает ответить — снимок получается
    // пустым, и получалось «мигание» пустого каталога поверх старого.
    // withPreloading — чанки разделов bottom-nav догружаются в фоне (роуты с
    // `data: { preload: true }`), чтобы переключение вкладок не ждало сети.
    provideRouter(
      routes,
      withComponentInputBinding(),
      withViewTransitions({
        onViewTransitionCreated: ({ transition, to }) => {
          // to — КОРНЕВОЙ snapshot дерева маршрутов, а data:{catalog:true}
          // висит на ВЛОЖЕННОМ дочернем роуте (cards/new под ''). Спускаемся
          // до самого глубокого потомка, чтобы проверить data РЕАЛЬНО
          // смэтченного листового роута.
          let snap = to;
          while (snap.firstChild) snap = snap.firstChild;
          if (snap.data?.['catalog']) transition.skipTransition();
        },
      }),
      withPreloading(SectionPreloadStrategy),
    ),
    provideHttpClient(withFetch(), withInterceptors([mockCatalogInterceptor, authInterceptor, errorInterceptor])),
    provideTransloco({
      config: {
        availableLangs: ['ru', 'en'],
        defaultLang: 'ru',
        fallbackLang: 'ru',
        reRenderOnLangChange: true,
        prodMode: !isDevMode(),
      },
      loader: TranslocoLoader,
    }),
    provideAppInitializer(async () => {
      const cfg = inject(RuntimeConfigService);
      cfg.applyThemeFromConfig();
      cfg.applyFavicon();
      cfg.applyDocumentMeta();
      inject(AnalyticsService).bootstrap();
      const auth = inject(AuthService);
      const verification = inject(VerificationService);
      await Promise.all([
        cfg.loadPaymentInfo(),
        auth.bootstrap(),
      ]);
      // verification.refresh — после bootstrap'а: нужен user и payment.info
      // (где живёт verification_mode). В simple-режиме сервис ставит фейковый
      // ok-снапшот без сетевого запроса.
      if (auth.isAuthenticated()) {
        await verification.refresh();
      }
    }),
  ],
};