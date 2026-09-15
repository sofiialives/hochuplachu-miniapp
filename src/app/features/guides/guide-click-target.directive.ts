import { Directive, ElementRef, OnDestroy, effect, inject, input } from '@angular/core';
import { GuideService } from './guide.service';

// [appGuideClickTarget]="'checkout-pay'" — необязательная ДОБАВКА к
// [appGuideTarget] на том же шаге, но на ДРУГОМ, более узком элементе.
// Нужна, когда подсвечивать надо ЦЕЛЫЙ блок (промокод + итого + чекбокс +
// кнопка), а продвигать гайд — только по клику на КОНКРЕТНУЮ кнопку внутри
// него, а не по клику куда угодно в подсвеченной области.
//
// [appGuideTarget] остаётся на широком блоке — он отвечает за ПОДСВЕТКУ
// (вырез в маске). Эта директива — ТОЛЬКО за то, какой именно клик
// засчитывается как «продвинуть гайд» (см. onDocClick в
// guide-overlay.component.ts: он смотрит на guide.clickTargetEl(), если
// тот зарегистрирован для текущего шага, и только на targetEl(), если
// нет — так все остальные шаги, где кликабельно ровно то, что подсвечено,
// продолжают работать без изменений, эта директива для них не нужна).
@Directive({ selector: '[appGuideClickTarget]', standalone: true })
export class GuideClickTargetDirective implements OnDestroy {
  private readonly guide = inject(GuideService);
  private readonly el = inject(ElementRef<HTMLElement>);
  readonly appGuideClickTarget = input.required<string | null>();

  constructor() {
    effect(() => {
      const id = this.appGuideClickTarget();
      const isActive = !!id && this.guide.currentTargetId() === id;
      if (isActive) {
        this.guide.registerClickTarget(id!, this.el.nativeElement);
      }
    });
  }

  ngOnDestroy(): void {
    const id = this.appGuideClickTarget();
    if (id) this.guide.unregisterClickTarget(id, this.el.nativeElement);
  }
}
