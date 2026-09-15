import { Directive, ElementRef, effect, inject, input } from '@angular/core';
import { ImageCacheService } from './image-cache.service';
import { makeCardBg } from './card-bg';

// CachedBgDirective — ставит на host CSS background, собранный из закешированной
// картинки (blob URL из Cache Storage) и градиента-фолбэка. Пока картинка
// резолвится, отображаем только градиент — это устраняет «моргание»
// сетевого запроса при reload, фоны карт переживают перезагрузку.
@Directive({
  selector: '[appCachedBg]',
  standalone: true,
})
export class CachedBgDirective {
  readonly imageUrl = input<string | null | undefined>(null, { alias: 'appCachedBg' });
  readonly gradient = input<string | null | undefined>(null, { alias: 'appCachedBgGradient' });
  // mode: 'card' — собираем фон через makeCardBg (картинка cover + gradient);
  //       'page' — простая комбинация для bg-страницы продукта (картинка cover
  //       поверх gradient или transparent).
  readonly mode = input<'card' | 'page'>('card', { alias: 'appCachedBgMode' });

  private readonly el = inject(ElementRef<HTMLElement>);
  private readonly cache = inject(ImageCacheService);

  constructor() {
    effect(async (onCleanup) => {
      const rawImg = (this.imageUrl() ?? '').trim();
      const grad = (this.gradient() ?? '').trim();
      const mode = this.mode();

      let cancelled = false;
      onCleanup(() => { cancelled = true; });

      // Сразу выставляем фолбэк без картинки, чтобы UI не оставался пустым,
      // пока Cache API резолвит blob.
      this.apply(this.compose('', grad, mode));

      if (!rawImg) return;
      const resolved = await this.cache.resolve(rawImg);
      if (cancelled) return;
      this.apply(this.compose(resolved, grad, mode));
    });
  }

  private compose(img: string, grad: string, mode: 'card' | 'page'): string | null {
    if (mode === 'card') return makeCardBg(img, grad);
    if (!img && !grad) return null;
    const base = grad || 'transparent';
    if (img) {
      const safe = img.replace(/['"\n\r]/g, '');
      return `url('${safe}') center / cover no-repeat, ${base}`;
    }
    return base;
  }

  private apply(bg: string | null): void {
    const style = this.el.nativeElement.style;
    if (bg) style.background = bg;
    else style.removeProperty('background');
  }
}
