import { Component, DestroyRef, ElementRef, Injector, ViewChild, afterNextRender, computed, effect, inject, signal } from '@angular/core';
import { GUIDE_IMG, GuideService } from './guide.service';
import { openExternalLink } from '../../core/utils/open-external';

// GuideOverlayComponent — подключи ОДИН раз в самом корне приложения
// (app.component.ts рядом с <router-outlet>), чтобы он жил поверх ЛЮБОЙ
// страницы и переживал навигацию между шагами гайда:
//   <router-outlet />
//   <app-guide-overlay />
//
// Механика подсветки — SVG-маска с НЕСКОЛЬКИМИ независимыми вырезами
// (holes()): сам target — один вырез, а каждый его ПОТОМОК, физически
// торчащий за пределы target-а (бейдж «Выбор большинства» и т.п.),
// получает СВОЙ отдельный вырез той же формы/радиуса — маска обтекает
// обе фигуры по отдельности, а не сливает их в один компромиссный
// прямоугольник с одним радиусом на всё.
//
// Клик по подсвеченному элементу продвигает гайд — ОДИН централизованный
// document-слушатель здесь, в overlay (см. конструктор), а НЕ отдельный
// HostListener в каждой директиве appGuideTarget. Раньше клик иногда «не
// срабатывал» на переходе между шагами — децентрализованная логика в
// директиве зависела от точного состояния конкретного экземпляра
// директивы в момент клика, что не всегда было надёжно на persistent-
// компонентах вроде bottom-nav. Один слушатель, всегда читающий АКТУАЛЬНОЕ
// состояние сервиса на момент клика — устойчивее.
//
// .guide-box ставится СТРОГО НИЖЕ или СТРОГО ВЫШЕ target-а — какой стороны
// у экрана больше свободного места, туда и уходит (см. boxPos ниже).
@Component({
  selector: 'app-guide-overlay',
  standalone: true,
  template: `
    @if (guide.active() && step(); as s) {
      <!-- Оверлей затемнения ВСЕГДА смонтирован, пока гайд активен — не
           удаляется и не пересоздаётся в DOM никогда. Меняется только
           СОДЕРЖИМОЕ маски: если holes() пуст (переход между страницами,
           новый target ещё не зарегистрировался) — маска просто сплошная
           белая (= везде затемнено, без дырки), а не пропадает целиком.
           Раньше весь <svg> оборачивался в @if по holes().length>0 —
           это заставляло Angular УДАЛЯТЬ и ПЕРЕСОЗДАВАТЬ весь элемент
           затемнения при каждом временном пробеле между шагами, и само
           это удаление/пересоздание (экран на миг вообще без затемнения)
           и читалось как «мигание» — то есть проблему создавал именно
           этот @if, а не что-то в вычислении геометрии. -->
      <!-- Нативный SVG mask-АТРИБУТ (не CSS mask-image на HTML div —
           тот в Safari не резолвит ссылку на ВНЕШНИЙ <mask> и считает
           элемент полностью невидимым, пропадал даже простой тёмный фон
           без всякого blur). SVG-атрибут mask="url(#...)" — старейший,
           надёжно поддерживаемый способ маскирования, без сюрпризов по
           браузерам. Блюр здесь убран совсем (не работал нигде из
           протестированного — ни в Telegram WebView, ни в Safari), просто
           сплошная тёмная заливка. width/height — ЯВНЫЕ ПИКСЕЛИ (vw()/vh()
           ниже), а не "100%": у Safari известны баги с резолвом
           процентных width/height внутри <mask maskUnits="userSpaceOnUse">
           — маска могла резолвиться в ноль/не резолвиться вовсе, отсюда
           и пропадающий тёмный фон именно в Safari при рабочем Chrome. -->
      <svg class="guide-mask-svg" [attr.width]="vw()" [attr.height]="vh()">
        <defs>
          <mask id="guideMask" maskUnits="userSpaceOnUse" x="0" y="0" [attr.width]="vw()" [attr.height]="vh()">
            <rect x="0" y="0" [attr.width]="vw()" [attr.height]="vh()" fill="white" />
            @for (h of holes(); track $index) {
              <rect [attr.x]="h.left" [attr.y]="h.top" [attr.width]="h.width" [attr.height]="h.height" [attr.rx]="h.radius" fill="black" />
            }
          </mask>
        </defs>
        <rect x="0" y="0" [attr.width]="vw()" [attr.height]="vh()" fill="rgba(20, 20, 19, .72)" mask="url(#guideMask)" />
      </svg>

      <div class="guide-box" #box
           [style.top]="boxPos().top"
           [style.bottom]="boxPos().bottom">
        <span class="guide-img-hole"></span>
        <img class="guide-img" [src]="guideImg" alt="" />
        <div class="guide-title">{{ s.title }}</div>
        <div class="guide-desc" [innerHTML]="s.desc"></div>
        @if (s.id !== 'finish' && holes().length === 0) {
          <!-- Временная диагностика: элемент для этого шага не найден на
             странице (директива appGuideTarget с этим id либо не
             смонтирована вообще, либо ещё не смонтировалась). Убрать
             после того, как разберёмся с "не переходит на второй гайд". -->
          <div class="guide-debug">⚠ Не нашла элемент для этого шага на странице (id: {{ s.id }})</div>
        }
        <div class="guide-controls">
          <div class="guide-arrows">
            <button type="button" class="guide-arrow" [disabled]="guide.isFirst()" (click)="guide.prev()" aria-label="Назад">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 18l-6-6 6-6"/></svg>
            </button>
            <button type="button" class="guide-arrow" (click)="guide.next()" aria-label="Далее">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 6l6 6-6 6"/></svg>
            </button>
          </div>
          <div class="guide-dots">
            @for (st of guide.steps; track st.id; let i = $index) {
              <span class="guide-dot" [class.on]="i === guide.stepIndex()"></span>
            }
          </div>
          <button type="button" class="guide-skip" (click)="guide.skip()">Пропустить</button>
        </div>
      </div>
    }
  `,
  styles: [`
    :host { position: fixed; inset: 0; z-index: 1000; pointer-events: none; }
    /* dvh/dvw — браузер сам пересчитывает при любом изменении видимой
       области (включая адресную строку на мобильных), без JS — устраняет
       белый пробел снизу, который раньше то появлялся, то пропадал при
       скролле. mask="url(#guideMask)" — нативный SVG-атрибут (не CSS
       mask-image), вырезает дырки прямо на <rect> внутри того же SVG. */
    /* Раньше здесь были width:100dvw;height:100dvh — теперь размер SVG
       задаётся явными пиксельными АТРИБУТАМИ [attr.width]/[attr.height]
       (см. vw()/vh() в классе) прямо в разметке, а не через CSS — так
       система координат маски строится из тех же самых чисел, без
       расхождений между CSS-размером бокса и внутренним viewport SVG. */
    .guide-mask-svg { position: fixed; top: 0; left: 0; pointer-events: none; }
    /* guide-active-target — вешается директивой на РЕАЛЬНЫЙ элемент
       страницы (иконка/кнопка/карточка), пока он — активный шаг гайда.
       ::ng-deep обязателен: элемент живёт на совсем другой странице/
       компоненте, обычный scoped-стиль его не достанет. Только color —
       иконки через fill="currentColor" (как в футере) подхватывают
       жёлтый акцент автоматически; на составных элементах со своим явным
       цветом на каждом дочернем узле это может не быть заметно (color-
       наследование туда не пробивается), но подсветка через
       вырез-в-маске (holes()) там уже даёт достаточный акцент сама по
       себе. */
    ::ng-deep .guide-active-target {
      color: rgba(255, 186, 38, 1) !important;
    }
    /* top/bottom приходят из boxPos() — заполнено только одно из двух,
       второе явно 'auto', чтобы не конфликтовали. */
    .guide-box {
      position: fixed;
      left: 16px; right: 16px;
      margin: 0 auto;
      width: min(340px, calc(100vw - 32px));
      background: rgba(255, 255, 255, 1);
      border-radius: var(--rounded-lg, 16px);
      padding: 20px;
      box-shadow: 0 20px 48px rgba(0, 0, 0, .25);
      pointer-events: auto;
    }
    /* Кружок наполовину НАД верхним краем бокса, наполовину внутри —
       top: -37px (половина высоты 74px) центрирует его ровно на линии
       границы. 16px от правого края бокса. */
    .guide-img {
      position: absolute;
      top: -37px; right: 16px;
      width: 74px; height: 74px; border-radius: 50%;
      object-fit: cover;
      z-index: 1;
    }
    /* .guide-img-hole — визуальный «зазор» между картинкой и боксом: круг
       чуть БОЛЬШЕ картинки (82px против 74px), того же полупрозрачного
       серого, что и общий backdrop, лежит ПОД картинкой и ЦЕНТРИРОВАН
       вокруг неё — создаёт иллюзию вырезанной в боксе дырки чуть большего
       диаметра, а не сплошного попадания фото на белый фон. */
    .guide-img-hole {
      position: absolute;
      top: -41px; right: 12px;
      width: 82px; height: 82px; border-radius: 50%;
      background: rgba(20, 20, 19, .55);
      z-index: 0;
    }
    .guide-title {
      font-family: 'Raleway', sans-serif; font-weight: 600; font-size: 24px;
      color: var(--color-ink, #141413);
      max-width: calc(100% - 74px - 12px);
    }
    .guide-desc {
      margin-top: 12px;
      font-size: 16px; color: var(--color-ink, #141413);
      line-height: 1.4;
    }
    /* Временная диагностика (см. комментарий в шаблоне) — убрать вместе
       с самим @if, когда разберёмся с багом. */
    .guide-debug {
      margin-top: 10px;
      padding: 8px 10px;
      background: rgba(220, 53, 69, .1);
      border: 1px dashed rgba(220, 53, 69, .5);
      border-radius: 8px;
      font-size: 13px;
      color: rgba(180, 30, 40, 1);
    }
    /* .acc — акцентное слово в описании шага: жирный текст + жёлтая
       полоска-подложка снизу. ::ng-deep обязателен — .acc приходит через
       [innerHTML], такие узлы не получают _ngcontent-xxx, которым Angular
       размечает scoped-стили компонента, и без ::ng-deep правило никогда
       не совпадает с инжектированным спаном. */
    ::ng-deep .guide-desc .acc {
      font-weight: 700;
      background-image: linear-gradient(rgba(255, 186, 38, 1), rgba(255, 186, 38, 1));
      background-repeat: no-repeat;
      background-size: 100% 4px;
      background-position: 0 100%;
      padding-bottom: 2px;
    }
    .guide-controls {
      margin-top: 12px;
      display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between;
      gap: 12px;
    }
    .guide-arrows { display: flex; gap: 8px; flex-shrink: 0; }
    .guide-arrow {
      display: inline-flex; align-items: center; justify-content: center;
      padding: 12px;
      border-radius: 999px;
      border: 0.83px solid rgba(238, 238, 238, 1);
      box-shadow: 0px 18.16px 43.25px -12px rgba(0, 0, 0, 0.55);
      background: #fff;
      cursor: pointer;
      color: var(--color-ink, #141413);
      flex-shrink: 0;
    }
    .guide-arrow:disabled { opacity: .35; cursor: default; }
    .guide-dots { display: flex; align-items: center; gap: 6px; flex-shrink: 0; }
    .guide-dot {
      width: 6px; height: 6px; border-radius: 50%;
      background: rgba(200, 200, 200, 1);
      flex-shrink: 0;
    }
    .guide-dot.on { background: rgba(255, 186, 38, 1); }
    .guide-skip {
      padding: 16px 24px;
      border-radius: 8px;
      font-size: 12px;
      background: var(--color-surface-card, #f4f4f4);
      border: none;
      cursor: pointer;
      color: var(--color-ink, #141413);
      white-space: nowrap;
      flex-shrink: 0;
    }
  `],
})
export class GuideOverlayComponent {
  protected readonly guide = inject(GuideService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly injector = inject(Injector);
  protected readonly step = computed(() => this.guide.currentStep());
  protected readonly guideImg = GUIDE_IMG;

  // #box + ViewChild — ссылка на реальный DOM-узел .guide-box, нужна
  // чтобы переигрывать анимацию появления через Web Animations API
  // (.animate()) при КАЖДОЙ смене шага, а не только при первом
  // монтировании компонента. Angular's @if не пересоздаёт DOM-узел между
  // шагами (гайд остаётся активным — меняется только его СОДЕРЖИМОЕ),
  // поэтому обычная CSS animation на классе сыграла бы только один раз;
  // .animate() запускается императивно и гарантированно переигрывает
  // каждый раз — плавный заход отделяет подсказку от интерфейса на
  // уровне анимации (по фидбеку владельца).
  @ViewChild('box') private boxRef?: ElementRef<HTMLElement>;

  private readonly tick = signal(0);

  // vw/vh — размеры SVG-маски в явных пикселях (не "100%"/dvw-dvh на
  // самом SVG) — см. комментарий у <svg> в шаблоне про баг Safari с
  // процентными width/height внутри <mask maskUnits="userSpaceOnUse">.
  // Обновляются тем же tick (resize/scroll), что и остальная геометрия.
  protected readonly vw = computed(() => { this.tick(); return window.innerWidth; });
  protected readonly vh = computed(() => { this.tick(); return window.innerHeight; });

  // holes — ОДИН вырез под сам target, плюс отдельный вырез под КАЖДОГО
  // его потомка, который физически торчит за пределы target-а (бейдж
  // «Выбор большинства» и т.п.) — каждый со своей формой/радиусом, маска
  // облегает обе фигуры по отдельности. Радиус торчащего потомка
  // пересчитан ПОД расширенный (на EPS_STICK) размер — для пилюли
  // (rx = половина высоты, как у бейджа) радиус, посчитанный для
  // исходного размера, на увеличенном прямоугольнике уже не даёт
  // идеальную полукруглую границу (rx оказывается чуть меньше половины
  // новой высоты) — отсюда мог оставаться маленький зазор ровно по краю
  // скруглённого конца.
  protected readonly holes = computed(() => {
    this.tick();
    const el = this.guide.targetEl();
    if (!el) return [];
    // Если сохранённый элемент выпал из DOM (страница уже сменилась, а
    // ссылка на старый узел почему-то осталась) — считаем, что target-а
    // нет вовсе, а не продолжаем светить «призрак».
    if (!document.body.contains(el)) return [];
    const EPS_MAIN = this.step()?.id === 'nav-cards' ? 8 : 0;
    const EPS_STICK = 2;
    const base = el.getBoundingClientRect();
    const out = [{
      top: base.top - EPS_MAIN, left: base.left - EPS_MAIN,
      width: base.width + EPS_MAIN * 2, height: base.height + EPS_MAIN * 2,
      radius: this.numericRadius(el),
    }];

    const descendants = el.querySelectorAll('*');
    for (let i = 0; i < descendants.length; i++) {
      const child = descendants[i] as HTMLElement;
      const dr = child.getBoundingClientRect();
      if (dr.width === 0 && dr.height === 0) continue;
      const sticksOut = dr.top < base.top - 0.5 || dr.left < base.left - 0.5
        || dr.right > base.right + 0.5 || dr.bottom > base.bottom + 0.5;
      if (!sticksOut) continue;
      // Пропускаем, если родитель ТОЖЕ торчит — тот уже даст более
      // крупный вырез, покрывающий этого ребёнка, свой вырез избыточен.
      const parent = child.parentElement;
      if (parent && parent !== el) {
        const pr = parent.getBoundingClientRect();
        const parentSticksOut = pr.top < base.top - 0.5 || pr.left < base.left - 0.5
          || pr.right > base.right + 0.5 || pr.bottom > base.bottom + 0.5;
        if (parentSticksOut) continue;
      }
      const expandedHeight = dr.height + EPS_STICK * 2;
      const baseRadius = this.numericRadius(child);
      const adjustedRadius = baseRadius >= dr.height / 2 - 0.5
        ? expandedHeight / 2
        : baseRadius + EPS_STICK;
      out.push({
        top: dr.top - EPS_STICK, left: dr.left - EPS_STICK,
        width: dr.width + EPS_STICK * 2, height: expandedHeight,
        radius: adjustedRadius,
      });
    }
    return out;
  });

  // numericRadius — border-radius элемента В ПИКСЕЛЯХ (число, не CSS-строка)
  // — SVG-атрибут rx понимает только число. Если у самого элемента радиус
  // нулевой — спускаемся по первым детям (до 4 уровней), пока не найдём
  // реально заданный. Дефолт-фолбэк — 4px (маленькие элементы вроде
  // иконки в футере без своего радиуса нигде по цепочке).
  private numericRadius(el: HTMLElement): number {
    let node: HTMLElement | null = el;
    for (let i = 0; i < 4 && node; i++) {
      const value = parseFloat(getComputedStyle(node).borderRadius);
      if (value > 0) return value;
      node = node.firstElementChild as HTMLElement | null;
    }
    return 4;
  }

  protected readonly boxPos = computed<{ top: string; bottom: string }>(() => {
    const hs = this.holes();
    const safeBottom = 'max(16px, env(safe-area-inset-bottom, 0px))';
    if (hs.length === 0) return { top: 'auto', bottom: safeBottom };
    let top = hs[0].top, bottom = hs[0].top + hs[0].height;
    for (const h of hs) {
      if (h.top < top) top = h.top;
      if (h.top + h.height > bottom) bottom = h.top + h.height;
    }
    const vh = window.innerHeight;
    const spaceBelow = vh - bottom;
    const spaceAbove = top;
    if (spaceBelow >= spaceAbove) {
      return { top: `${bottom + 12}px`, bottom: 'auto' };
    }
    return { top: 'auto', bottom: `${vh - top + 12}px` };
  });

  constructor() {
    const bump = (): void => this.tick.update((v) => v + 1);
    window.addEventListener('scroll', bump, { passive: true, capture: true });
    window.addEventListener('resize', bump, { passive: true });

    // Анимация появления окошка с инструкцией — при КАЖДОЙ смене шага
    // (переход между роутами включительно), не только при первом показе.
    // Лёгкое всплытие снизу + fade — отделяет подсказку от интерфейса на
    // уровне анимации, а не просто резкая смена текста. afterNextRender
    // вместо голого setTimeout(0) — гарантирует, что Angular УЖЕ
    // закоммитил DOM для .guide-box (особенно важно на самом первом
    // шаге, когда элемент только-только появляется в разметке —
    // setTimeout(0) не даёт такой гарантии, boxRef мог быть ещё
    // не готов, и .animate() тихо ничего не делал).
    effect(() => {
      this.step();
      afterNextRender(() => {
        const el = this.boxRef?.nativeElement;
        if (!el) return;
        el.animate(
          [
            { opacity: 0, transform: 'translateY(28px) scale(0.96)' },
            { opacity: 1, transform: 'translateY(0) scale(1)' },
          ],
          { duration: 420, easing: 'cubic-bezier(0.16, 1, 0.3, 1)', fill: 'backwards' },
        );
      }, { injector: this.injector });
    });

    // При смене target-а координаты не сразу совпадают с реальным
    // положением сразу после навигации (без ручного скролла). Пересчёт
    // ЗДЕСЬ (в самом оверлее) конфликтовал с CSS-анимацией перехода
    // страницы (View Transition) — принудительный getBoundingClientRect()
    // форсирует синхронный reflow, и если это происходит ПОКА браузер
    // одновременно анимирует ::view-transition-old/new(root), анимация
    // дёргается — то самое «мигание». Настоящее решение — не подбирать
    // тайминг пересчёта здесь, а вообще НЕ ЗАПУСКАТЬ анимацию перехода
    // для роута каталога: см. onViewTransitionCreated в app.config.ts
    // (skipTransition для data:{catalog:true}) — раз анимации не будет,
    // пересчёту здесь не с чем конфликтовать, и можно спокойно досчитать
    // геометрию до конца. Со сходимостью (а не секунду вхолостую): на
    // уже устаканенной раскладке останавливается почти сразу, 1-2 кадра.
    effect(() => {
      this.guide.targetEl();
      const deadline = Date.now() + 1000;
      let prevKey = '';
      let stableFrames = 0;
      const keyOf = (): string => JSON.stringify(this.holes());
      const loop = (): void => {
        bump();
        const key = keyOf();
        stableFrames = key === prevKey ? stableFrames + 1 : 0;
        prevKey = key;
        if (stableFrames >= 2) return;
        if (Date.now() < deadline) requestAnimationFrame(loop);
      };
      requestAnimationFrame(loop);
    });

    // Централизованный обработчик клика по target-у — capture:true ловит
    // клик РАНЬШЕ, чем он дойдёт до самого элемента и его собственных
    // обработчиков (routerLink и т.п.), но next() всё равно откладываем на
    // макротаск, чтобы обычное действие клика (навигация) успело
    // отработать своим чередом — мы не вызываем preventDefault/
    // stopPropagation, просто ЧИТАЕМ событие раньше остальных.
    const onDocClick = (e: MouseEvent): void => {
      if (!this.guide.active()) return;
      const clickedEl = e.target as HTMLElement | null;
      // Клик по самому гайд-боксу (стрелки, точки, «Пропустить», ссылка на
      // бота) — всегда пропускаем как есть, у него свои (click)-биндинги
      // в шаблоне. Только этот блок не подчиняется общей блокировке ниже.
      if (clickedEl?.closest('.guide-box')) {
        // Ссылка на бота-гайд (финальный шаг, desc содержит <a
        // href="https://t.me/...">) — это Telegram Mini App, обычный
        // переход по href может увести из мини-аппа некорректно.
        // Перехватываем клик именно по t.me-ссылкам внутри .guide-desc и
        // открываем через openExternalLink — тот же путь, что и для
        // внешних ссылок в checkout.page.ts (redirect-режим СБП).
        const link = clickedEl.closest('.guide-desc a[href^="https://t.me/"]') as HTMLAnchorElement | null;
        if (link) {
          e.preventDefault();
          openExternalLink(link.href);
        }
        return;
      }
      // Два РАЗНЫХ понятия: highlightTarget — вся подсвеченная область
      // (маска/вырез), клики ВНУТРИ неё не блокируются вообще (можно
      // печатать в поле промокода, тыкать чекбокс и т.п. — это НЕ
      // продвигает гайд, но и не должно блокироваться). advanceTarget —
      // более узкий clickTargetEl, если он зарегистрирован для этого шага
      // (appGuideClickTarget, напр. кнопка «Перейти к оплате» внутри
      // целиком подсвеченного блока) — ТОЛЬКО клик по нему продвигает
      // гайд. Если clickTargetEl не зарегистрирован — advanceTarget тот
      // же, что и highlightTarget (подсветка и клик — один элемент, как
      // было раньше на всех остальных шагах).
      const highlightTarget = this.guide.targetEl();
      const advanceTarget = this.guide.clickTargetEl() ?? highlightTarget;
      const insideHighlight = !!highlightTarget && (highlightTarget === clickedEl || highlightTarget.contains(clickedEl));
      const insideAdvance = !!advanceTarget && (advanceTarget === clickedEl || advanceTarget.contains(clickedEl));
      // Клик мимо ВСЕЙ подсвеченной области — по просьбе владельца, чтобы
      // пользователь не путался и не мог случайно уйти со страницы во
      // время гайда, гасим его ПОЛНОСТЬЮ (preventDefault останавливает
      // действие по умолчанию — переход по ссылке/сабмит, stopPropagation
      // не даёт событию дойти до собственных обработчиков кликнутого
      // элемента вроде routerLink). Скролл эти методы не трогают вообще
      // — им управляют отдельные wheel/touch-события браузера, так что
      // скроллить страницу во время гайда всё равно можно.
      if (!insideHighlight) {
        e.preventDefault();
        e.stopPropagation();
        return;
      }
      // Клик ВНУТРИ подсветки, но не по узкому advance-target-у (если он
      // задан) — не блокируем (поле промокода и т.п. остаются рабочими),
      // просто не продвигаем гайд.
      if (!insideAdvance) return;
      setTimeout(() => this.guide.next(), 50);
    };
    document.addEventListener('click', onDocClick, { capture: true });
    this.destroyRef.onDestroy(() => {
      window.removeEventListener('scroll', bump, true);
      window.removeEventListener('resize', bump);
      document.removeEventListener('click', onDocClick, true);
    });
  }
}