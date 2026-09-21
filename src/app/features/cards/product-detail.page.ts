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
import {
  symbolFor,
  formatAmount,
  isPrefixSymbolCurrency,
} from '../../core/currency/currency-symbols';
import { MarkdownLinkPipe } from '../../shared/pipes/markdown-link.pipe';
import { CachedBgDirective } from '../../core/utils/cached-bg.directive';
import {
  SERVICE_ATTR_LABELS,
  ServiceAttr,
  filterServiceAttrs,
  serviceAttrIcon,
} from '../../core/constants/service-attrs';

@Component({
  selector: 'app-product-detail',
  standalone: true,
  imports: [
    ButtonComponent,
    CardTileComponent,
    BackBarComponent,
    RateQuoteComponent,
    RouterLink,
    MarkdownLinkPipe,
    CachedBgDirective,
  ],
  template: `
    <div
      class="page-bg"
      [appCachedBg]="pageBgImage()"
      [appCachedBgGradient]="pageBgGradient()"
      appCachedBgMode="page"
    ></div>

    <div
      class="page-paw"
      aria-hidden="true"
      [style.--page-paw-bg]="pawColor()"
      [style.--page-paw-opacity]="pawOpacity()"
    ></div>

    <app-back-bar [tintColor]="product()?.heading_color || null" />

    @if (product(); as p) {
      <section
        class="wrap"
        [style.--page-h]="p.heading_color || null"
        [style.--page-body]="p.body_color || null"
        [style.--color-primary]="p.cta_color || null"
        [style.--color-on-primary]="onCtaColor(p)"
        [class.is-travel]="isTravelCard(p)"
        [class.is-subscription]="isSubscriptionCard(p)"
        [class.is-premium]="isPremiumCard(p)"
      >
        <div
          class="hero-strip"
          #strip
          (pointerdown)="onStripPointerDown($event)"
          (pointermove)="onStripPointerMove($event)"
          (pointerup)="onStripPointerUp($event)"
          (pointercancel)="onStripPointerCancel($event)"
        >
          @for (item of products(); track item.id) {
            <div
              class="slide"
              [class.slide--current]="item.id === currentId()"
              [attr.data-pid]="item.id"
              (click)="onSlideClick(item.id, $event)"
            >
              <app-card-tile
                [product]="item"
                [showServiceIcons]="false"
              />
            </div>
          }
        </div>

        @if (products().length > 1) {
          <div class="dots" role="tablist" aria-label="Выбор карты">
            @for (item of products(); track item.id) {
              <button
                type="button"
                class="dot"
                [class.active]="item.id === currentId()"
                role="tab"
                [attr.aria-selected]="item.id === currentId()"
                [attr.aria-label]="'Карта ' + item.name"
                (click)="pickCard(item.id, $event)"
              ></button>
            }
          </div>
        }

        <div
          class="content"
          (pointerdown)="onContentPointerDown($event)"
          (pointerup)="onContentPointerUp($event)"
          (pointercancel)="onContentPointerCancel()"
        >
          <div class="name-block">
            <h2>
              @for (word of nameWords(p.name); track $index) {
                @if (isLatinWord(word)) {
                  <span class="name-accent">{{ word }}</span>
                } @else {
                  {{ word }}
                }
                {{ ' ' }}
              }
            </h2>

            <p
              class="desc"
              [innerHTML]="p.description | mdLink"
            ></p>
          </div>

          <div class="side-block" [class.side-block--wide-icons]="tier2Icons().length > 3">
            <div class="pay-row">
              @if (tier2Icons().length > 0) {
                <ul class="tier2">
                  @for (k of tier2Icons(); track k) {
                    <li>
                      <img
                        [src]="iconFor(k)"
                        [alt]="labelFor(k)"
                        [title]="labelFor(k)"
                        loading="lazy"
                      />
                    </li>
                  }
                </ul>
              } @else if (tier1Icons().length > 0) {
                <div class="tier1">
                  @for (k of tier1Icons(); track k) {
                    <span class="pay-badge">
                      <img
                        [src]="iconFor(k)"
                        [alt]="labelFor(k)"
                        loading="lazy"
                      />
                    </span>
                  }
                </div>
              }

              @if (products().length > 1) {
                <div class="arrows">
                  <button
                    type="button"
                    class="arrow"
                    (click)="cycleCard(-1)"
                    aria-label="Предыдущая карта"
                  >
                    <svg
                      width="18"
                      height="18"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      stroke-width="2"
                      stroke-linecap="round"
                      stroke-linejoin="round"
                    >
                      <path d="M15 18l-6-6 6-6" />
                    </svg>
                  </button>

                  <button
                    type="button"
                    class="arrow"
                    (click)="cycleCard(1)"
                    aria-label="Следующая карта"
                  >
                    <svg
                      width="18"
                      height="18"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      stroke-width="2"
                      stroke-linecap="round"
                      stroke-linejoin="round"
                    >
                      <path d="M9 6l6 6-6 6" />
                    </svg>
                  </button>
                </div>
              }
            </div>

            <div class="price">
              @if (symBefore(p.issue_currency)) {
                <span class="sym">{{ symbol(p.issue_currency) }}</span>{{ p.issue_price }}
              } @else {
                {{ p.issue_price }}
                <span class="sym">{{ symbol(p.issue_currency) }}</span>
              }
            </div>

            <div class="divider" aria-hidden="true"></div>

            <div class="rate">
              <div class="rate-lbl">Курс пополнения</div>
              <app-rate-quote
                variant="pill"
                [base]="p.card_currency"
                [markupPct]="p.deposit_fee_pct"
              />
            </div>

            @if (p.disable_purchase) {
              <div class="cta-action">
                <app-button
                  variant="primary"
                  [full]="true"
                  [disabled]="true"
                >
                  Выпуск карты временно недоступен
                </app-button>
              </div>
            } @else {
              <a
                [routerLink]="['/cards', p.id, 'checkout']"
                class="cta-action"
              >
                <app-button
                  variant="primary"
                  [full]="true"
                >
                  Выпустить карту
                </app-button>
              </a>
            }
          </div>

          <div class="list-col">
            <ul class="list ok">
              @for (it of (p.perks ?? []); track it[0]) {
                <li>
                  <div class="li-card">
                    <span class="dot-mark">
                      <svg
                        xmlns="http://www.w3.org/2000/svg"
                        width="16"
                        height="12"
                        viewBox="0 0 18 14"
                        fill="none"
                      >
                        <path
                          d="M0.652344 7.45595L5.30878 12.1124L16.7708 0.650391"
                          stroke="#FFBA26"
                          stroke-width="1.84211"
                        />
                      </svg>
                    </span>

                    <span>
                      <b>{{ it[0] }}</b>
                      <br />
                      <span
                        class="muted"
                        [innerHTML]="it[1] | mdLink"
                      ></span>
                    </span>
                  </div>
                </li>
              }
            </ul>

            @for (lst of (p.lists ?? []); track lst[0]) {
              <button
                class="acc-toggle"
                (click)="toggleBlock(lst[0])"
                [attr.aria-expanded]="isBlockOpen(lst[0])"
              >
                <span>{{ lst[0] }}</span>

                <svg
                  class="chev"
                  [class.up]="isBlockOpen(lst[0])"
                  viewBox="0 0 24 24"
                  width="18"
                  height="18"
                  aria-hidden="true"
                >
                  <path
                    fill="none"
                    stroke="currentColor"
                    stroke-width="2"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    d="M6 9l6 6 6-6"
                  />
                </svg>
              </button>

              @if (isBlockOpen(lst[0])) {
                <ul class="grouped">
                  @for (item of lst.slice(1); track item) {
                    <li>
                      <div
                        class="li-card"
                        [innerHTML]="item | mdLink"
                      ></div>
                    </li>
                  }
                </ul>
              }
            }

            <button
              class="acc-toggle"
              (click)="condOpen.set(!condOpen())"
              [attr.aria-expanded]="condOpen()"
            >
              <span>Условия</span>

              <svg
                class="chev"
                [class.up]="condOpen()"
                viewBox="0 0 24 24"
                width="18"
                height="18"
                aria-hidden="true"
              >
                <path
                  fill="none"
                  stroke="currentColor"
                  stroke-width="2"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  d="M6 9l6 6 6-6"
                />
              </svg>
            </button>

            @if (condOpen()) {
              <ul class="grouped kv cond">
                @for (row of conditions(); track row[0]) {
                  <li>
                    <div class="li-card">
                      <span class="kv-label">{{ row[0] }}</span>
                      <span class="kv-value">{{ row[1] }}</span>
                    </div>
                  </li>
                }
              </ul>
            }

            @if ((p.forbidden ?? []).length > 0) {
              <button
                class="acc-toggle"
                (click)="forbOpen.set(!forbOpen())"
                [attr.aria-expanded]="forbOpen()"
              >
                <span>Запрещённые операции</span>

                <svg
                  class="chev"
                  [class.up]="forbOpen()"
                  viewBox="0 0 24 24"
                  width="18"
                  height="18"
                  aria-hidden="true"
                >
                  <path
                    fill="none"
                    stroke="currentColor"
                    stroke-width="2"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    d="M6 9l6 6 6-6"
                  />
                </svg>
              </button>

              @if (forbOpen()) {
                <ul class="list bad">
                  @for (item of (p.forbidden ?? []); track item) {
                    <li>
                      <div class="li-card">
                        <span class="dot-mark">×</span>
                        <span [innerHTML]="item | mdLink"></span>
                      </div>
                    </li>
                  }
                </ul>
              }
            }
          </div>
        </div>
      </section>
    }
  `,
  styles: [`
    :host {
      position: relative;
      display: block;
      z-index: 100;
    }

    
    .page-bg {
      position: fixed;
      inset: 0;
      z-index: 0;
      background-size: cover;
      background-position: center;
      background-repeat: no-repeat;
      pointer-events: none;
    }
          .name-accent {
      color: var(--color-primary);
    }

    
    .page-paw {
      position: fixed;
      z-index: 0;
      left: 50%;
      bottom: 0;
      width: 320px;
      height: 100%;
      transform: translateX(-50%);
      background-color: var(--page-paw-bg, var(--color-black));
      -webkit-mask-image: url('/assets/bg-paw.png');
      -webkit-mask-repeat: no-repeat;
      -webkit-mask-position: center bottom;
      -webkit-mask-size: contain;
      mask-image: url('/assets/bg-paw.png');
      mask-repeat: no-repeat;
      mask-position: center bottom;
      mask-size: contain;
      opacity: var(--page-paw-opacity, .1);
      pointer-events: none;
      transition: none;
    }

    app-back-bar {
      position: relative;
      z-index: 1;
    }

    .wrap {
      position: relative;
      z-index: 1;
      padding: 0 16px;
      padding-bottom: 110px;
      max-width: 1200px;
      margin: 0 auto;
      display: flex;
      flex-direction: column;
    }

    .wrap h2 {
      color: var(--page-h, inherit);
    }

    .wrap .desc {
      color: var(--page-body, var(--color-muted));
    }

    

    .hero-strip {
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
      
      touch-action: none;

      padding: var(--space-md) calc((100% - var(--slide-w)) / 2);
      margin: 0 calc(-1 * var(--space-md)) var(--space-md);
    }

    
    .hero-strip.dragging {
      scroll-snap-type: none;
      scroll-behavior: auto;
    }

    @media (hover: hover) and (pointer: fine) {
      .hero-strip {
        cursor: grab;
      }

      .hero-strip.dragging {
        cursor: grabbing;
      }

      .hero-strip.dragging .slide {
        cursor: grabbing;
      }
    }

    .hero-strip::-webkit-scrollbar {
      display: none;
    }

    .slide {
      flex: 0 0 var(--slide-w-side);
      scroll-snap-align: center;
      scroll-snap-stop: always;
      cursor: pointer;
      transition:
        flex-basis .25s ease,
        transform .25s ease,
        opacity .25s ease;
      opacity: .5;
      transform: scale(.92);
      display: flex;
      justify-content: center;
      align-items: center;
      user-select: none;
    }

    .slide app-card-tile {
      width: 100%;
      pointer-events: none;
    }

    .slide--current {
      flex: 0 0 var(--slide-w);
      opacity: 1;
      transform: scale(1);
      cursor: default;
    }

    .tier2 {
      list-style: none;
      padding: 0;
      margin: 0 0 var(--space-sm);
      display: flex;
      gap: 10px;
      justify-content: center;
      flex-wrap: wrap;
    }

    .tier2 li {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      background: var(--color-white);
      border-radius: 12px;
      border: 1.43px solid var(--color-grey-200);
      box-shadow: 0px 31.42px 74.85px -25.71px var(--overlay-black-15);
      width: 52px;
      height: 52px
    }

    .tier2 li img {
      width: 32px;
      height: auto;
      border-radius: 50%;
      object-fit: cover;
      background: var(--color-white);
    }

    .tier1 {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      justify-content: center;
    }

    .pay-badge {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      padding: 20px 8px;
      background: var(--color-white);
      border: 1.3px solid var(--color-grey-200);
      border-radius: var(--rounded-md);
      box-shadow: 0px 28.62px 68.18px -23.42px var(--overlay-black-15);
    }

    .pay-badge img {
      width: 18px;
      height: 18px;
      border-radius: 50%;
      object-fit: contain;
      background: var(--color-white);
      flex-shrink: 0;
    }

    .pay-row {
      display: flex;
      align-items: center;
      justify-content: center;
      margin-bottom: 12px;
    }

    .arrows {
      display: none;
    }

    h2 {
      overflow-wrap: break-word;
      text-align: center;
      font-size: 24px;
      margin: 0;
    }

    .desc {
      color: var(--color-black);
      text-align: center;
      font-size: 15px;
      margin: 14px 0 var(--space-lg);
    }

    .price {
      text-align: center;
      font-family: 'Syncopate Cyr';
      font-size: 28px;
      color: var(--color-badge-brown);
      margin-bottom: 0;
      line-height: 0.7;
    }

    .price .sym:first-child {
      margin-right: 1px;
    }

    .divider {
      width: 112px;
      height: 2px;
      background: var(--color-grey-200);
      margin: 16px auto;
    }

    .rate {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 6px;
      margin: 0 0 22px;
    }

    .rate-lbl {
      font-size: 12px;
      text-transform: uppercase;
      letter-spacing: .08em;
      color: var(--color-grey-500);
      font-weight: 600;
    }

    .dots {
      display: flex;
      gap: 8px;
      justify-content: center;
      align-items: center;
      margin: 0 0 var(--space-lg);
    }

    .dot {
      width: 8px;
      height: 8px;
      border-radius: var(--rounded-pill);
      background: color-mix(
        in srgb,
        var(--page-h, var(--color-ink)) 22%,
        transparent
      );
      border: none;
      padding: 0;
      cursor: pointer;
      transition:
        width .25s ease,
        background-color .2s ease,
        opacity .2s ease;
    }

    .dot:hover {
      background: color-mix(
        in srgb,
        var(--page-h, var(--color-ink)) 42%,
        transparent
      );
    }

    .dot.active {
      width: 22px;
      background: var(--color-primary);
      cursor: default;
    }

    .content {
      touch-action: pan-y;
    }

    .name-block,
    .side-block,
    .list-col {
      display: contents;
    }

    .list,
    .grouped {
      list-style: none;
      padding: 20px;
      margin: 0;
      background: var(--color-white);
      border-radius: var(--rounded-md);
    }

    
    .list.ok {
      margin-bottom: 12px;
    }

    .list li,
    .grouped li {
      padding-bottom: 20px;
    }

    .list li:last-child,
    .grouped li:last-child {
      padding-bottom: 0;
    }

    .li-card {
      display: flex;
      gap: 12px;
      align-items: center;
    }

    .li-card b {
      text-transform: uppercase;
    }

    .list .li-card > span:last-child {
      color: var(--color-black);
      font-weight: 700;
      font-size: 16px;
      line-height: 1.2;
    }

    .list .li-card .muted {
      color: var(--color-black);
      font-weight: 400;
      font-size: 14px;
      display: inline-block;
    }

    .dot-mark {
      flex: 0 0 26px;
      width: 35px;
      height: 35px;
      border-radius: var(--rounded-pill);
      border: 1.84px solid var(--color-brand-gold);
      display: inline-flex;
      align-items: center;
      justify-content: center;
      padding: 8px;
    }

    .dot-mark svg {
      display: block;
    }

    .list.bad .dot-mark {
      border-color: var(--color-error);
    }

    .grouped .li-card {
      color: var(--color-ink);
      font-size: 15px;
      line-height: 1.45;
    }

    .grouped .li-card :where(a) {
      color: var(--color-primary-ink);
      text-decoration: underline;
      text-underline-offset: 2px;
    }

    .grouped .li-card :where(a:hover) {
      text-decoration: none;
    }

    .desc :where(a),
    .list :where(a) {
      color: var(--color-primary-ink);
      text-decoration: underline;
      text-underline-offset: 2px;
    }

    .desc :where(a:hover),
    .list :where(a:hover) {
      text-decoration: none;
    }

    
    .acc-toggle {
      width: 100%;
      padding: 12px 20px;
      margin: 0 0 8px;
      background: var(--color-white);
      border-radius: 52px;
      color: var(--color-ink);
      display: flex;
      align-items: center;
      justify-content: space-between;
      font-size: 15px;
    }

    .chev {
      transition: transform .2s ease;
      color: var(--color-muted);
    }

    .chev.up {
      transform: rotate(180deg);
    }

    .grouped.kv .li-card {
      justify-content: space-between;
      gap: 16px;
    }

    .kv-label {
      color: var(--color-ink);
    }

    .kv-value {
      font-weight: 600;
      text-align: right;
    }

    .cond {
      margin-bottom: var(--space-md);
    }

    .cta-action {
      display: block;
      position: fixed;
      left: 0;
      right: 0;
      bottom: 0;
      z-index: 10;
      padding: var(--space-md);
      padding-bottom: max(
        var(--space-md),
        env(safe-area-inset-bottom)
      );
      text-decoration: none;
      backdrop-filter: blur(2px) saturate(150%);
      -webkit-backdrop-filter: blur(2px) saturate(150%);
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

    :host ::ng-deep .cta-action button:hover {
      transform: translateY(-1px);
    }

    :host ::ng-deep .cta-action button:active {
      transform: translateY(0);
    }

    .wrap:not(.is-travel) .price {
      color: var(--color-brand-gold);
    }

    .wrap:not(.is-travel) .divider {
      background: var(--color-grey-200);
    }

    
    .acc-toggle,
    .grouped,
    .list.bad {
      display: none;
    }

    @media (min-width: 1024px) {
      .wrap {
        display: grid;
        grid-template-columns: 445px 1fr;
        grid-template-rows: auto 1fr;
        column-gap: 52px;
        align-items: stretch;
        max-width: 1200px;
        padding: 0 120px;
        padding-bottom: 110px;
        row-gap: 30px;
      }

      .content {
        display: contents;
      }

      .name-block,
      .side-block,
      .list-col {
        display: flex;
        flex-direction: column;
      }

      .hero-strip {
        --slide-w: 445px;
        --slide-w-side: 445px;

        grid-column: 1;
        grid-row: 1;
        margin: 0;
        padding: 0;
      }

      .slide {
        display: none;
      }

      .slide--current {
        display: block;
      }

      .dots {
        display: none;
      }

      .name-block {
        grid-column: 2;
        grid-row: 1;
        align-self: center;
        align-items: flex-start;
        text-align: left;
      }

      .name-block h2,
      .name-block .desc {
        text-align: left;
      }

      h2 {
        font-size: 46px;
      }

      .desc {
        font-size: 26px;
        margin: 16px 0 0;
      }

      .list-col {
        grid-column: 1;
        grid-row: 2;
        align-self: stretch;
        height: 100%;
        gap: 8px;
      }

      .side-block {
        grid-column: 2;
        grid-row: 2;
        display: flex;
        flex-direction: column;
        height: 100%;
        
        position: relative;
      }

      
      .side-block .cta-action {
        display: block;
        margin-top: auto;
        margin-bottom: 0;
        transition: margin-top var(--dur-quick, .15s) ease;
        width: 426px;
      }

      .side-block .cta-action app-button {
        display: block;
        width: 426px;
      }

      :host ::ng-deep .side-block .cta-action app-button button {
        width: 426px;
        padding-top: 26px;
        padding-bottom: 26px;
        display: flex;
        align-items: center;
        justify-content: center;
        text-align: center;
      }

      .tier1,
      .tier2,
      .pay-row {
        justify-content: flex-start;
      }

      .dot-mark {
        width: 32px;
        height: 32px;
        flex-basis: 32px;
      }

      .dot-mark svg {
        width: 15px;
        height: 11px;
      }

      .list,
      .grouped {
        padding: 12px;
      }

      
      .wrap.is-travel .list.ok {
        background: var(--color-white);
      }
      .wrap.is-premium .list.ok {
  background: var(--color-card-premium-bg);        color: var(--color-white);
      }

      .wrap.is-subscription .list.ok {
        background: var(--color-grey-charcoal);
        color: var(--color-white);
      }

      .wrap.is-premium .list.ok .li-card > span:last-child,
      .wrap.is-premium .list.ok .li-card .muted,
      .wrap.is-subscription .list.ok .li-card > span:last-child,
      .wrap.is-subscription .list.ok .li-card .muted {
        color: var(--color-white);
      }

      .list.ok {
        margin-bottom: 0;
      }

      .list li,
      .grouped li {
        padding-bottom: 6px;
      }

      .list li:last-child,
      .grouped li:last-child {
        padding-bottom: 0;
      }

      
      .acc-toggle {
        display: flex;
      }

      .grouped,
      .list.bad {
        display: block;
      }

      .list.ok {
        padding-bottom: 12px;
      }

      
      .side-block--wide-icons ~ .list-col .list.ok {
        flex: 1;
        display: flex;
        flex-direction: column;
        justify-content: space-between;
      }

      
      .acc-toggle {
        padding: 9px 14px;
        margin: 0;
      }

      .wrap.is-travel .acc-toggle {
        background: var(--color-white);

  color: var(--color-ink);
      }

      .wrap.is-premium .acc-toggle {
  background: var(--color-card-premium-bg);        color: var(--color-white);
      }

      .wrap.is-subscription .acc-toggle {
        background: var(--color-grey-charcoal);
        color: var(--color-white);
      }

      .wrap.is-premium .acc-toggle .chev,
      .wrap.is-subscription .acc-toggle .chev {
        color: var(--color-white);
      }

      
      .wrap.is-travel .grouped {
        background: var(--color-white);
        color: var(--color-ink);
      }

      .wrap.is-premium .grouped {
  background: var(--color-card-premium-bg);        color: var(--color-white);
      }

      .wrap.is-subscription .grouped {
        background: var(--color-grey-charcoal);
        color: var(--color-white);
      }

      .wrap.is-premium .grouped .li-card,
      .wrap.is-subscription .grouped .li-card {
        color: var(--color-white);
      }

      .wrap.is-premium .grouped .kv-label,
      .wrap.is-subscription .grouped .kv-label {
        color: var(--color-white);
      }

      

      
      
      .pay-row {
        align-items: flex-start;
        justify-content: flex-start;
        padding-right: 132px;
        margin: 0 0 10px;
      }

      
      .arrows {
        position: absolute;
        top: 7px;
        right: 0;
      }

      .price {
        text-align: left;
        font-size: 60px;
        line-height: 1;
      }

      .divider {
        display: none;
      }

      .rate {
        align-items: flex-start;
        text-align: left;
        gap: 8px;
        margin: 0 0 16px;
      }

      .rate-lbl {
        font-size: 12px;
      }

      .cta-action {
        position: static;
        background: none;
        backdrop-filter: none;
        -webkit-backdrop-filter: none;
        padding: 0;
      }

      .cta-action > * {
        max-width: none;
        margin: 0;
      }

      .arrows {
        display: flex;
        gap: 8px;
      }

      .arrow {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 58px;
        height: 58px;
        border-radius: 50%;
        background: var(--color-white);
        border: 1px solid var(--color-grey-200);
        box-shadow: 0px 31.42px 74.85px -25.71px var(--overlay-black-15);
        cursor: pointer;
        color: var(--color-ink);
        transition: transform .15s ease;
      }

      .wrap.is-subscription .arrow {
        background: var(--color-grey-charcoal);
        color: var(--color-white);
      }

      .wrap.is-premium .arrow {
        background: var(--color-white);
        color: var(--color-grey-400);
      }

      .arrow svg {
        width: 62px;
        height: 30px;
      }

      .arrow:hover {
        transform: translateY(-1px);
      }

      .arrow:active {
        transform: translateY(0);
      }

      .page-paw {
        width: 600px;
        top: 10%;
      }
    }
  `],
})
export class ProductDetailPage implements OnInit, AfterViewInit, OnDestroy {
  private readonly route = inject(ActivatedRoute);
  private readonly api = inject(CardsApi);
  private readonly location = inject(Location);
  private readonly platformId = inject(PLATFORM_ID);

