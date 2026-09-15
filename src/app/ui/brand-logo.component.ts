import { Component, ElementRef, inject, input, signal } from '@angular/core';
import { DomSanitizer, SafeStyle } from '@angular/platform-browser';
import { BrandLogoService } from '../core/config/brand-logo.service';
import { RuntimeConfigService } from '../core/config/runtime-config.service';

// BrandLogoComponent — логотип бренда, у которого перекрашиваются ТОЛЬКО тёмные
// части (буквы вшитого в знак названия), а фирменный акцент остаётся своим
// цветом. Нужный цвет букв задаётся входом `ink`.
//
// Два режима, переключаются сами:
//  - инлайн-SVG (BrandLogoService) — основной: тёмные заливки заменены на
//    currentColor, лапка остаётся жёлтой;
//  - CSS-маска — фолбэк, пока SVG не загрузился, и навсегда, если логотип не
//    SVG или его не удалось скачать. Маска красит силуэт целиком в тот же
//    `ink` — ровно то поведение, что было до появления инлайна.
//
// Размер задаёт ВЛАДЕЛЕЦ (класс на хосте): у компонента нет своих размеров,
// оба слоя растягиваются по коробке хоста. Коробку не делайте квадратной —
// логотип с названием широкий, см. `.brand-logo` в card-tile/home.page.
@Component({
  selector: 'app-brand-logo',
  standalone: true,
  host: {
    role: 'img',
    '[attr.aria-label]': 'label()',
    '[style.color]': 'ink() || null',
  },
  template: `@if (!inlined()) {
    <span class="mask" [style]="maskStyle"></span>
  }`,
  styles: [`
    :host { display: block; position: relative; }
    /* Маска-фолбэк лежит в той же коробке, что и инлайн-SVG (он позиционируется
       абсолютом в сервисе) — подмена одного другим не двигает вёрстку. */
    .mask {
      position: absolute; inset: 0;
      background-color: currentColor;
      -webkit-mask-repeat: no-repeat; -webkit-mask-position: left center; -webkit-mask-size: contain;
      mask-repeat: no-repeat; mask-position: left center; mask-size: contain;
    }
  `],
})
export class BrandLogoComponent {
  private readonly logo = inject(BrandLogoService);
  private readonly cfg = inject(RuntimeConfigService);
  private readonly sanitizer = inject(DomSanitizer);
  private readonly host = inject(ElementRef<HTMLElement>);

  /** Подпись для скринридера — обычно название сервиса. */
  readonly label = input<string>('');
  /** Цвет тёмных частей логотипа (букв). Пусто — наследуется `color` владельца. */
  readonly ink = input<string>('');

  protected readonly inlined = signal(false);

  constructor() {
    void this.logo.template().then((tpl) => {
      if (!tpl) return;
      this.host.nativeElement.appendChild(tpl.cloneNode(true));
      this.inlined.set(true);
    });
  }

  // mask-image через bypassSecurityTrustStyle — Angular CSS-sanitizer вырезает
  // url() из обычного [style.X] биндинга.
  protected readonly maskStyle: SafeStyle = (() => {
    const safe = (this.cfg.brand.logo_url ?? '').replace(/"/g, '\\"');
    return this.sanitizer.bypassSecurityTrustStyle(
      `-webkit-mask-image: url("${safe}"); mask-image: url("${safe}")`,
    );
  })();
}
