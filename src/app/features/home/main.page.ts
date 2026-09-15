import { Component, OnDestroy, OnInit, PLATFORM_ID, computed, inject, signal } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { RouterLink } from '@angular/router';
import { BackBarComponent } from '../../ui/back-bar.component';
import { ButtonComponent } from '../../ui/button.component';
import { AuthService } from '../../core/auth/auth.service';
import { CardsApi } from '../../core/api/cards.api';
import { OrdersApi, clearIssuingOrderId, readIssuingOrderId } from '../../core/api/orders.api';
import { CatalogApi, CatalogSections } from '../../core/api/catalog.api';
import { EsimApi, EsimDirection } from '../../core/api/esim.api';
import { HERO_SERVICE_SLUG, ServicesApi, ServiceProduct } from '../../core/api/services.api';
import { ServiceHeroCard } from '../services/service-hero-card';
import { ReferralBanner } from '../profile/referral-banner';
import { ReferralDialog } from '../profile/referral.dialog';
import { formatAmount } from '../../core/currency/currency-symbols';

// MainPage — главная-агрегатор «/»: hero карт (акцент), реф-баннер, секции
// eSIM и Сервисы по GET /catalog/sections + каталогам. Редиректов с «/» нет —
// авто-резюм KYC в app-shell привязан к этому пути.
//
// .card (только eSIM) 1:1 из esim-directions.component.ts. .svc-card и
// app-service-hero-card — свои независимые стили (не унифицированы с .card).
@Component({
  selector: 'app-main',
  standalone: true,
  imports: [BackBarComponent, ButtonComponent, RouterLink, ReferralBanner, ReferralDialog, ServiceHeroCard],
  template: `<app-back-bar [showBack]="false" />
    <section class="wrap">
      <!-- ===== Hero карт =====
           Виджет статуса выпуска живёт и здесь, и на /cards; при наличии
           карт показывается ВМЕСТЕ с компакт-виджетом (вторая карта). -->
      @if (isAuthed() && issuingOrderId()) {
        <div class="hero hero--issuing">
          <svg class="hero-spin" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" aria-hidden="true">
            <path d="M21 12a9 9 0 1 1-6.219-8.56" />
          </svg>
          <div class="hero-body">
            <div class="hero-title">Карта выпускается…</div>
            <div class="hero-sub">Обычно это занимает несколько минут</div>
          </div>
          <a class="hero-cta" routerLink="/cards"><app-button variant="secondary">К картам</app-button></a>
        </div>
      }
      @if (isAuthed() && cards().length > 0) {
        <a class="hero hero--cards" routerLink="/cards">
          <div class="hero-visual" aria-hidden="true">
            <div class="mini-card"></div>
            @if (cards().length > 1) { <div class="mini-card mini-card--back"></div> }
          </div>
          <div class="hero-body">
            <div class="hero-title">Мои карты</div>
            <div class="hero-sub">{{ cardsCountLabel() }} · пополнение и реквизиты</div>
          </div>
          <span class="hero-arr" aria-hidden="true">→</span>
        </a>
      } @else if (!isAuthed() || !issuingOrderId()) {
        <div class="top-row">
          <div class="hero hero--promo">
            <div class="hero-body">
              <div class="hero-title">Виртуальные карты</div>
              <div class="hero-sub">Выпустите карту для оплаты зарубежных сервисов за пару минут</div>
            </div>
            <a class="hero-cta" [routerLink]="isAuthed() ? '/cards/new' : '/cards'">
              <app-button variant="primary">Выпустить карту</app-button>
            </a>
          </div>
          @if (isAuthed()) {
            <app-referral-banner (clicked)="showReferral.set(true)" />
          }
        </div>
      } @else {
        @if (isAuthed()) {
          <app-referral-banner (clicked)="showReferral.set(true)" />
        }
      }

      <!-- ===== Секция eSIM ===== -->
      <div class="sec-head">
        <h2>eSIM для путешествий</h2>
        @if (esimAvailable()) { <a class="sec-link" routerLink="/esim">Все тарифы →</a> }
      </div>
      @if (!sections()) {
        <div class="skel-grid" role="status" aria-label="Загрузка">
          <span class="skel"></span><span class="skel"></span>
        </div>
      } @else if (!esimAvailable()) {
        <div class="soon">
          <div class="soon-title">Раздел в разработке</div>
          <div class="soon-sub">Скоро здесь появятся eSIM-тарифы для поездок</div>
        </div>
      } @else if (esimLoading()) {
        <div class="skel-grid" role="status" aria-label="Загрузка тарифов">
          <span class="skel"></span><span class="skel"></span>
        </div>
      } @else {
        <div class="esim-grid stagger-in">
          @for (d of topEsim(); track d.code) {
            <a class="card" [routerLink]="['/esim', 'direction', d.code]">
              <span class="ico">
                @if (d.flag) {
                  <img class="flag" [src]="'/assets/flags/' + d.flag + '.svg'" [alt]="d.name" loading="lazy" />
                } @else {
                  <span class="emoji">{{ d.emoji || '🌍' }}</span>
                }
              </span>
              <span class="name-block">
                <span class="name">{{ d.name }}</span>
                <span class="cnt">{{ d.plans }} {{ plansLabel(d.plans) }}</span>
              </span>
              <span class="from">от {{ money(d.min_price, d.currency) }}</span>
            </a>
          }
          @if (topEsim().length === 0) {
            <div class="soon"><div class="soon-sub">Тарифы скоро появятся</div></div>
          }
        </div>
      }

      <!-- ===== Секция Сервисы ===== -->
      <div class="sec-head">
        <h2>Пополнение сервисов</h2>
        @if (servicesAvailable()) { <a class="sec-link" routerLink="/services">Все сервисы →</a> }
      </div>
      @if (!sections()) {
        <div class="skel-grid" role="status" aria-label="Загрузка">
          <span class="skel"></span><span class="skel"></span>
        </div>
      } @else if (!servicesAvailable()) {
        <div class="soon">
          <div class="soon-title">Раздел в разработке</div>
          <div class="soon-sub">Скоро здесь появятся пополнение Steam и гифткарты</div>
        </div>
      } @else if (servicesLoading()) {
        <div class="skel-grid" role="status" aria-label="Загрузка сервисов">
          <span class="skel"></span><span class="skel"></span>
        </div>
      } @else {
        @if (gridServices().length > 0 || heroService()) {
          <div class="svc-grid stagger-in">
            @if (heroService(); as h) {
              <app-service-hero-card [product]="h" />
            }
            @for (s of gridServices(); track s.id) {
              <a class="svc-card" [routerLink]="['/services', s.slug]">
                @if (s.featured) { <span class="svc-hot">Популярно</span> }
                @if (s.icon_url) {
                  <img class="svc-ico" [src]="s.icon_url" [alt]="s.name" loading="lazy" />
                } @else {
                  <span class="svc-ico svc-ico--stub" aria-hidden="true">{{ s.name.charAt(0) }}</span>
                }
                <span class="svc-name">{{ s.name }}</span>
              </a>
            }
          </div>
        } @else {
          <div class="soon"><div class="soon-sub">Сервисы скоро появятся</div></div>
        }
      }

      @if (showReferral()) {
        <app-referral-dialog (closed)="showReferral.set(false)" />
      }
    </section>`,
  styles: [`
    .wrap {
      padding: 0 52px;
      max-width: 1200px; margin: 0 auto;
      display: flex; flex-direction: column;
    }
    h2 { font-size: 24px; min-width: 0; }
    /* min-width:0 — без него flex-item (h2 внутри .sec-head) по
       умолчанию не сжимается меньше своего контента (min-width:auto) —
       именно это толкало .sec-link за пределы экрана на обычной
       мобилке, а не только совсем узкой (<375px). Уменьшенный шрифт —
       для мобилки вообще, не только <375px: 24px крупного display-шрифта
       капсом рядом с "Все тарифы →" не помещался и на обычных мобильных
       ширинах (375-767px), не только на самых узких. */
    @media (max-width: 767px) {
      h2 { font-size: 19px; }
    }

    /* ===== Hero карт ===== */
    .hero {
      display: flex; align-items: center; gap: var(--space-md);
      padding: 22px 18px;
      border-radius: var(--rounded-xl);
      border: 1px solid color-mix(in srgb, var(--color-primary) 24%, var(--color-hairline-soft));
      box-shadow: var(--shadow-card);
      text-decoration: none; color: var(--color-ink);
    }
    a.hero { transition: transform var(--dur-quick) var(--ease-out), box-shadow var(--dur-quick) ease; }
    a.hero:hover { transform: translateY(-2px); box-shadow: var(--shadow-card-hover); }
    /* Был битый селектор "hero--promo." (без точки перед именем класса) —
       правило целиком игнорировалось браузером, flex-wrap никогда не
       применялся. Плюс на узких экранах flex-wrap один не спасает —
       кнопка (flex:0 0 auto) не сжимается и не переносится сама по себе,
       текст .hero-body просто выдавливается в узкую колонку (разрыв по
       одному слову на строку). Ниже, в @media (max-width:374px),
       .hero--promo целиком переключается на колонку — текст и кнопка
       друг под другом, а не в тесном ряду. */
    .hero--promo { background-color: white; box-shadow: 0px 26.44px 62.98px -21.64px rgba(0, 0, 0, 0.15); }
    .hero-body { flex: 1; min-width: 0; }
    .hero-title { font-family: var(--font-display); font-size: 20px; font-weight: 700; line-height: 1.2; }
    .hero-sub { color: rgba(0, 0, 0, 1); font-size: 16px; margin-top: 4px; }
    .hero-cta { text-decoration: none; flex: 0 0 auto; }
    .hero-arr { color: var(--color-muted); font-size: 22px; }
    .hero-spin {
      width: 36px; height: 36px; flex: 0 0 36px;
      color: var(--color-primary-ink);
      animation: main-spin 1.2s linear infinite; transform-origin: 50% 50%;
    }
    @keyframes main-spin { to { transform: rotate(360deg); } }
    @media (prefers-reduced-motion: reduce) { .hero-spin { animation: none; } }
    /* Мини-стопка карт в hero. */
    .hero-visual { position: relative; width: 72px; height: 48px; flex: 0 0 72px; }
    .mini-card {
      position: absolute; inset: 0;
      border-radius: 8px;
      background: linear-gradient(135deg, #2563eb 0%, #0c1e5d 100%);
      box-shadow: 0 4px 12px rgba(20,20,19,.18);
    }
    .mini-card--back {
      transform: translate(8px, -8px) rotate(4deg);
      background: linear-gradient(135deg, #181715 0%, #2d2a25 100%);
      z-index: -1;
    }

    /* ===== Секции ===== */
    .sec-head {
      display: flex; align-items: center; justify-content: space-between;
      margin-top: 0;
      gap: 4px 12px;
    }
    /* Колонкой на мобилке — flex-wrap не помог: перенос ФЛЕКС-ЭЛЕМЕНТОВ
       и перенос ТЕКСТА внутри одного из них (h2 на 2 строки) считаются
       независимо, из-за чего .sec-link цеплялся к правому краю ВТОРОЙ
       строки заголовка, а не уходил под весь заголовок целиком. Колонка
       — предсказуемо и без сюрпризов: h2 и ссылка друг под другом
       всегда, при любой длине заголовка. */
    @media (max-width: 767px) {
      .sec-head { flex-direction: column; align-items: flex-start; gap: 4px; }
    }
    .sec-link { color: rgba(137, 137, 137, 1); font-size: 16px; font-weight: 500; text-decoration: none; white-space: nowrap; }
    .sec-link:hover { text-decoration: underline; }
    .top-row {
      display: flex; flex-direction: column;
      gap: 16px;
      margin-bottom: 36px;
    }
    @media (min-width: 1024px) {
      .top-row { flex-direction: row; align-items: stretch; gap: 20px; }
      .top-row > * { flex: 1; min-width: 0; }
    }
    .soon {
      padding: var(--space-lg) var(--space-md);
      border: 2px dashed color-mix(in srgb, var(--color-ink) 22%, transparent);
      border-radius: var(--rounded-lg);
      text-align: center;
      background: var(--color-surface);
      margin-bottom: 36px;
    }
    .soon-title { font-weight: 600; }
    .soon-sub { color: var(--color-muted); font-size: 13px; margin-top: 4px; }

    /* ===== eSIM + Сервисы — .card 1:1 из esim-directions.component.ts =====
       Тот же класс, те же правила, те же 4 адаптивных состояния карточки
       (<375 / 375–499 / 500–1023 / ≥1024), переиспользуется здесь для
       .esim-grid и .svc-grid — раньше это были два похожих, но не идентичных
       набора правил (.esim-card / .svc-card) без переноса брейкпоинтов;
       теперь сам «.card» и его брейкпоинты скопированы дословно.
       БАЗА (320–374px): 2-колоночная сетка внутри карточки (иконка+что-то
       сверху, название снизу — карточке хватает ширины). */
    .esim-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 10px; margin-bottom: 36px; margin-top: 20px }
    /* Мобилка: данные приходят с запасом (до 8, под десктоп), но видно
       строго 4 — карточки 5–8 скрыты, пока не наступит десктопный брейкпоинт. */
    .esim-grid .card:nth-child(n+5) { display: none; }
    /* .svc-grid — Steam-плашка (app-service-hero-card) теперь ПРЯМОЙ элемент
       этого же грида, а не отдельный блок над ним: на мобиле она занимает
       всю ширину (grid-column: 1/-1) — 100%, ниже сами услуги идут рядами
       по 3. На десктопе грид становится 5-колоночным, плашка растягивается
       на 2 колонки — в её же строке остаются места ещё для 3 сервисов,
       следующая строка — уже 5 сервисов подряд. */
    .svc-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 10px; margin-top: 20px}
    .svc-grid app-service-hero-card { grid-column: 1 / -1; }
    /* Мобилка: было 3 колонки — карточкам не хватало ширины (тот же
       класс проблем, что и с esim-grid). 2 колонки. Hero-плашка — 1-й
       ребёнок грида и занимает всю ширину, поэтому «показать 2 полных
       ряда обычных сервисов» (4 штуки, 2×2) = скрыть детей начиная с
       6-го (1 hero + 4 сервиса = дети 1..5) — было n+8 (под 3 колонки,
       6 сервисов = 2 ряда по 3), теперь меньше, чтобы не обрывать ряд
       посередине нечётным количеством карточек. */
    .svc-grid .svc-card:nth-child(n+6) { display: none; }

    .card {
      display: grid;
      grid-template-columns: 72px 1fr;
      grid-template-rows: auto auto;
      column-gap: 12px; row-gap: 8px;
      align-items: start; justify-items: start;
      min-width: 0;
      padding: 16px; border-radius: 18px;
      background: rgba(255, 255, 255, 1);
      box-shadow: 0px 26.44px 62.98px -21.64px rgba(0, 0, 0, 0.15);
      text-decoration: none; color: var(--color-ink);
      text-align: left;
      border: 1px solid transparent; transition: border-color var(--dur-quick) ease;
    }
    .card:hover { border-color: rgba(255, 186, 38, 1); }
    .card:active { transform: scale(.98); }

    .ico { grid-column: 1; grid-row: 1; display: flex; align-items: center; height: 34px; }
    .flag { width: 48px; height: 36px; object-fit: cover; border-radius: 8px; box-shadow: 0 1px 4px rgba(0,0,0,.16); flex-shrink: 0; }
    .emoji { font-size: 30px; line-height: 1; }

    .name-block { grid-column: 1; grid-row: 2; min-width: 0; max-width: 100%; }
    .name { display: block; font-weight: 600; font-size: 14px; }
    .cnt { color: var(--color-muted); font-size: 11px; }

    .from {
      grid-column: 2; grid-row: 1; justify-self: end;
      font-family: 'Syncopate Cyr'; color: rgba(114, 86, 22, 1); font-size: 12px;
      background: rgba(244, 244, 244, 1);
      padding: 10px 14px; border-radius: var(--rounded-pill);
    }
    .badge {
      grid-column: 2; grid-row: 2; justify-self: end;
      font-family: 'Syncopate Cyr';
      background: rgba(255, 186, 38, 1); color: rgba(0, 0, 0, 1);
      padding: 7px 11px; font-size: 8px; text-transform: uppercase;
      border-radius: var(--rounded-pill);
    }

    /* svc-card — НЕ использует общий .card (это отдельный, самостоятельный
       стиль плитки сервиса — просто по центру: иконка сверху, название под
       ней). .card 1:1 из esim-directions.component.ts — только для eSIM. */
    .svc-card {
      position: relative;
      display: flex; flex-direction: column; align-items: center; gap: 8px;
      padding: 14px var(--space-sm);
      background: rgba(255, 255, 255, 1);
      border: 1px solid transparent;
      border-radius: 18px;
      box-shadow: 0px 26.44px 62.98px -21.64px rgba(0, 0, 0, 0.15);
      text-decoration: none; color: var(--color-ink);
      text-align: center;
      transition: border-color var(--dur-quick) ease;
    }
    .svc-card:hover { border-color: rgba(255, 186, 38, 1); }
    .svc-card:active { transform: scale(.98); }
    .svc-ico { width: 44px; height: 44px; border-radius: 12px; object-fit: contain; }
    .svc-ico--stub {
      display: flex; align-items: center; justify-content: center;
      background: var(--color-primary-soft); color: var(--color-primary-ink);
      font-family: var(--font-display); font-size: 20px; font-weight: 700;
    }
    .svc-name {
      font-size: 13px; font-weight: 500; line-height: 1.25; text-align: center;
      display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden;
    }
    /* Цвет и шрифт — 1:1 с .badge из esim-directions.component.ts (жёлтый
       фон, чёрный текст, Syncopate Cyr, капс); позиция своя — верхний левый
       угол, как и была, её не трогаю. */
    .svc-hot {
      position: absolute; top: 12px; left: 8px;
      padding: 4px; border-radius: var(--rounded-pill);
      background: rgba(255, 186, 38, 1); color: rgba(0, 0, 0, 1);
      font-family: 'Syncopate Cyr'; font-size: 6px; text-transform: uppercase;
    }

    /* ===== 375–499px: карточке не хватает на 2 колонки внутри —
       вертикальный список по центру ===== */
    @media (min-width: 375px) {
      .card {
        display: flex; flex-direction: column; align-items: center; text-align: center;
        gap: 8px; padding: 14px;
      }
      .ico { justify-content: center; height: 28px; }
      .flag { width: 40px; height: 30px; }
      .name-block { max-width: 100%; }
      .name { font-size: 13px; }
      .cnt { font-size: 11px; }
      .from { font-size: 10px; padding: 7px 10px; }
      .badge { font-size: 7px; padding: 5px 9px; }
    }

    /* ===== 500–1023px: уже хватает места — снова «по бокам» ===== */
    @media (min-width: 500px) {
      .card {
        display: grid;
        grid-template-columns: 56px 1fr;
        grid-template-rows: auto auto;
        column-gap: 10px; row-gap: 6px;
        align-items: start; justify-items: start;
        text-align: left;
        padding: 14px;
      }
      .ico { grid-column: 1; grid-row: 1; justify-content: flex-start; height: 28px; }
      .flag { width: 40px; height: 30px; }
      .name-block { grid-column: 1; grid-row: 2; }
      .name { font-size: clamp(12px, 0.574vw + 9.13px, 15px); }
      .cnt { font-size: clamp(10px, 0.382vw + 8.09px, 12px); }
      .from { grid-column: 2; grid-row: 1; justify-self: end; font-size: clamp(9px, 0.574vw + 6.13px, 12px); padding: 7px 10px; }
      .badge { grid-column: 2; grid-row: 2; justify-self: end; font-size: clamp(7px, 0.382vw + 5.09px, 9px); padding: 5px 9px; }
    }

    /* ===== ≥1024px: десктопные размеры ===== */
    @media (min-width: 1024px) {
      .card { grid-template-columns: 60px 1fr; column-gap: 10px; row-gap: 8px; padding: 16px; }
      .ico { height: 30px; }
      .flag { width: 44px; height: 33px; }
      .name { font-size: 14px; }
      .cnt { font-size: 11px; }
      .from { font-size: 11px; padding: 8px 11px; }
      .badge { font-size: 7px; padding: 5px 9px; }
      .wrap { padding: 0 120px; }


      /* На телефоне eSIM всегда 2 в ряд, строго 4 карточки; здесь — 4 в ряд,
         открываем все 8 (ровно 2 полных ряда по 4). */
      .esim-grid { grid-template-columns: repeat(4, 1fr); }
      .esim-grid .card:nth-child(n+5) { display: grid; }

      /* Steam растягивается на 2 колонки из 5, а не на всю ширину строки —
         рядом с ним в той же строке помещаются ещё 3 сервиса, второй ряд —
         оставшиеся 5. Открываем все 8 услуг (были скрыты 8+ на мобиле). */
      .svc-grid { grid-template-columns: repeat(5, 1fr); }
      .svc-grid app-service-hero-card { grid-column: span 2; }
      .svc-grid .svc-card:nth-child(n+8) { display: flex; }
    }

    /* ===== Скелетоны ===== */
    .skel-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: var(--space-sm); margin-bottom: 36px; }    .skel {
      display: block; height: 92px; border-radius: var(--rounded-lg);
      background: color-mix(in srgb, var(--color-primary) 6%, var(--color-surface));
      border: 1px solid color-mix(in srgb, var(--color-primary) 14%, var(--color-hairline-soft));
      position: relative; overflow: hidden;
    }
    .skel::after {
      content: ""; position: absolute; inset: 0;
      background: linear-gradient(100deg, transparent 32%, color-mix(in srgb, #fff 55%, transparent) 50%, transparent 68%);
      transform: translateX(-100%);
      animation: main-skel 1.6s ease-in-out infinite;
    }
    @keyframes main-skel { to { transform: translateX(100%); } }
    @media (prefers-reduced-motion: reduce) { .skel::after { animation: none; } }

    /* ===== <375px =====
       Размещено В САМОМ КОНЦЕ файла НАРОЧНО: при равной специфичности
       CSS-правило побеждает то, что идёт ПОЗЖЕ по тексту — медиа-запрос
       сам по себе приоритета не даёт. Этот же блок раньше стоял в
       НАЧАЛЕ файла стилей, и все его правила молча перебивались более
       поздними безусловными правилами (.hero--promo, h2 и т.д.) — на
       экране ничего из них не применялось никогда. */
    @media (max-width: 374px) {
      .wrap { padding: 0 16px; }
      .esim-grid { grid-template-columns: 1fr; }
      .svc-grid { grid-template-columns: 1fr; }
      .svc-grid app-service-hero-card { grid-column: 1; }
      .hero--promo { flex-direction: column; align-items: stretch; }
      .hero--promo .hero-cta { width: 100%; }
      .hero--promo .hero-cta ::ng-deep app-button { display: block; width: 100%; }
      .hero--promo .hero-cta ::ng-deep button { width: 100%; }
    }
  `],
})
export class MainPage implements OnInit, OnDestroy {
  private readonly auth = inject(AuthService);
  private readonly cardsApi = inject(CardsApi);
  private readonly ordersApi = inject(OrdersApi);
  private readonly catalogApi = inject(CatalogApi);
  private readonly esimApi = inject(EsimApi);
  private readonly servicesApi = inject(ServicesApi);
  private readonly platformId = inject(PLATFORM_ID);