  protected readonly products = signal<CardProduct[]>([]);
  protected readonly fullProducts = signal<Record<string, CardProduct>>({});
  protected readonly currentId = signal<string>('');

  protected readonly forbOpen = signal(false);
  protected readonly condOpen = signal(false);

  private readonly openBlocks = signal<Set<string>>(new Set());

  protected toggleBlock(key: string): void {
    const next = new Set(this.openBlocks());

    if (next.has(key)) {
      next.delete(key);
    } else {
      next.add(key);
    }

    this.openBlocks.set(next);
  }

  protected isBlockOpen(key: string): boolean {
    return this.openBlocks().has(key);
  }

  protected readonly conditions = computed<[string, string][]>(() => {
    const p = this.product();

    if (!p) {
      return [];
    }

    const rows: [string, string][] = [
      ['Выпуск карты', this.money(p.issue_price, p.issue_currency)],
      ['Первый год обслуживания', 'Включён в выпуск'],
      [
        'Обслуживание со 2-го года',
        p.annual_service_fee > 0
          ? this.money(p.annual_service_fee, p.issue_currency)
          : 'Бесплатно',
      ],
    ];

    if ((p.validity_years ?? 0) > 0) {
      rows.push([
        'Срок действия',
        yearsLabel(p.validity_years),
      ]);
    }

    rows.push(['Валюта карты', p.card_currency]);
    rows.push(['Комиссия за пополнение', '0%']);
    rows.push([
      'Комиссия за транзакцию',
      feeLabel(
        p.tx_fee_fixed,
        p.tx_fee_pct,
        p.card_currency,
      ),
    ]);

    const refund = feeLabel(
      p.refund_fee_fixed,
      p.refund_fee_pct,
      p.card_currency,
    );

    if (refund !== 'Бесплатно') {
      rows.push([
        'Комиссия за отмену транзакции',
        refund,
      ]);
    }

    if ((p.min_topup_amount ?? 0) > 0) {
      rows.push([
        'Минимальное пополнение',
        this.money(
          p.min_topup_amount,
          p.card_currency,
        ),
      ]);
    }

    if ((p.monthly_purchase_limit ?? 0) > 0) {
      rows.push([
        'Лимит покупок в месяц',
        this.money(
          p.monthly_purchase_limit,
          p.card_currency,
        ),
      ]);
    }

    return rows;
  });

