import {
  AfterViewInit,
  Component,
  ElementRef,
  OnDestroy,
  OnInit,
  PLATFORM_ID,
  ViewChild,
  computed,
  effect,
  inject,
  signal,
} from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { Location, isPlatformBrowser } from '@angular/common';
import { CardsApi, CardProduct } from '../../core/api/cards.api';
import { ButtonComponent } from '../../ui/button.component';
import { CardTileComponent } from '../../ui/card-tile.component';
import { BackBarComponent } from '../../ui/back-bar.component';
import { RateQuoteComponent } from '../../ui/rate-quote.component';
import { symbolFor, formatAmount, isPrefixSymbolCurrency } from '../../core/currency/currency-symbols';
import { MarkdownLinkPipe } from '../../shared/pipes/markdown-link.pipe';
import { CachedBgDirective } from '../../core/utils/cached-bg.directive';
import { GuideTargetDirective } from '../guides/guide-target.directive';
import {
  SERVICE_ATTR_LABELS,
  ServiceAttr,
  filterServiceAttrs,
  serviceAttrIcon,
} from '../../core/constants/service-attrs';

@Component({
  selector: 'app-product-detail',
  standalone: true,
  imports: [ButtonComponent, CardTileComponent, BackBarComponent, RateQuoteComponent, RouterLink, MarkdownLinkPipe, CachedBgDirective, GuideTargetDirective],
  template: `<!-- Брендированный фон страницы — фиксированный слой за всем
       контентом. Back-bar и bottom-nav остаются на своих местах со своими
       фонами; этот слой виден между ними и плавно меняется при свайпе. -->
    <div class="page-bg" [appCachedBg]="pageBgImage()" [appCachedBgGradient]="pageBgGradient()" appCachedBgMode="page"></div>
    <div class="page-paw" aria-hidden="true"></div>
    <app-back-bar />
    @if (product(); as p) {
      <section class="wrap"
        [style.--page-h]="p.heading_color || null"
        [style.--page-body]="p.body_color || null"
        [style.--color-primary]="p.cta_color || null"
        [style.--color-on-primary]="onCtaColor(p)"
        [class.is-travel]="isTravelCard(p)">

        <!-- Карусель карт-продуктов: нативный CSS scroll-snap (горизонтальный
             свайп пальцем / колесом мыши со Shift), IntersectionObserver
             переключает активную, клик по соседней — плавный scrollIntoView.
             На десктопе (mouse) добавляем drag-to-scroll через pointer-события,
             touch продолжает идти через нативный scroll. -->
        <div class="hero-strip" #strip
             (pointerdown)="onStripPointerDown($event)"
             (pointermove)="onStripPointerMove($event)"
             (pointerup)="onStripPointerUp($event)"
             (pointercancel)="onStripPointerCancel($event)">
          @for (item of products(); track item.id) {
            <div class="slide"
                 [class.slide--current]="item.id === currentId()"
                 [attr.data-pid]="item.id"
                 (click)="onSlideClick(item.id, $event)">
              <app-card-tile [product]="item" [showServiceIcons]="false" />
            </div>
          }
        </div>

        <!-- Dots — визуальный индикатор текущей карты и точечный таб-навигатор.
             Активная точка — pill, неактивные — кружки (паттерн iOS). Клик
             меняет карту так же, как клик по слайду или горизонтальный
             свайп по контенту. -->
        @if (products().length > 1) {
          <div class="dots" role="tablist" aria-label="Выбор карты">
            @for (item of products(); track item.id) {
              <button type="button"
                      class="dot"
                      [class.active]="item.id === currentId()"
                      role="tab"
                      [attr.aria-selected]="item.id === currentId()"
                      [attr.aria-label]="'Карта ' + item.name"
                      (click)="pickCard(item.id, $event)"></button>
            }
          </div>
        }

        <!-- swipe-area: горизонтальный свайп пальцем переключает на соседнюю
             карту, чтобы пользователь мог сравнивать тарифы не возвращаясь к
             карусели. touch-action: pan-y оставляет вертикальный скролл
             браузеру, горизонталь — нам через pointer-события. -->
        <div class="content"
             (pointerdown)="onContentPointerDown($event)"
             (pointerup)="onContentPointerUp($event)"
             (pointercancel)="onContentPointerCancel()">

          <div class="name-block">
            <h2>{{ p.name }}</h2>
            <p class="desc" [innerHTML]="p.description | mdLink"></p>
          </div>

          <div class="side-block">
            @if (tier2Icons().length > 0) {
              <ul class="tier2">
                @for (k of tier2Icons(); track k) {
                  <li>
                    <img [src]="iconFor(k)" [alt]="labelFor(k)" [title]="labelFor(k)" loading="lazy" />
                  </li>
                }
              </ul>
            } @else if (tier1Icons().length > 0) {
              <div class="pay-row">
                <div class="tier1">
                  @for (k of tier1Icons(); track k) {
                    <span class="pay-badge">
                      <img [src]="iconFor(k)" [alt]="labelFor(k)" loading="lazy" />
                    </span>
                  }
                </div>
                <!-- Стрелки-переключатели карусели — видны только на десктопе
                     (см. .arrows в стилях), на мобиле карусель листается свайпом
                     и точками .dots как раньше. -->
                <div class="arrows">
                  <button type="button" class="arrow" (click)="cycleCard(-1)" aria-label="Предыдущая карта">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 18l-6-6 6-6"/></svg>
                  </button>
                  <button type="button" class="arrow" (click)="cycleCard(1)" aria-label="Следующая карта">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 6l6 6-6 6"/></svg>
                  </button>
                </div>
              </div>
            }

            <div class="price">
              @if (symBefore(p.issue_currency)) {
                <span class="sym">{{ symbol(p.issue_currency) }}</span>{{ p.issue_price }}
              } @else {
                {{ p.issue_price }} <span class="sym">{{ symbol(p.issue_currency) }}</span>
              }
            </div>
            <div class="divider" aria-hidden="true"></div>
            <div class="rate">
              <div class="rate-lbl">Курс пополнения</div>
              <app-rate-quote variant="pill" [base]="p.issue_currency" [markupPct]="p.deposit_fee_pct" />
            </div>

            <!-- Sticky CTA на мобиле (position:fixed — см. .cta-action), на
                 десктопе становится обычным элементом в конце этой колонки
                 (см. .cta-action внутри @media 1024px). disable_purchase=true:
                 оборачиваем кнопку в <div> (а не <a>), ставим [disabled] и
                 меняем текст. Backend в любом случае отказывает в IssueCard
                 (PURCHASE_DISABLED), но фронт убирает кликабельность, чтобы
                 юзер не уходил на checkout впустую. -->
            @if (p.disable_purchase) {
              <div class="cta-action">
                <app-button variant="primary" [full]="true" [disabled]="true">Выпуск карты временно недоступен</app-button>
              </div>
            } @else {
              <a [routerLink]="['/cards', p.id, 'checkout']" class="cta-action">
                <app-button appGuideTarget="product-cta" variant="primary" [full]="true">Выпустить карту {{ money(p.issue_price, p.issue_currency) }}</app-button>
              </a>
            }
          </div>

          <div class="list-col">
            <ul class="list ok">
              @for (it of (p.perks ?? []); track it[0]) {
                <li>
                  <div class="li-card">
                    <span class="dot-mark">
                      <svg xmlns="http://www.w3.org/2000/svg" width="16" height="12" viewBox="0 0 18 14" fill="none">
                        <path d="M0.652344 7.45595L5.30878 12.1124L16.7708 0.650391" stroke="#FFBA26" stroke-width="1.84211"/>
                      </svg>
                    </span>
                    <span><b>{{ it[0] }}</b><br><span class="muted" [innerHTML]="it[1] | mdLink"></span></span>
                  </div>
                </li>
              }
            </ul>

            @for (lst of (p.lists ?? []); track lst[0]) {
              <button class="acc-toggle" (click)="toggleBlock(lst[0])" [attr.aria-expanded]="isBlockOpen(lst[0])">
                <span>{{ lst[0] }}</span>
                <svg class="chev" [class.up]="isBlockOpen(lst[0])" viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
                  <path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" d="M6 9l6 6 6-6"/>
                </svg>
              </button>
              @if (isBlockOpen(lst[0])) {
                <ul class="grouped">
                  @for (item of lst.slice(1); track item) {
                    <li><div class="li-card" [innerHTML]="item | mdLink"></div></li>
                  }
                </ul>
              }
            }

            <!-- Аккордеон «Условия» — собирается из справочных полей продукта
                 (цена/обслуживание/срок/комиссии), см. conditions(). Тот же
                 паттерн раскрытия, что и у «Запрещённых операций» ниже. -->
            <button class="acc-toggle" (click)="condOpen.set(!condOpen())" [attr.aria-expanded]="condOpen()">
              <span>Условия</span>
              <svg class="chev" [class.up]="condOpen()" viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
                <path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" d="M6 9l6 6 6-6"/>
              </svg>
            </button>
            @if (condOpen()) {
              <ul class="grouped kv cond">
                @for (row of conditions(); track row[0]) {
                  <li><div class="li-card"><span class="kv-label">{{ row[0] }}</span><span class="kv-value">{{ row[1] }}</span></div></li>
                }
              </ul>
            }

            @if ((p.forbidden ?? []).length > 0) {
              <button class="acc-toggle" (click)="forbOpen.set(!forbOpen())" [attr.aria-expanded]="forbOpen()">
                <span>Запрещённые операции</span>
                <svg class="chev" [class.up]="forbOpen()" viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
                  <path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" d="M6 9l6 6 6-6"/>
                </svg>
              </button>
              @if (forbOpen()) {
                <ul class="list bad">
                  @for (item of (p.forbidden ?? []); track item) {
                    <li><div class="li-card"><span class="dot-mark">×</span><span [innerHTML]="item | mdLink"></span></div></li>
                  }
                </ul>
              }
            }
          </div>
        </div>
      </section>
    }`,
  styles: [`
    /* z-index 100 поднимает весь компонент над sticky bottom-nav (z 50)
       app-shell'а. Без этого fixed CTA-кнопка внутри :host (даже с
       большим z-index) перекрывалась бы pill-навигацией снизу.
       position: relative + z-index уже создают stacking context,
       isolation: isolate не нужен. */
    :host { position: relative; display: block; z-index: 100; }

    /* Брендирование всего экрана. Фиксированный слой между body canvas
       и контентом страницы. Back-bar и bottom-nav (со своими фонами)
       остаются неизменны — они в DOM-потоке и поверх page-bg. */
    .page-bg {
      position: fixed; inset: 0;
      z-index: 0;
      background-size: cover;
      background-position: center;
      background-repeat: no-repeat;
      transition: background .45s ease;
      pointer-events: none;
    }
    /* .page-paw — лапка ОТДЕЛЬНЫМ слоем, а не частью .page-bg: тот
       элемент управляется директивой appCachedBg/appCachedBgGradient,
       которая программно (через JS, element.style.backgroundImage)
       подставляет фон КОНКРЕТНОГО продукта — инлайн-стиль всегда
       побеждает CSS-правило независимо от специфичности, так что любой
       background-image, заданный в CSS самого .page-bg, у продукта со
       своим bg_image_url/bg_gradient просто никогда не применялся бы.
       Отдельный слой между .page-bg (z-index:0) и .wrap (z-index:1) —
       лапка теперь ВСЕГДА видна поверх фона продукта, каким бы он ни был. */
    .page-paw {
      position: fixed; inset: 0;
      z-index: 0;
      background-image: url('/assets/bg-paw.png');
      background-repeat: no-repeat;
      background-position: bottom 110px center;
      background-attachment: fixed;
      background-size: 310px auto;
      pointer-events: none;
    }
    /* back-bar и wrap должны быть НАД page-bg/page-paw в нашем stacking context. */
    app-back-bar { position: relative; z-index: 1; }

    .wrap {
      position: relative;
      z-index: 1;
      padding: 0 16px;
      padding-bottom: 110px;
      max-width: 1200px; margin: 0 auto;
      display: flex; flex-direction: column;
    }
    .wrap h2 { color: var(--page-h, inherit); }
    .wrap .desc { color: var(--page-body, var(--color-muted)); }

    /* ===== Карусель карт-продуктов =====
       Нативный горизонтальный scroll с scroll-snap. Свайпы пальцем
       работают на всех тач-устройствах; на десктопе — колесо мыши
       (Shift+scroll) и клик по соседней карте для переключения. */
    .hero-strip {
      /* --slide-w — ширина ЦЕНТРАЛЬНОЙ (текущей) карты: 80% экрана, крупная.
         --slide-w-side — соседние карты по бокам, заметно меньше (как было
         раньше), видны частично по краям. Паддинг центрирует ленту по
         ширине именно текущей карты — иначе она не встанет по центру. */
      --slide-w: clamp(280px, 80vw, 380px);
      --slide-w-side: clamp(200px, 60vw, 260px);
      display: flex;
      gap: 16px;
      overflow-x: auto;
      overflow-y: hidden;
      scroll-snap-type: x mandatory;
      scroll-behavior: smooth;
      scrollbar-width: none;
      -webkit-overflow-scrolling: touch;
      padding: var(--space-md) calc((100% - var(--slide-w)) / 2);
      margin: 0 calc(-1 * var(--space-md)) var(--space-md);
    }
    /* Mouse drag-to-scroll: grab курсор на устройствах с pointer'ом
       (десктоп). Тач-устройства игнорируют hover-медиа — там нативный
       scroll, курсор не нужен. */
    @media (hover: hover) and (pointer: fine) {
      .hero-strip { cursor: grab; }
      .hero-strip.dragging { cursor: grabbing; scroll-snap-type: none; scroll-behavior: auto; }
      .hero-strip.dragging .slide { cursor: grabbing; }
    }
    .hero-strip::-webkit-scrollbar { display: none; }
    .slide {
      flex: 0 0 var(--slide-w-side);
      scroll-snap-align: center;
      scroll-snap-stop: always;
      cursor: pointer;
      transition: flex-basis .25s ease, transform .25s ease, opacity .25s ease;
      opacity: .5;
      transform: scale(.92);
      display: flex;
      justify-content: center;
      align-items: center;
      user-select: none;
    }
    .slide app-card-tile { width: 100%; pointer-events: none; }
    .slide--current { flex: 0 0 var(--slide-w); opacity: 1; transform: scale(1); cursor: default; }

    /* Tier 2 — «приоритетные» сервисы. Только иконки в кругах: бренды
       Google Pay / Apple Pay / App Store узнаваемы без подписи, текст
       только дублировал бы лого. Tooltip через [title] оставляем для
       доступности. Иконки чуть крупнее tier1 — держим иерархию. */
    .tier2 {
      list-style: none; padding: 0; margin: 0 0 var(--space-sm);
      display: flex; gap: 10px; justify-content: center;
      flex-wrap: wrap;
    }
    .tier2 li {
      display: inline-flex; align-items: center; justify-content: center;
      padding: 18px;
      background: rgba(255, 255, 255, 1);
      border-radius: 12px;
      border: 1.43px solid rgba(200, 200, 200, 1);
      box-shadow: 0px 31.42px 74.85px -25.71px rgba(0, 0, 0, 0.15);
    }
    .tier2 li img {
      width: 32px; height: 32px;
      border-radius: 50%;
      object-fit: cover;
      background: #fff;
    }

    /* Tier 1 — теперь единый «блочный» стиль вместо компактных pill-бейджей:
       белые карточки с тенью/рамкой, иконка без подписи, ряд по центру,
       8px между блоками. */
    .tier1 {
      display: flex; flex-wrap: wrap; gap: 8px;
      justify-content: center;
    }
    .pay-badge {
      display: inline-flex; align-items: center; justify-content: center;
      padding: 20px 8px;
      background: rgba(255, 255, 255, 1);
      border: 1.3px solid rgba(200, 200, 200, 1);
      border-radius: var(--rounded-md);
      box-shadow: 0px 28.62px 68.18px -23.42px rgba(0, 0, 0, 0.15);
    }
    .pay-badge img {
      width: 18px; height: 18px;
      border-radius: 50%;
      object-fit: contain;
      background: #fff;
      flex-shrink: 0;
    }
    /* .pay-row — методы оплаты + стрелки-переключатели рядом (десктоп);
       на мобиле стрелки скрыты (см. .arrows ниже), ряд остаётся просто
       методами оплаты по центру. */
    .pay-row { display: flex; align-items: center; justify-content: center; margin-bottom: 12px; }
    .arrows { display: none; }

    h2 {overflow-wrap: break-word; text-align: center; font-size: 24px; margin: 0; }
    .desc {
      color: rgba(0, 0, 0, 1);
      text-align: center;
      font-size: 15px;
      margin: 14px 0 var(--space-lg);
    }
    .price {
      text-align: center; font-family: 'Syncopate Cyr'; font-size: 28px;
      color: rgba(114, 86, 22, 1);
      margin-bottom: 0;
    }
    /* .sym (символ валюты) специально БЕЗ своего стиля — наследует .price
       целиком (тот же размер/цвет/шрифт), только микро-отступ у префиксных
       валют ($ перед числом), чтобы не слипались вплотную. */
    .price .sym:first-child { margin-right: 1px; }
    /* .divider — «черта» между ценой и курсом пополнения: 30px сверху и
       снизу, узкая полоска по центру. */
    .divider {
      width: 112px; height: 2px;
      background: rgba(200, 200, 200, 1);
      margin: 30px auto;
    }
    .rate {
      display: flex; flex-direction: column; align-items: center; gap: 6px;
      margin: 0 0 36px;
    }
    .rate-lbl {
      font-size: 12px; text-transform: uppercase; letter-spacing: .08em;
      color: rgba(123, 123, 123, 1); font-weight: 600;
    }
    /* Сам курс рисуется ВНУТРИ <app-rate-quote> — цвет/жирность/размер уже
       выставлены в rate-quote.component.ts (rgba(0,0,0,1), 500, 24/20px). */

    /* Dots-индикатор под каруселью — pill для активной, кружок для остальных.
       Тап по точке = переключение карты (синхронно со скроллом hero-strip). */
    .dots {
      display: flex; gap: 8px; justify-content: center; align-items: center;
      margin: 0 0 var(--space-lg);
    }
    .dot {
      width: 8px; height: 8px;
      border-radius: var(--rounded-pill);
      background: color-mix(in srgb, var(--page-h, var(--color-ink)) 22%, transparent);
      border: none; padding: 0; cursor: pointer;
      transition: width .25s ease, background-color .2s ease, opacity .2s ease;
    }
    .dot:hover { background: color-mix(in srgb, var(--page-h, var(--color-ink)) 42%, transparent); }
    .dot.active {
      width: 22px;
      background: var(--color-primary);
      cursor: default;
    }

    /* swipe-area — горизонтальные жесты ловим pointer-событиями, вертикальный
       скролл оставляем браузеру через touch-action: pan-y. */
    .content { touch-action: pan-y; }
    /* .name-block/.side-block/.list-col существуют только ради десктопного
       грида (см. @media 1024px ниже) — на мобиле они "невидимы" для
       раскладки, их дети текут в обычном потоке .content, как будто
       обёртки нет. */
    .name-block, .side-block, .list-col { display: contents; }

    /* Единый стиль ДЛЯ ВСЕХ списков на странице (преимущества, запрещённые
       операции, доп. группы лендинга, «Условия») — фон белый на ВЕСЬ <ul>
       одним куском (не на каждый пункт — иначе получаются отдельные плашки
       с зазорами между ними), 20px паддинг контейнера, 30px между
       пунктами padding'ом на самом <li> (не gap/margin). */
    .list, .grouped {
      list-style: none; padding: 20px; margin: 0 0 var(--space-lg);
      background: rgba(255, 255, 255, 1);
      border-radius: var(--rounded-md);
    }
    .list li, .grouped li { padding-bottom: 30px; }
    .list li:last-child, .grouped li:last-child { padding-bottom: 0; }
    .li-card {
      display: flex; gap: 12px; align-items: center;
    }
    .list .li-card > span:last-child { color: rgba(0, 0, 0, 1); font-weight: 700; font-size: 16px; }
    .list .li-card .muted { color: rgba(0, 0, 0, 1); font-weight: 400; font-size: 16px; margin-top: 8px; display: inline-block; }
    .dot-mark {
      flex: 0 0 26px; width: 26px; height: 26px; border-radius: var(--rounded-pill);
      border: 1.84px solid rgba(255, 186, 38, 1);
      display: inline-flex; align-items: center; justify-content: center;
      padding: 8px;
    }
    .dot-mark svg { display: block; }
    .list.bad .dot-mark { border-color: var(--color-error); }
    /* .block/.eyebrow больше не используются — доп. группы лендинга (p.lists)
       теперь такой же .acc-toggle-аккордеон, как «Условия»/«Запрещённые
       операции» (см. toggleBlock/isBlockOpen в классе). */
    .grouped .li-card {
      color: var(--color-ink);
      font-size: 15px;
      line-height: 1.45;
    }
    .grouped .li-card :where(a) { color: var(--color-primary-ink); text-decoration: underline; text-underline-offset: 2px; }
    .grouped .li-card :where(a:hover) { text-decoration: none; }
    .desc :where(a), .list :where(a) { color: var(--color-primary-ink); text-decoration: underline; text-underline-offset: 2px; }
    .desc :where(a:hover), .list :where(a:hover) { text-decoration: none; }
    .acc-toggle {
      width: 100%; padding: 14px 16px; background: var(--color-surface-card);
      border-radius: var(--rounded-md); color: var(--color-ink);
      display: flex; align-items: center; justify-content: space-between; gap: 12px;
      margin-bottom: var(--space-md); font-size: 15px;
    }
    .chev { transition: transform .2s ease; color: var(--color-muted); }
    .chev.up { transform: rotate(180deg); }

    /* KV-строки аккордеона «Условия»: подпись слева, значение справа. */
    .grouped.kv .li-card { justify-content: space-between; gap: 16px; }
    .kv-label { color: var(--color-ink); }
    .kv-value { font-weight: 600; text-align: right; }
    .cond { margin-bottom: var(--space-md); }

    /* CTA-остров — fixed-плашка к нижней кромке viewport. Полупрозрачный
       canvas + backdrop-filter blur создают frosted-glass поверхность,
       сквозь которую виден прокручиваемый контент. Кнопка читается за
       счёт контраста с размытым фоном, без отдельной тени. */
    .cta-action {
      display: block;
      position: fixed;
      left: 0; right: 0; bottom: 92px;
      z-index: 10;
      text-decoration: none;
      padding: 0 16px
    }
    .cta-action > * {
      display: block;
      max-width: 720px;
      margin: 0 auto;
    }
    :host ::ng-deep .cta-action button {
      box-shadow: none;
      transition: transform .15s ease;
    }
    :host ::ng-deep .cta-action button:hover { transform: translateY(-1px); }
    :host ::ng-deep .cta-action button:active { transform: translateY(0); }

    /* ===== Палитра для карт подписки/premium =====
       Травел-карта берёт цвета из собственных полей продукта (уже
       прокинуты в --page-h/--page-body/--color-primary — см. [style.*]
       в шаблоне). У подписки/premium — фиксированные значения. */
    .wrap:not(.is-travel) .price { color: rgba(255, 186, 38, 1); }
    .wrap:not(.is-travel) .divider { background: rgba(200, 200, 200, 1); }

    /* ===== Десктоп (≥1024px) — другая раскладка целиком =====
       .content переходит в display:contents — его дети (.name-block,
       .list.ok, .side-block и т.д.) становятся ПРЯМЫМИ элементами грида
       .wrap наравне с каруселью. .name-block и .side-block — НАСТОЯЩИЕ
       обёртки (h2+.desc; методы+цена+курс+кнопка), каждая — ОДНА ячейка
       грида, а не растащенные по разным строкам элементы вперемешку с
       дотсами — так раньше и была катастрофа. Два ряда: 1) карусель
       (+дотсы отдельной строкой под ней) слева / .name-block справа,
       растянутый на обе строки, чтобы верх совпадал с каруселью независимо
       от наличия дотсов; 2) список преимуществ слева / .side-block справа.
       Всё, что физически идёт ПОСЛЕ .list.ok в разметке (доп. группы
       лендинга, аккордеоны «Условия»/«Запрещённые операции») — своей
       строкой на всю ширину НИЖЕ этого грида целиком, не смешивается со
       списком преимуществ. */
    @media (min-width: 1024px) {
      .wrap {
        display: grid;
        grid-template-columns: 445px 1fr;
        grid-template-rows: auto auto auto;
        column-gap: 52px;
        align-items: start;
        max-width: 1100px;
        padding: 0 120px; 

      }
      .content { display: contents; }
      .name-block, .side-block, .list-col { display: flex; flex-direction: column; }

      .hero-strip { --slide-w: 445px; --slide-w-side: 445px; grid-column: 1; grid-row: 1; margin: 0; padding: 0; }
      .dots { grid-column: 1; grid-row: 2; margin: 12px 0 0; }
      .name-block { grid-column: 2; grid-row: 1 / 3; align-self: start; }
      h2 { text-align: left; font-size: 46px; }
      .desc { text-align: left; font-size: 26px; margin: 16px 0 0; }

      /* .list-col и .side-block — ОДНА строка грида (row 3), обе колонки
         растягиваются на высоту БОЛЕЕ высокой из них (align-self:stretch
         перебивает общий .wrap{align-items:start} только для этих двух) —
         это и позволяет всей странице влезать в те же «два ряда» целиком,
         а не расползаться отдельными довесками снизу, и даёт кнопке ниже
         возможность прижаться к самому низу своей колонки. */
      .list-col { grid-column: 1; grid-row: 3; align-self: stretch; margin: 52px 0 0; }
      .side-block { grid-column: 2; grid-row: 3; align-self: stretch; margin: 52px 0 0; }
      .tier1, .tier2, .pay-row { justify-content: flex-start; }
      .pay-row { justify-content: space-between; margin: 0 0 16px; }
      .price { text-align: left; font-size: 60px; margin-bottom: 16px; }
      .divider { display: none; }
      .rate { align-items: flex-start; text-align: left; gap: 8px; margin: 0 0 30px; }
      .rate-lbl { font-size: 12px; }
      .cta-action {
        position: static;
        background: none; 
        padding: 0 120px;
      }
      .cta-action > * { max-width: none; margin: 0; }

      /* Стрелки-переключатели — заменяют собой свайп/точки на десктопе;
         круглая (точнее, овальная — паддинг 18/24) белая оболочка. */
      .arrows { display: flex; gap: 8px; }
      .arrow {
        display: inline-flex; align-items: center; justify-content: center;
        padding: 18px 24px;
        border-radius: var(--rounded-pill);
        background: rgba(255, 255, 255, 1);
        border: none; cursor: pointer; color: var(--color-ink);
        transition: transform .15s ease;
      }
      .arrow:hover { transform: translateY(-1px); }
      .arrow:active { transform: translateY(0); }

      /* .block/.acc-toggle/.grouped/.list.bad физически идут ПОСЛЕ
         .list.ok в разметке — остаются в ЛЕВОЙ колонке (grid-column:1),
         продолжая список преимуществ вниз, как и на мобиле, а НЕ
         растягиваются на всю ширину/не отрываются в отдельный блок. */
      /* .acc-toggle/.grouped/.list.bad теперь внутри .list-col (реальный
         flex-контейнер на десктопе) — отдельное grid-позиционирование
         им больше не нужно. */
    }
  `],
})
export class ProductDetailPage implements OnInit, AfterViewInit, OnDestroy {
  private readonly route = inject(ActivatedRoute);
  private readonly api = inject(CardsApi);
  private readonly location = inject(Location);
  private readonly platformId = inject(PLATFORM_ID);

