import { Injectable, PLATFORM_ID, inject } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { RuntimeConfigService } from './runtime-config.service';

// BrandLogoService — отдаёт логотип бренда как ИНЛАЙН-SVG, в котором тёмные
// заливки (буквы названия) заменены на `currentColor`, а остальные цвета
// логотипа сохранены (у «Хочу Плачу!» — жёлтая лапка).
//
// Зачем: логотип с вшитым названием лежит на тёмной карте, а CSS-маска красит
// весь силуэт ОДНИМ цветом — вместе с буквами белой становилась и лапка.
// Инлайн-SVG позволяет перекрасить только тёмное и оставить фирменный акцент.
//
// Источник — `brand.logo_url`. В контейнере это локальный `/assets/logo.{ext}`
// (docker-entrypoint скачивает файл на старте и подменяет URL), поэтому fetch
// идёт same-origin. Если URL остался внешним и CORS не пустил, файл не SVG
// (PNG-логотип другого бренда) или разбор не удался — возвращаем null, и
// вызывающий рисует прежнюю одноцветную маску.
@Injectable({ providedIn: 'root' })
export class BrandLogoService {
  private readonly cfg = inject(RuntimeConfigService);
  private readonly isBrowser = isPlatformBrowser(inject(PLATFORM_ID));
  // Один запрос на сессию: логотип рисуется на каждой карте каталога.
  private request?: Promise<SVGSVGElement | null>;

  /** Подготовленный SVG-шаблон. Зовущий ОБЯЗАН клонировать: элемент один на
   *  всё приложение. null — инлайн недоступен, рисуйте маску. */
  template(): Promise<SVGSVGElement | null> {
    this.request ??= this.load();
    return this.request;
  }

  private async load(): Promise<SVGSVGElement | null> {
    const url = (this.cfg.brand.logo_url ?? '').trim();
    if (!this.isBrowser || !url) return null;
    try {
      const res = await fetch(url, { credentials: 'omit' });
      if (!res.ok) return null;
      const text = await res.text();
      // Content-Type проверяем мягко: nginx отдаёт image/svg+xml, но локальная
      // копия могла лечь под чужим расширением — тогда решает само содержимое.
      const type = (res.headers.get('content-type') ?? '').toLowerCase();
      if (!type.includes('svg') && !/^\s*(<\?xml|<!--|<svg)/i.test(text)) return null;
      return prepare(text);
    } catch {
      return null;
    }
  }
}

// Порог «тёмного»: относительная яркость по WCAG. Буквы нового логотипа —
// #0C0C0C и black (≈0.00), лапка #FFBA26 (≈0.58), так что порог с большим
// запасом разделяет надпись и акцент.
const INK_LUMINANCE_MAX = 0.22;

function prepare(source: string): SVGSVGElement | null {
  const doc = new DOMParser().parseFromString(source, 'image/svg+xml');
  const root = doc.documentElement;
  if (!root || root.nodeName.toLowerCase() !== 'svg' || doc.querySelector('parsererror')) return null;
  const svg = root as unknown as SVGSVGElement;

  // Файл берётся из brand-конфига (его задаёт оператор, не пользователь), но
  // это всё равно чужой документ, который мы вставляем в DOM: выносим скрипты,
  // обработчики событий и внешние ссылки.
  for (const el of Array.from(svg.querySelectorAll('script, foreignObject'))) el.remove();
  for (const el of [svg, ...Array.from(svg.querySelectorAll('*'))]) {
    for (const attr of Array.from(el.attributes)) {
      const name = attr.name.toLowerCase();
      if (name.startsWith('on')) el.removeAttribute(attr.name);
      if ((name === 'href' || name === 'xlink:href') && !attr.value.trim().startsWith('#')) {
        el.removeAttribute(attr.name);
      }
    }
  }

  // Размер задаёт CSS хоста, поэтому собственные width/height убираем, а
  // viewBox оставляем — без него неоткуда взять пропорции. preserveAspectRatio
  // повторяет прежнее поведение маски (contain + прижат влево).
  svg.removeAttribute('width');
  svg.removeAttribute('height');
  svg.setAttribute('preserveAspectRatio', 'xMinYMid meet');
  svg.setAttribute('focusable', 'false');
  svg.setAttribute('aria-hidden', 'true');
  // Абсолютное позиционирование — чтобы подмена маски на инлайн не двигала
  // вёрстку (оба слоя лежат в одной коробке хоста).
  svg.style.position = 'absolute';
  svg.style.inset = '0';
  svg.style.width = '100%';
  svg.style.height = '100%';

  recolorInk(svg);
  return svg;
}

/** Тёмные заливки → currentColor. Всё остальное (акцентные цвета, `none`,
 *  градиенты через url(...)) остаётся как нарисовано. */
function recolorInk(svg: SVGSVGElement): void {
  for (const el of [svg, ...Array.from(svg.querySelectorAll('*'))]) {
    const attr = el.getAttribute('fill');
    if (attr && isInk(attr)) el.setAttribute('fill', 'currentColor');
    const style = (el as SVGElement).style;
    if (style?.fill && isInk(style.fill)) style.fill = 'currentColor';
  }
}

function isInk(color: string): boolean {
  const rgb = parseColor(color);
  return rgb !== null && luminance(rgb) <= INK_LUMINANCE_MAX;
}

/** Разбирает только те формы записи цвета, которые реально встречаются в
 *  экспорте SVG: #rgb, #rrggbb, rgb()/rgba() и слово `black`. Всё прочее —
 *  null, то есть «не трогаем». */
function parseColor(raw: string): [number, number, number] | null {
  const v = raw.trim().toLowerCase();
  if (v === 'black') return [0, 0, 0];
  if (/^#[0-9a-f]{3}$/.test(v)) {
    return [v[1], v[2], v[3]].map((c) => parseInt(c + c, 16)) as [number, number, number];
  }
  if (/^#[0-9a-f]{6}$/.test(v)) {
    return [v.slice(1, 3), v.slice(3, 5), v.slice(5, 7)].map((c) => parseInt(c, 16)) as [number, number, number];
  }
  const m = /^rgba?\(([^)]+)\)$/.exec(v);
  if (m) {
    const parts = m[1].split(/[,\s/]+/).filter(Boolean).slice(0, 3).map(Number);
    if (parts.length === 3 && parts.every((n) => Number.isFinite(n))) return parts as [number, number, number];
  }
  return null;
}

function luminance([r, g, b]: [number, number, number]): number {
  const channel = (c: number): number => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}