  protected readonly product = computed<CardProduct | null>(() => {
    const id = this.currentId();

    if (!id) {
      return null;
    }

    return (
      this.fullProducts()[id] ??
      this.products().find((p) => p.id === id) ??
      null
    );
  });

  protected readonly tier1Icons = computed<ServiceAttr[]>(
    () => filterServiceAttrs(this.product()?.tier1_attrs),
  );

  protected readonly tier2Icons = computed<ServiceAttr[]>(
    () => filterServiceAttrs(this.product()?.tier2_attrs),
  );

  protected isTravelCard(p: CardProduct): boolean {
    return this.products()[0]?.id === p.id;
  }

  protected isSubscriptionCard(p: CardProduct): boolean {
    return p.id === 'mock-card-subs';
  }

  protected isPremiumCard(p: CardProduct): boolean {
    return p.id === 'mock-card-premium';
  }

  
  protected readonly pawColor = computed<string | null>(() => {
    const p = this.product();

    if (!p) {
      return null;
    }

    if (this.isSubscriptionCard(p)) {
      return 'var(--color-grey-900)';
    }

    if (this.isPremiumCard(p)) {
      return 'var(--color-white)';
    }

    return 'var(--color-black)';
  });

  
  protected readonly pawOpacity = computed<number | null>(() => {
    const p = this.product();

    if (!p) {
      return null;
    }

    if (this.isSubscriptionCard(p)) {
      return 1;
    }

    return 0.1;
  });