  protected readonly products = signal<CardProduct[]>([]);
  // Подробные данные продукта (perks, lists, forbidden и т.д.). Из listProducts
  // приходит уже всё, но для надёжности дозапрашиваем getProduct по id.
  protected readonly fullProducts = signal<Record<string, CardProduct>>({});
  protected readonly currentId = signal<string>('');
  protected readonly forbOpen = signal(false);
  // condOpen — состояние аккордеона «Условия» (тот же паттерн, что forbOpen).
  protected readonly condOpen = signal(false);
  // openBlocks — какие ИЗ ДИНАМИЧЕСКИХ групп p.lists сейчас развёрнуты (тот
  // же паттерн аккордеона, что condOpen/forbOpen, но их несколько и ключ —
  // заголовок группы lst[0], а не фиксированный сигнал на одну секцию).
  private readonly openBlocks = signal<Set<string>>(new Set());
  protected toggleBlock(key: string): void {
    const next = new Set(this.openBlocks());
    if (next.has(key)) next.delete(key); else next.add(key);
    this.openBlocks.set(next);
  }
  protected isBlockOpen(key: string): boolean {
    return this.openBlocks().has(key);
  }

  // conditions — строки аккордеона «Условия», собираются из справочных полей
  // продукта. Первый год обслуживания включён в стоимость выпуска (бизнес-
  // правило backend'а — см. models.CardProduct.AnnualServiceFee). Нулевые
  // «необязательные» значения (срок, отмена, лимиты) по конвенции означают
  // «не задано» и скрываются; базовые строки показываются всегда — «0%» и
  // «Бесплатно» сами по себе продающая информация.
  protected readonly conditions = computed<[string, string][]>(() => {
    const p = this.product();
    if (!p) return [];
    const rows: [string, string][] = [
      ['Выпуск карты', this.money(p.issue_price, p.issue_currency)],
      ['Первый год обслуживания', 'Включён в выпуск'],
      ['Обслуживание со 2-го года', p.annual_service_fee > 0 ? this.money(p.annual_service_fee, p.issue_currency) : 'Бесплатно'],
    ];
    if ((p.validity_years ?? 0) > 0) rows.push(['Срок действия', yearsLabel(p.validity_years)]);
    rows.push(['Валюта карты', p.card_currency]);
    // Комиссия за пополнение — маркетинговый хардкод: наценка сервиса
    // (deposit_fee_pct) уже включена в показываемый «Курс пополнения»,
    // отдельной комиссией для пользователя она не является.
    rows.push(['Комиссия за пополнение', '0%']);
    rows.push(['Комиссия за транзакцию', feeLabel(p.tx_fee_fixed, p.tx_fee_pct, p.card_currency)]);
    const refund = feeLabel(p.refund_fee_fixed, p.refund_fee_pct, p.card_currency);
    if (refund !== 'Бесплатно') rows.push(['Комиссия за отмену транзакции', refund]);
    if ((p.min_topup_amount ?? 0) > 0) rows.push(['Минимальное пополнение', this.money(p.min_topup_amount, p.card_currency)]);
    if ((p.monthly_purchase_limit ?? 0) > 0) rows.push(['Лимит покупок в месяц', this.money(p.monthly_purchase_limit, p.card_currency)]);
    return rows;
  });

