import { Component, computed, inject, input } from '@angular/core';
import { CardProduct } from '../core/api/cards.api';
import { RuntimeConfigService } from '../core/config/runtime-config.service';
import { CachedBgDirective } from '../core/utils/cached-bg.directive';
import { BrandLogoComponent } from './brand-logo.component';
import {
  SERVICE_ATTR_LABELS,
  ServiceAttr,
  filterServiceAttrs,
  serviceAttrIcon,
} from '../core/constants/service-attrs';

// Единый компонент карты-визуала. Фон собирается из image_url + gradient,
// логотип бренда рисуется маской в левом верхнем углу, tier2-иконки сервисов
// компонуются в правом нижнем.
//
// ВНИМАНИЕ: для выпущенных карт (UserCard, с PAN/CVV/expiry) используется
// собственный layout .bank в home.page.ts — этот компонент НЕ его заменяет.
@Component({
  selector: 'app-card-tile',
  standalone: true,
  imports: [CachedBgDirective, BrandLogoComponent],
  template: `<div class="tile"
       [attr.data-gradient]="product().gradient"
       [appCachedBg]="product().image_url"
       [appCachedBgGradient]="product().gradient">
    <div class="scrim"></div>

    <app-brand-logo class="brand-logo" [label]="serviceName" [ink]="inkColor" />

    <div class="foot">
      <div class="pan">
        <!-- Две версии маски: полная для широких контейнеров (mobile full-width
             карта, карусель), компактная для узких (catalog-row на десктопе,
             где карта 180-240px). Переключение через @container ниже. -->
        <span class="pan-full">•••• •••• •••• 1234</span>
        <span class="pan-short">•••• 1234</span>
      </div>
      @if (showServiceIcons() && tier2().length > 0) {
        <div class="icons">
          @for (k of tier2(); track k) {
            <span class="icon" [title]="labelFor(k)">
              <img [src]="iconFor(k)" [alt]="labelFor(k)" loading="lazy" />
            </span>
          }
        </div>
      }
    </div>
  </div>`,
  styles: [`
    :host { display: block; width: 100%; }
    .tile {
      position: relative;
      width: 100%;
      aspect-ratio: 1.586 / 1;
      border-radius: clamp(10px, 4cqi, 18px);
      padding: clamp(12px, 6cqi, 22px);
      color: var(--color-on-dark);
      background: linear-gradient(135deg, #2563eb 0%, #1e40af 100%);
      background-size: cover; background-position: center;
      box-shadow: 0 8px 22px rgba(20, 20, 19, .18);
      display: flex; flex-direction: column; justify-content: space-between;
      container-type: inline-size;
      overflow: hidden;
    }
    .tile[data-gradient="dark"] { background: linear-gradient(135deg, #181715 0%, #2d2a25 100%); }
    .tile[data-gradient="gold"] { background: linear-gradient(135deg, #d4a017 0%, #8c6a0b 100%); }
    /* Scrim — двусторонний градиент: верх+низ затемнены для читаемости
       бренда и PAN/иконок на ярких admin-фонах. */
    .scrim {
      position: absolute; inset: 0;
      background:
        linear-gradient(180deg, rgba(0,0,0,.30) 0%, transparent 28%, transparent 55%, rgba(0,0,0,.55) 100%),
        radial-gradient(circle at top right, rgba(255,255,255,.12), transparent 55%);
      pointer-events: none;
    }

    .brand-logo, .foot { position: relative; z-index: 1; }

    /* Название бренда вшито в сам логотип, поэтому подписи рядом нет — и
       квадратной коробки под знак тоже: задаём ВЫСОТУ, а ширину берём с
       запасом под широкий лого-локап (у «Хочу Плачу!» ~2.6:1). mask-size:
       contain + позиция слева = знак любой пропорции рисуется в натуральную
       высоту, не тянется и не обрезается; квадратный логотип другого бренда
       просто прижмётся влево. Цвет букв — БЕЛЫЙ (вход ink): карта-визуал
       всегда тёмная (градиент + scrim), чёрная надпись на ней бы утонула;
       фирменный акцент (лапка) остаётся своим цветом, см. BrandLogoComponent. */
    .brand-logo {
      height: clamp(20px, 7.5cqi, 32px); width: clamp(56px, 21cqi, 88px);
    }

    .foot { display: flex; align-items: flex-end; justify-content: space-between; gap: var(--space-sm); }
    .pan {
      font-family: var(--font-mono);
      font-size: clamp(12px, 4.2cqi, 17px); letter-spacing: .08em; opacity: .92;
      white-space: nowrap; overflow: hidden;
      text-shadow: 0 1px 3px rgba(0,0,0,.55);
    }
    /* На широких контейнерах (≥360px — карта на product-detail карусели на
       широком экране) маска визуально крупнее и с более «банковским» трекингом. */
    @container (min-width: 360px) {
      .pan { font-size: clamp(15px, 4.6cqi, 18px); letter-spacing: .12em; }
    }
    .pan-short { display: none; }
    /* Совсем узкая карта (< 240px — обычно очень мелкий viewport ~320 с большим
       padding) — переключаемся на короткую маску, чтобы избежать обрезки. */
    @container (max-width: 240px) {
      .pan-full { display: none; }
      .pan-short { display: inline; }
    }
    /* Stacked avatars — иконки сервисов внахлёст, как у Booking/Airbnb-карт
       в банковских приложениях. Компактная группа в правом нижнем углу. */
    .icons { display: flex; align-items: center; justify-content: flex-end; max-width: 70%; }
    .icon {
      display: inline-flex; align-items: center; justify-content: center;
      width: clamp(23px, 6.9cqi, 30px); height: clamp(23px, 6.9cqi, 30px);
      border-radius: 50%;
      background: #fff;
      box-shadow: 0 0 0 1.5px #fff, 0 2px 6px rgba(0,0,0,.40);
      overflow: hidden; flex-shrink: 0;
    }
    .icon + .icon { margin-left: -4px; }
    .icon img { width: 100%; height: 100%; object-fit: cover; }
  `],
})
export class CardTileComponent {
  private readonly cfg = inject(RuntimeConfigService);

  readonly product = input.required<CardProduct>();
  /** Показывать ли tier2 service icons (Google Pay/Apple Pay/...) в правом
   *  нижнем углу. true для каталога, false для карусели на product-detail,
   *  где такие иконки и так выведены отдельной секцией под картой. */
  readonly showServiceIcons = input<boolean>(true);

  protected readonly serviceName = this.cfg.brand.service_name;
  protected readonly tier2 = computed<ServiceAttr[]>(() => filterServiceAttrs(this.product().tier2_attrs));
  /** Цвет надписи в логотипе на карте — тот же, которым набран текст карты. */
  protected readonly inkColor = 'var(--color-on-dark, #fff)';

  protected iconFor(k: ServiceAttr): string { return serviceAttrIcon(k); }
  protected labelFor(k: ServiceAttr): string { return SERVICE_ATTR_LABELS[k] ?? k; }
}