  protected readonly pageBgImage = computed<string | null>(
    () => this.product()?.bg_image_url || null,
  );

  protected readonly pageBgGradient = computed<string>(
    () => (this.product()?.bg_gradient || '').trim(),
  );

  @ViewChild('strip', { static: false })
  private stripRef?: ElementRef<HTMLElement>;

  private observer?: IntersectionObserver;
  private initialScrollDone = false;
  private suppressObserverUntil = 0;

  constructor() {
    effect(() => {
      const list = this.products();

      if (list.length === 0) {
        return;
      }

      if (this.initialScrollDone) {
        return;
      }

      if (!isPlatformBrowser(this.platformId)) {
        return;
      }

      setTimeout(() => this.scrollToCurrent(false), 0);
    });
  }

  ngOnInit(): void {
    const id = this.route.snapshot.paramMap.get('id') ?? '';

    this.currentId.set(id);

    if (id) {
      this.api.getProduct(id).subscribe((p) => {
        this.fullProducts.update((m) => ({
          ...m,
          [p.id]: p,
        }));
      });
    }

    this.api.listProducts().subscribe((res) => {
      const list = (res?.products ?? []).filter(
        (p) => !p.disable_purchase,
      );

      this.products.set(list);
    });
  }

  ngAfterViewInit(): void {
    if (!isPlatformBrowser(this.platformId)) {
      return;
    }

    if (this.products().length > 0) {
      setTimeout(() => this.scrollToCurrent(false), 0);
    }
  }