  // product — текущая выбранная карта. Берём «детальную» версию, если есть,
  // иначе — запись из списка.
  protected readonly product = computed<CardProduct | null>(() => {
    const id = this.currentId();
    if (!id) return null;
    return this.fullProducts()[id] ?? this.products().find((p) => p.id === id) ?? null;
  });

  protected readonly tier1Icons = computed<ServiceAttr[]>(() => filterServiceAttrs(this.product()?.tier1_attrs));
  protected readonly tier2Icons = computed<ServiceAttr[]>(() => filterServiceAttrs(this.product()?.tier2_attrs));

  // isTravelCard — карта путешествий берёт цвета из собственных полей продукта
  // (heading_color/body_color/cta_color, уже прокинуты в --page-h/--page-body/
  // --color-primary выше); карты подписки и premium — фиксированную палитру
  // ниже (см. .wrap:not(.is-travel) в стилях). CardProduct не отдаёт slug (не
  // наш бэкенд, поле добавлять нельзя) — травел-карта всегда первая в списке
  // products() по бизнес-правилу (порядок задаёт бэкенд), поэтому определяем
  // по позиции, а не по названию/полю.
  protected isTravelCard(p: CardProduct): boolean {
    return this.products()[0]?.id === p.id;
  }

  // Фон страницы (брендирование) отдаётся в директиву appCachedBg, которая
  // тянет картинку через Cache Storage, чтобы при reload не было сетевого
  // запроса. Картинка/градиент — реактивные сигналы по текущему продукту.
  protected readonly pageBgImage = computed<string | null>(() => (this.product()?.bg_image_url || null));
  protected readonly pageBgGradient = computed<string>(() => (this.product()?.bg_gradient || '').trim());