  protected readonly isAuthed = this.auth.isAuthenticated;
  // Карты — из глобального кэша (app-shell освежает его на каждом заходе
  // на '/'), поэтому отдельного skeleton'а hero не требуется.
  protected readonly cards = this.cardsApi.cardsCache;
  protected readonly showReferral = signal(false);
  protected readonly sections = signal<CatalogSections | null>(null);
  // Секция eSIM показывает НАПРАВЛЕНИЯ (страны), а не отдельные тарифы:
  // каталог провайдера — тысячи позиций, четыре случайных пакета из него на
  // главной ничего не говорили, да и тащить его целиком ради превью незачем.
  protected readonly esimDirections = signal<EsimDirection[] | null>(null);
  protected readonly serviceProducts = signal<ServiceProduct[] | null>(null);
  // issuingOrderId — оплаченная заявка на выпуск, карты ещё нет (см.
  // orders.api.ts). Виджет статуса живёт и здесь, и на /cards.
  protected readonly issuingOrderId = signal('');
  private issuePollTimer: ReturnType<typeof setInterval> | null = null;

  protected readonly esimAvailable = computed(() => this.sections()?.esim === 'available');
  protected readonly servicesAvailable = computed(() => this.sections()?.services === 'available');
  protected readonly esimLoading = computed(() => this.esimAvailable() && this.esimDirections() === null);
  protected readonly servicesLoading = computed(() => this.servicesAvailable() && this.serviceProducts() === null);