  ngOnDestroy(): void {
    this.observer?.disconnect();
  }

  private scrollToCurrent(smooth: boolean): void {
    const strip = this.stripRef?.nativeElement;

    if (!strip) {
      return;
    }

    const id = this.currentId();

    if (!id) {
      return;
    }

    const el = strip.querySelector<HTMLElement>(
      `[data-pid="${cssEscape(id)}"]`,
    );

    if (!el) {
      return;
    }

    this.suppressObserverUntil = Date.now() + 600;

    const offset = Math.max(
      0,
      el.offsetLeft -
        (strip.clientWidth - el.clientWidth) / 2,
    );

    strip.scrollTo({
      left: offset,
      behavior: smooth ? 'smooth' : 'auto',
    });

    this.initialScrollDone = true;

    if (!this.observer) {
      this.attachObserver();
    }
  }

  private attachObserver(): void {
    const strip = this.stripRef?.nativeElement;

    if (!strip) {
      return;
    }

    if (typeof IntersectionObserver === 'undefined') {
      return;
    }

    this.observer = new IntersectionObserver(
      (entries) => {
        if (Date.now() < this.suppressObserverUntil) {
          return;
        }

        const visible = entries
          .filter((e) => e.isIntersecting)
          .sort(
            (a, b) =>
              b.intersectionRatio -
              a.intersectionRatio,
          )[0];

        if (!visible) {
          return;
        }

        const id = (
          visible.target as HTMLElement
        ).getAttribute('data-pid');

        if (id && id !== this.currentId()) {
          this.selectId(id, false);
        }
      },
      {
        root: strip,
        threshold: [0.6, 0.8, 0.95],
      },
    );

    strip
      .querySelectorAll<HTMLElement>('[data-pid]')
      .forEach((el) => this.observer!.observe(el));
  }