  @ViewChild('strip', { static: false }) private stripRef?: ElementRef<HTMLElement>;
  private observer?: IntersectionObserver;
  private initialScrollDone = false;
  // Подавляем реакцию IntersectionObserver на программный scroll (клик по
  // соседнему слайду / initial scroll) — иначе observer тут же откатит выбор.
  private suppressObserverUntil = 0;

  constructor() {
    // Когда подъехал список продуктов И есть DOM — выставляем начальный скролл.
    effect(() => {
      const list = this.products();
      if (list.length === 0) return;
      if (this.initialScrollDone) return;
      if (!isPlatformBrowser(this.platformId)) return;
      setTimeout(() => this.scrollToCurrent(false), 0);
    });
  }

  ngOnInit(): void {
    const id = this.route.snapshot.paramMap.get('id') ?? '';
    this.currentId.set(id);
    if (id) {
      this.api.getProduct(id).subscribe((p) => {
        this.fullProducts.update((m) => ({ ...m, [p.id]: p }));
      });
    }
    this.api.listProducts().subscribe((res) => {
      // Карусель показывает только продукты, доступные к выпуску. Если
      // пользователь зашёл по прямой ссылке на disabled-продукт — он всё
      // равно увидит его детали (через fullProducts → getProduct), но в
      // карусели «соседей» отключённых карт не будет, чтобы списки бейджей
      // и сравнение цен не вводили в заблуждение.
      const list = (res?.products ?? []).filter((p) => !p.disable_purchase);
      this.products.set(list);
    });
  }