  // topEsim — до 8 (2 ряда по 4 на десктопе); на мобиле CSS (.esim-grid
  // .card:nth-child(n+5)) прячет 5–8, показывая строго 4.
  protected readonly topEsim = computed<EsimDirection[]>(() =>
    (this.esimDirections() ?? []).slice(0, 8),
  );
  // heroService — сервис отдельного блока (Steam), берётся ИЗ общего списка
  // serviceProducts() по слагу (не отдельным HTTP-запросом).
  protected readonly heroService = computed<ServiceProduct | null>(
    () => (this.serviceProducts() ?? []).find((p) => p.slug === HERO_SERVICE_SLUG) ?? null,
  );
  // gridServices — до SERVICES_TOP (8) обычных плиток без Steam (тот ушёл в
  // heroService выше). На десктопе видно все 8 (Steam+3 в первой строке грида,
  // 5 — во второй); на мобиле CSS (.svc-grid .svc-card:nth-child(n+6)) прячет
  // с 5-й плитки и дальше, оставляя строго 2 ряда по 2 (сетка на мобиле —
  // 2 колонки, было 3, не помещалось).
  protected readonly gridServices = computed<ServiceProduct[]>(() => {
    const list = (this.serviceProducts() ?? []).filter((p) => !p.disable_purchase);
    const rest = this.heroService() ? list.filter((p) => p.slug !== HERO_SERVICE_SLUG) : list;
    return rest.slice(0, MainPage.SERVICES_TOP);
  });