  protected onSlideClick(id: string, ev: Event): void {
    ev.preventDefault();

    if (this.stripJustDragged) {
      return;
    }

    if (id === this.currentId()) {
      return;
    }

    this.selectId(id, true);
  }

  private stripPending = false;
  private stripDragging = false;
  private stripDragStartX = 0;
  private stripDragStartScrollLeft = 0;
  private stripJustDragged = false;

  private static readonly STRIP_DRAG_THRESHOLD = 6;

  protected onStripPointerDown(e: PointerEvent): void {

    if (e.button !== 0) {
      return;
    }

    const strip = this.stripRef?.nativeElement;

    if (!strip) {
      return;
    }

    this.stripPending = true;
    this.stripDragStartX = e.clientX;
    this.stripDragStartScrollLeft = strip.scrollLeft;
  }

  protected onStripPointerMove(e: PointerEvent): void {
    if (!this.stripPending && !this.stripDragging) {
      return;
    }

    const strip = this.stripRef?.nativeElement;

    if (!strip) {
      return;
    }

    const dx = e.clientX - this.stripDragStartX;

    if (
      !this.stripDragging &&
      Math.abs(dx) < ProductDetailPage.STRIP_DRAG_THRESHOLD
    ) {
      return;
    }

    if (!this.stripDragging) {
      this.stripDragging = true;
      strip.classList.add('dragging');

      try {
        strip.setPointerCapture(e.pointerId);
      } catch {}

      this.suppressObserverUntil =
        Number.POSITIVE_INFINITY;
    }

    strip.scrollLeft =
      this.stripDragStartScrollLeft - dx;

    e.preventDefault();
  }