  ngAfterViewInit(): void {
    if (!isPlatformBrowser(this.platformId)) return;
    if (this.products().length > 0) {
      setTimeout(() => this.scrollToCurrent(false), 0);
    }
  }

  ngOnDestroy(): void {
    this.observer?.disconnect();
  }

  private scrollToCurrent(smooth: boolean): void {
    const strip = this.stripRef?.nativeElement;
    if (!strip) return;
    const id = this.currentId();
    if (!id) return;
    const el = strip.querySelector<HTMLElement>(`[data-pid="${cssEscape(id)}"]`);
    if (!el) return;
    // Программный скролл — observer может сработать раньше времени, гасим
    // его на ~600мс, чтобы анимация успела завершиться.
    this.suppressObserverUntil = Date.now() + 600;
    // Скроллим ТОЛЬКО ленту по горизонтали (strip.scrollLeft), НЕ
    // el.scrollIntoView: тот подтягивает слайд в вид и по вертикали тоже
    // (block:'nearest'), поэтому при свайпе по контенту — когда карусель уже
    // уехала вверх за экран — страница прыгала в самый верх. Горизонтальный
    // scrollLeft вертикаль страницы не трогает.
    const offset = Math.max(0, el.offsetLeft - (strip.clientWidth - el.clientWidth) / 2);
    strip.scrollTo({ left: offset, behavior: smooth ? 'smooth' : 'auto' });
    this.initialScrollDone = true;
    if (!this.observer) this.attachObserver();
  }