  protected readonly cardsCountLabel = computed(() => {
    const n = this.cards().length;
    const mod10 = n % 10;
    const mod100 = n % 100;
    let w = 'карт';
    if (mod100 < 11 || mod100 > 14) {
      if (mod10 === 1) w = 'карта';
      else if (mod10 >= 2 && mod10 <= 4) w = 'карты';
    }
    return `${n} ${w}`;
  });

  ngOnInit(): void {
    this.catalogApi.sections().subscribe({
      next: (r) => {
        this.sections.set(r.sections);
        if (r.sections.esim === 'available') {
          this.esimApi.directions().subscribe({
            next: (res) => this.esimDirections.set(res.countries ?? []),
            error: () => this.esimDirections.set([]),
          });
        }
        if (r.sections.services === 'available') {
          this.loadServices();
        }
      },
      // Сеть упала — считаем разделы недоступными (заглушки), карты остаются.
      error: () => this.sections.set({ cards: 'available', esim: 'coming_soon', services: 'coming_soon' }),
    });
    if (this.auth.isAuthenticated()) {
      // Кэш карт освежает app-shell; здесь только следим за выпуском.
      this.startIssuePollIfNeeded();
    }
  }

  /** Сколько плиток сервисов показывает главная. Ровно столько и просим у
   *  бэкенда — плюс одну про запас на Steam, который уходит в отдельный блок
   *  и в сетке не повторяется. */
  private static readonly SERVICES_TOP = 8;