  protected onStripPointerUp(e: PointerEvent): void {
    const wasDragging = this.stripDragging;

    this.stripPending = false;
    this.stripDragging = false;

    const strip = this.stripRef?.nativeElement;

    if (strip && wasDragging) {
      try {
        strip.releasePointerCapture(e.pointerId);
      } catch {}

      strip.classList.remove('dragging');
    }

    if (!wasDragging) {
      return;
    }

    this.stripJustDragged = true;

    setTimeout(() => {
      this.stripJustDragged = false;
    }, 0);

    if (!strip) {
      this.suppressObserverUntil = 0;
      return;
    }

    const dx = e.clientX - this.stripDragStartX;
    const list = this.products();
    const idx = list.findIndex((p) => p.id === this.currentId());

    if (idx < 0 || Math.abs(dx) < ProductDetailPage.STRIP_DRAG_THRESHOLD) {
      this.suppressObserverUntil = Date.now() + 600;

      setTimeout(
        () => this.scrollToCurrent(true),
        0,
      );

      return;
    }

    const dir: 1 | -1 = dx < 0 ? 1 : -1;
    const nextIdx = idx + dir;

    if (nextIdx < 0 || nextIdx >= list.length) {
      this.suppressObserverUntil = Date.now() + 600;

      setTimeout(
        () => this.scrollToCurrent(true),
        0,
      );

      return;
    }

    this.selectId(list[nextIdx].id, true);
  }

  protected onStripPointerCancel(e: PointerEvent): void {
    const wasDragging = this.stripDragging;

    this.stripPending = false;
    this.stripDragging = false;

    const strip = this.stripRef?.nativeElement;

    if (strip && wasDragging) {
      try {
        strip.releasePointerCapture(e.pointerId);
      } catch {}

      strip.classList.remove('dragging');

      this.suppressObserverUntil =
        Date.now() + 600;
    }
  }

  protected pickCard(id: string, ev?: Event): void {
    ev?.preventDefault();

    if (id === this.currentId()) {
      return;
    }

    this.selectId(id, true);
  }