  private attachObserver(): void {
    const strip = this.stripRef?.nativeElement;
    if (!strip) return;
    if (typeof IntersectionObserver === 'undefined') return;
    this.observer = new IntersectionObserver((entries) => {
      if (Date.now() < this.suppressObserverUntil) return;
      const visible = entries
        .filter((e) => e.isIntersecting)
        .sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
      if (!visible) return;
      const id = (visible.target as HTMLElement).getAttribute('data-pid');
      if (id && id !== this.currentId()) {
        this.selectId(id, false);
      }
    }, { root: strip, threshold: [0.6, 0.8, 0.95] });
    strip.querySelectorAll<HTMLElement>('[data-pid]').forEach((el) => this.observer!.observe(el));
  }

  protected onSlideClick(id: string, ev: Event): void {
    ev.preventDefault();
    // Если только что закончили mouse-drag — клик на слайд не должен
    // переключать карту (это завершение жеста, не отдельный тап).
    if (this.stripJustDragged) return;
    if (id === this.currentId()) return;
    this.selectId(id, true);
  }

  // ===== Mouse drag-to-scroll по карусели (desktop) =====
  // Тач-устройства листают карусель нативно (CSS overflow + scroll-snap),
  // но для мыши такого нативного поведения нет. Ловим pointer-события
  // на самой strip-ленте.
  //
  // Важно: pointer capture устанавливаем ЛЕНИВО, только после порога
  // движения (>6px). До этого click-событие нормально долетает до слайда
  // (по спеке pointer capture перехватывает click на capturing element —
  // если зацепить capture в pointerdown, простой клик на слайд перестанет
  // работать).
  //
  // Пока drag активен — IntersectionObserver полностью выключен через
  // suppressObserverUntil, иначе промежуточные слайды успевают сменить
  // currentId, и подсветка/фон страницы прыгают во время перетаскивания.
  private stripPending = false;
  private stripDragging = false;
  private stripDragStartX = 0;
  private stripDragStartScrollLeft = 0;
  private stripJustDragged = false;
  private static readonly STRIP_DRAG_THRESHOLD = 6;

