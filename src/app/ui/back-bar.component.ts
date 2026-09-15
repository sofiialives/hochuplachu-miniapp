import { Component, computed, inject, input } from '@angular/core';
import { BrandLogoComponent } from './brand-logo.component';
import { Location } from '@angular/common';
import { RuntimeConfigService } from '../core/config/runtime-config.service';
import { AuthService } from '../core/auth/auth.service';

@Component({
  selector: 'app-back-bar',
  standalone: true,
  imports: [BrandLogoComponent],
  template: `<header class="bar">
    @if (effectiveShowBack()) {
      <button class="back" (click)="back()" aria-label="Назад">
        <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
          <path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" d="M15 6l-6 6 6 6"/>
        </svg>
        <span>Назад</span>
      </button>
    } @else {
      <span class="spacer"></span>
    }
    <a class="brand" href="/" aria-label="На главную">
      @if (tintColor()) {
        <app-brand-logo class="brand-tint" [label]="serviceName" [ink]="tintColor()!" />
      } @else {
        <img [src]="logoUrl" [alt]="serviceName" />
      }
    </a>
    <span class="spacer"></span>
  </header>`,
  styles: [`
    /* bar — прозрачный контейнер. Кнопка «Назад» и логотип имеют свои
       pill-фоны и видны и на canvas (где body уже canvas), и на
       брендированной странице (product-detail с page-bg). */
    /* max-width = самый широкий контейнер контента (catalog: 760px) +
       такой же padding-left (var(--space-md) = 16px) как у .wrap. Это
       выставляет левую границу кнопки «Назад» ровно на линию левого
       края заголовка/карточек каталога. На страницах с более узким
       контентом (product-detail 720, checkout 560) кнопка будет
       немного левее контента — это допустимый компромисс, шире 760 на
       сервисе ничего не рисуется. */
    .bar {
      display: flex; align-items: center; justify-content: space-between;
      box-sizing: border-box;
      /* Позиционирование под Telegram fullscreen (Bot API 8.0+), как в coincat:
           • padding-top = только системный status bar / notch
             (--tg-safe-area-inset-top; вне Telegram — env()). Сдвигает бар
             вниз ровно под часы/сеть/батарею.
           • высота бара = эта полоса + полоса оверлей-бара Telegram с
             плавающими «×»/«⋮» (--tg-content-safe-area-inset-top). Логотип
             центрируется по вертикали (align-items: center) ВНУТРИ этой
             полосы и встаёт на одну линию с кнопками Telegram — «между
             кнопками», а не под ними.
         Переменные ставит AuthService из WebApp API и обновляет по событиям
         safeAreaChanged/contentSafeAreaChanged. Вне Telegram content-inset не
         задан → фолбэк 72px даёт прежнюю высоту бара (12+48+12). */
      padding: 84px 22px 42px;
      min-height: calc(
        max(var(--tg-safe-area-inset-top, 0px), env(safe-area-inset-top, 0px))
        + var(--tg-content-safe-area-inset-top, 72px)
      );
      background: transparent;
      max-width: 760px; margin: 0 auto; width: 100%;
    }
    .back {
      display: inline-flex; align-items: center; gap: 4px;
      /* padding-left маленький: chevron SVG имеет ~37% пустоты слева
         от пути (path начинается с x=9 в 24-wide viewBox) — большой
         padding-left делал бы зазор перед стрелкой непропорционально
         большим. Компенсируем тут. */
      padding: 8px 14px 8px 4px; border-radius: var(--rounded-pill);
      background: var(--color-surface-card); color: var(--color-ink);
      font-weight: 500; font-size: 14px;
    }
    .back:hover { background: var(--color-surface-soft, var(--color-surface-card)); }
    .brand { display: inline-flex; align-items: center; }
    .brand img { width: 132px; display: block; object-fit: contain; }
    /* brand-tint — логотип, перекрашенный под цвет заголовка брендированной
       страницы. Красятся ТОЛЬКО тёмные заливки (надпись), фирменный акцент
       остаётся своим цветом; если логотип не SVG — BrandLogoComponent
       откатывается на маску и красит силуэт целиком, как было раньше. */
    .brand .brand-tint { height: 48px; width: 48px; }
    .spacer { width: 92px; }

     @media (min-width: 1024px) {
        .brand img { width: 168px; display: block; object-fit: contain; }
        .bar { padding: 52px 0 68px; }
    }
  `],
})
export class BackBarComponent {
  private readonly location = inject(Location);
  private readonly cfg = inject(RuntimeConfigService);
  private readonly auth = inject(AuthService);
  readonly showBack = input<boolean>(true);
  // tintColor — если задан, рендерим логотип перекрашенным (нужно на
  // брендированных страницах, где hex-цвет заголовков надо повторить в
  // шапке). Null/undefined = обычный <img> в натуральных цветах.
  readonly tintColor = input<string | null>(null);
  // effectiveShowBack — на мобильном Telegram прячем нашу in-DOM кнопку,
  // т.к. её роль закрывает нативная WebApp.BackButton в системном топ-баре
  // (показ/скрытие управляется в AppComponent через router events).
  protected readonly effectiveShowBack = computed(() => this.showBack() && !this.auth.isTelegramMobile());
  protected readonly logoUrl = this.cfg.brand.logo_url;
  protected readonly serviceName = this.cfg.brand.service_name;
  back(): void { this.location.back(); }
}