  private swipeStartX = 0;
  private swipeStartY = 0;
  private swipeStartT = 0;
  private swipeTracking = false;

  protected onContentPointerDown(e: PointerEvent): void {
    if (e.pointerType !== 'touch') {
      return;
    }

    this.swipeStartX = e.clientX;
    this.swipeStartY = e.clientY;
    this.swipeStartT = Date.now();
    this.swipeTracking = true;
  }

  protected onContentPointerUp(e: PointerEvent): void {
    if (!this.swipeTracking) {
      return;
    }

    this.swipeTracking = false;

    const dx = e.clientX - this.swipeStartX;
    const dy = e.clientY - this.swipeStartY;
    const dt = Date.now() - this.swipeStartT;

    if (dt > 600) {
      return;
    }

    if (Math.abs(dx) < 60) {
      return;
    }

    if (Math.abs(dx) < Math.abs(dy) * 1.5) {
      return;
    }

    this.cycleCard(dx < 0 ? 1 : -1);
  }

  protected onContentPointerCancel(): void {
    this.swipeTracking = false;
  }

  protected cycleCard(dir: 1 | -1): void {
    const list = this.products();

    if (list.length < 2) {
      return;
    }

    const idx = list.findIndex(
      (p) => p.id === this.currentId(),
    );

    if (idx < 0) {
      return;
    }

    const next =
      (idx + dir + list.length) % list.length;

    this.selectId(list[next].id, true);
  }

  private selectId(
    id: string,
    scrollSmooth: boolean,
  ): void {
    if (id === this.currentId()) {
      return;
    }

    this.currentId.set(id);

    this.location.replaceState(`/cards/${id}`);

    if (!this.fullProducts()[id]) {
      this.api.getProduct(id).subscribe((p) => {
        this.fullProducts.update((m) => ({
          ...m,
          [p.id]: p,
        }));
      });
    }

    if (scrollSmooth) {
      setTimeout(
        () => this.scrollToCurrent(true),
        0,
      );
    }
  }

  symbol(c: string): string {
    return symbolFor(c);
  }

  symBefore(c: string): boolean {
    return isPrefixSymbolCurrency(c);
  }

  money(
    v: number | string | null | undefined,
    c: string | null | undefined,
  ): string {
    return formatAmount(v, c);
  }

  iconFor(k: ServiceAttr): string {
    return serviceAttrIcon(k);
  }

  labelFor(k: ServiceAttr): string {
    return SERVICE_ATTR_LABELS[k] ?? k;
  }

  protected nameWords(name: string): string[] {
    return name.split(' ');
  }

  protected isLatinWord(word: string): boolean {
    return /^[A-Za-z]+$/.test(word);
  }

  protected onCtaColor(
    p: CardProduct,
  ): string | null {
    const hex = parseHex(p.cta_color);

    if (!hex) {
      return null;
    }

    const y =
      0.299 * hex.r +
      0.587 * hex.g +
      0.114 * hex.b;

    return y > 140
      ? 'var(--color-near-black)'
      : 'var(--color-white)';
  }
}

function yearsLabel(n: number): string {
  const mod10 = n % 10;
  const mod100 = n % 100;

  if (mod100 >= 11 && mod100 <= 14) {
    return `${n} лет`;
  }

  if (mod10 === 1) {
    return `${n} год`;
  }

  if (mod10 >= 2 && mod10 <= 4) {
    return `${n} года`;
  }

  return `${n} лет`;
}

function pctLabel(v: number): string {
  return `${Math.round((v ?? 0) * 10000) / 100}%`;
}

function feeLabel(
  fixed: number,
  pct: number,
  currency: string,
): string {
  const parts: string[] = [];

  if ((fixed ?? 0) > 0) {
    parts.push(formatAmount(fixed, currency));
  }

  if ((pct ?? 0) > 0) {
    parts.push(pctLabel(pct));
  }

  return parts.length
    ? parts.join(' + ')
    : 'Бесплатно';
}

function parseHex(
  s: string | null | undefined,
): { r: number; g: number; b: number } | null {
  if (!s) {
    return null;
  }

  const hex = s.trim().replace(/^#/, '');

  if (hex.length === 3) {
    const r = parseInt(hex[0] + hex[0], 16);
    const g = parseInt(hex[1] + hex[1], 16);
    const b = parseInt(hex[2] + hex[2], 16);

    if (
      isNaN(r) ||
      isNaN(g) ||
      isNaN(b)
    ) {
      return null;
    }

    return { r, g, b };
  }

  if (hex.length === 6) {
    const r = parseInt(hex.slice(0, 2), 16);
    const g = parseInt(hex.slice(2, 4), 16);
    const b = parseInt(hex.slice(4, 6), 16);

    if (
      isNaN(r) ||
      isNaN(g) ||
      isNaN(b)
    ) {
      return null;
    }

    return { r, g, b };
  }

  return null;
}

function cssEscape(s: string): string {
  if (
    typeof CSS !== 'undefined' &&
    typeof CSS.escape === 'function'
  ) {
    return CSS.escape(s);
  }

  return s.replace(
    /["'\\\n\r\t]/g,
    '\\$&',
  );
}