  protected onStripPointerDown(e: PointerEvent): void {
    if (e.pointerType !== 'mouse') return;
    // Игнорируем нажатия не-левой кнопки (контекстное меню и т.п.).
    if (e.button !== 0) return;
    const strip = this.stripRef?.nativeElement;
    if (!strip) return;
    this.stripPending = true;
    this.stripDragStartX = e.clientX;
    this.stripDragStartScrollLeft = strip.scrollLeft;
  }

  protected onStripPointerMove(e: PointerEvent): void {
    if (!this.stripPending && !this.stripDragging) return;
    const strip = this.stripRef?.nativeElement;
    if (!strip) return;
    const dx = e.clientX - this.stripDragStartX;
    if (!this.stripDragging) {
      if (Math.abs(dx) < ProductDetailPage.STRIP_DRAG_THRESHOLD) return;
      // Порог перейден — официально стартуем drag. Захватываем pointer
      // (теперь pointerup точно придёт сюда даже если курсор уходит
      // за strip), глушим observer, переводим CSS в режим dragging.
      this.stripDragging = true;
      strip.classList.add('dragging');
      try { strip.setPointerCapture(e.pointerId); } catch { /* ignore */ }
      this.suppressObserverUntil = Number.POSITIVE_INFINITY;
    }
    strip.scrollLeft = this.stripDragStartScrollLeft - dx;
    e.preventDefault();
  }

  protected onStripPointerUp(e: PointerEvent): void {
    const wasDragging = this.stripDragging;
    this.stripPending = false;
    this.stripDragging = false;
    const strip = this.stripRef?.nativeElement;
    if (strip && wasDragging) {
      try { strip.releasePointerCapture(e.pointerId); } catch { /* ignore */ }
      strip.classList.remove('dragging');
    }
    if (!wasDragging) {
      // Чистый клик без drag — let (click) на слайде сам отработает.
      return;
    }
    // Подавляем последующий click на слайде (release завершает drag, не тап).
    this.stripJustDragged = true;
    setTimeout(() => { this.stripJustDragged = false; }, 0);
    if (!strip) {
      this.suppressObserverUntil = 0;
      return;
    }
    // Находим слайд, чей центр ближе всего к центру strip — туда и едем.
    const stripRect = strip.getBoundingClientRect();
    const centerX = stripRect.left + stripRect.width / 2;
    const slides = Array.from(strip.querySelectorAll<HTMLElement>('[data-pid]'));
    let bestId: string | null = null;
    let bestDist = Infinity;
    for (const slide of slides) {
      const r = slide.getBoundingClientRect();
      const c = r.left + r.width / 2;
      const d = Math.abs(c - centerX);
      if (d < bestDist) { bestDist = d; bestId = slide.getAttribute('data-pid'); }
    }
    // Программный скролл + selectId сами выставят suppressObserverUntil на
    // ~600мс, а до этого момента observer остаётся «навсегда» подавлен.
    if (bestId && bestId !== this.currentId()) {
      this.selectId(bestId, true);
    } else if (bestId === this.currentId()) {
      this.suppressObserverUntil = Date.now() + 600;
      setTimeout(() => this.scrollToCurrent(true), 0);
    } else {
      this.suppressObserverUntil = 0;
    }
  }

  protected onStripPointerCancel(e: PointerEvent): void {
    const wasDragging = this.stripDragging;
    this.stripPending = false;
    this.stripDragging = false;
    const strip = this.stripRef?.nativeElement;
    if (strip && wasDragging) {
      try { strip.releasePointerCapture(e.pointerId); } catch { /* ignore */ }
      strip.classList.remove('dragging');
      this.suppressObserverUntil = Date.now() + 600;
    }
  }

  // pickCard — единая точка переключения карты (используется dots-индикатором).
  // Тот же путь, что у клика по слайду карусели, плюс плавный scrollIntoView.
  protected pickCard(id: string, ev?: Event): void {
    ev?.preventDefault();
    if (id === this.currentId()) return;
    this.selectId(id, true);
  }