  private loadServices(): void {
    // limit 9: +1 с запасом на Steam, который уйдёт в hero-плашку.
    this.servicesApi.products({ limit: MainPage.SERVICES_TOP + 1, offset: 0 }).subscribe({
      next: (res) => this.serviceProducts.set(res.products ?? []),
      error: () => this.serviceProducts.set([]),
    });
  }

  ngOnDestroy(): void {
    if (this.issuePollTimer) clearInterval(this.issuePollTimer);
  }

  // startIssuePollIfNeeded — тот же ритм и правила, что у home.page: флаг
  // протухает на терминальных статусах/404, карта появилась — флаг снимаем.
  private startIssuePollIfNeeded(): void {
    if (!isPlatformBrowser(this.platformId)) return;
    const id = readIssuingOrderId();
    if (!id) return;
    this.issuingOrderId.set(id);
    const tick = (): void => {
      this.ordersApi.get(id).subscribe({
        next: ({ order }) => {
          if (order.status === 'issued') {
            this.clearIssuingState();
            this.cardsApi.myCards().subscribe({ error: () => { } });
          } else if (order.status !== 'paid' && order.status !== 'issuing') {
            this.clearIssuingState();
          }
        },
        error: (err) => {
          const st = (err as { status?: number })?.status ?? 0;
          if (st === 404 || st === 403) this.clearIssuingState();
        },
      });
    };
    tick();
    this.issuePollTimer = setInterval(tick, 5000);
  }

  private clearIssuingState(): void {
    if (this.issuePollTimer) { clearInterval(this.issuePollTimer); this.issuePollTimer = null; }
    if (this.issuingOrderId()) this.issuingOrderId.set('');
    clearIssuingOrderId();
  }

  protected money(v: number, c: string): string { return formatAmount(v, c); }
  protected plansLabel(n: number): string {
    const mod10 = n % 10;
    const mod100 = n % 100;
    if (mod10 === 1 && mod100 !== 11) return 'тариф';
    if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return 'тарифа';
    return 'тарифов';
  }
}