  // ===== Горизонтальный свайп по контенту =====
  // На touch-устройствах ловим pointer-события на .content (touch-action: pan-y
  // оставляет вертикальный скролл браузеру). Если жест явно горизонтальный
  // (|dx| > 60, |dx| > 1.5*|dy|, <600 мс) — переключаем на соседнюю карту.
  // Так пользователь может сравнивать тарифы между картами не возвращаясь
  // к карусели вверху страницы.
  private swipeStartX = 0;
  private swipeStartY = 0;
  private swipeStartT = 0;
  private swipeTracking = false;

  protected onContentPointerDown(e: PointerEvent): void {
    if (e.pointerType !== 'touch') return;
    this.swipeStartX = e.clientX;
    this.swipeStartY = e.clientY;
    this.swipeStartT = Date.now();
    this.swipeTracking = true;
  }
  protected onContentPointerUp(e: PointerEvent): void {
    if (!this.swipeTracking) return;
    this.swipeTracking = false;
    const dx = e.clientX - this.swipeStartX;
    const dy = e.clientY - this.swipeStartY;
    const dt = Date.now() - this.swipeStartT;
    if (dt > 600) return;
    if (Math.abs(dx) < 60) return;
    if (Math.abs(dx) < Math.abs(dy) * 1.5) return;
    // Свайп влево (dx<0) — следующая карта; вправо — предыдущая.
    this.cycleCard(dx < 0 ? 1 : -1);
  }
  protected onContentPointerCancel(): void {
    this.swipeTracking = false;
  }

  protected cycleCard(dir: 1 | -1): void {
    const list = this.products();
    if (list.length < 2) return;
    const idx = list.findIndex((p) => p.id === this.currentId());
    if (idx < 0) return;
    const next = idx + dir;
    if (next < 0 || next >= list.length) return;
    this.selectId(list[next].id, true);
  }

  private selectId(id: string, scrollSmooth: boolean): void {
    if (id === this.currentId()) return;
    this.currentId.set(id);
    // Меняем URL без перезапуска navigation — компонент не пересоздаётся,
    // back/forward в браузере работают, ссылка остаётся share-able.
    this.location.replaceState(`/cards/${id}`);
    if (!this.fullProducts()[id]) {
      this.api.getProduct(id).subscribe((p) => {
        this.fullProducts.update((m) => ({ ...m, [p.id]: p }));
      });
    }
    if (scrollSmooth) {
      setTimeout(() => this.scrollToCurrent(true), 0);
    }
  }

  symbol(c: string): string { return symbolFor(c); }
  symBefore(c: string): boolean { return isPrefixSymbolCurrency(c); }
  money(v: number | string | null | undefined, c: string | null | undefined): string { return formatAmount(v, c); }
  iconFor(k: ServiceAttr): string { return serviceAttrIcon(k); }
  labelFor(k: ServiceAttr): string { return SERVICE_ATTR_LABELS[k] ?? k; }

  // onCtaColor — цвет текста на CTA-кнопке. Если админ задал cta_color,
  // подбираем контрастный (белый для тёмного фона, тёмный для светлого) по
  // относительной яркости. Если cta_color пустой — null, наследуется тема.
  protected onCtaColor(p: CardProduct): string | null {
    const hex = parseHex(p.cta_color);
    if (!hex) return null;
    // ITU-R BT.601 luminance: 0.299*R + 0.587*G + 0.114*B
    const y = 0.299 * hex.r + 0.587 * hex.g + 0.114 * hex.b;
    return y > 140 ? '#141413' : '#ffffff';
  }

}

// yearsLabel — русская плюрализация срока действия: «1 год», «2 года»,
// «5 лет» (11–14 — всегда «лет»).
function yearsLabel(n: number): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod100 >= 11 && mod100 <= 14) return `${n} лет`;
  if (mod10 === 1) return `${n} год`;
  if (mod10 >= 2 && mod10 <= 4) return `${n} года`;
  return `${n} лет`;
}

// pctLabel — процент из доли (0.05 → «5%»). Округление до сотых процента
// защищает от двоичных хвостов (0.03 * 100 = 2.9999...).
function pctLabel(v: number): string {
  return `${Math.round((v ?? 0) * 10000) / 100}%`;
}

// feeLabel — комбинация фиксированной и процентной комиссии транзакции:
// «$0.30 + 2%», «$0.30», «2%» или «Бесплатно». Фикс — в card_currency.
function feeLabel(fixed: number, pct: number, currency: string): string {
  const parts: string[] = [];
  if ((fixed ?? 0) > 0) parts.push(formatAmount(fixed, currency));
  if ((pct ?? 0) > 0) parts.push(pctLabel(pct));
  return parts.length ? parts.join(' + ') : 'Бесплатно';
}

// parseHex — принимает CSS-цвет, поддерживает hex #rgb / #rrggbb (с # или без).
// Для rgb()/rgba()/named-цветов возвращает null — тогда onCtaColor не подбирает
// контраст и оставляет наследование темы.
function parseHex(s: string | null | undefined): { r: number; g: number; b: number } | null {
  if (!s) return null;
  const hex = s.trim().replace(/^#/, '');
  if (hex.length === 3) {
    const r = parseInt(hex[0] + hex[0], 16);
    const g = parseInt(hex[1] + hex[1], 16);
    const b = parseInt(hex[2] + hex[2], 16);
    if (isNaN(r) || isNaN(g) || isNaN(b)) return null;
    return { r, g, b };
  }
  if (hex.length === 6) {
    const r = parseInt(hex.slice(0, 2), 16);
    const g = parseInt(hex.slice(2, 4), 16);
    const b = parseInt(hex.slice(4, 6), 16);
    if (isNaN(r) || isNaN(g) || isNaN(b)) return null;
    return { r, g, b };
  }
  return null;
}

// CSS.escape — не везде, делаем простую защиту от спецсимволов в селекторе.
// ULID-id состоит из [0-9A-Z], никаких опасных символов нет, но защитимся
// на случай других форматов id в будущем.
function cssEscape(s: string): string {
  if (typeof CSS !== 'undefined' && typeof CSS.escape === 'function') return CSS.escape(s);
  return s.replace(/["'\\\n\r\t]/g, '\\$&');
}