import { Directive, ElementRef, OnDestroy, effect, inject, input } from '@angular/core';
import { GuideService } from './guide.service';

// [appGuideTarget]="'issue-cta'" — повесь на элемент, который гайд должен
// подсветить на соответствующем шаге (id должен совпадать с GuideStep.id
// в guide.service.ts). Директива сама следит за текущим шагом и
// регистрируется/снимается в GuideService — верстальщику достаточно один
// раз проставить атрибут на нужный элемент, дальше сервис сам решает,
// когда его подсвечивать. Переживает переходы между страницами: элемент
// со старой страницы уничтожается (ngOnDestroy снимает регистрацию), на
// новой — монтируется другая директива с нужным id для следующего шага.
//
// guide-active-target — CSS-класс, который директива сама вешает на
// host, пока ЭТОТ конкретный элемент — активный target гайда. Глобальный
// стиль под этот класс — в guide-overlay.component.ts (::ng-deep), один
// на всё приложение: элементы (иконки через fill="currentColor", текст
// кнопок и т.д.) получают акцентный жёлтый цвет автоматически, без
// правки CSS каждой отдельной страницы.
//
// ВАЖНО: продвижение гайда по клику здесь НЕ обрабатывается — раньше тут
// был собственный @HostListener('click'), но это дублировало
// централизованный document-слушатель в guide-overlay.component.ts:
// клик по target-у срабатывал ДВАЖДЫ (тут и там), и guide.next() вызывался
// два раза подряд — гайд перескакивал сразу через шаг, что выглядело как
// «кнопка вперёд не работает» (на деле работала, но перескакивала).
// Директива теперь отвечает ТОЛЬКО за регистрацию/подсветку — клик
// целиком на оверлее, единственном источнике истины по кликам.
@Directive({ selector: '[appGuideTarget]', standalone: true })
export class GuideTargetDirective implements OnDestroy {
  private readonly guide = inject(GuideService);
  private readonly el = inject(ElementRef<HTMLElement>);
  readonly appGuideTarget = input.required<string | null>();

  constructor() {
    effect(() => {
      const id = this.appGuideTarget();
      const isActive = !!id && this.guide.currentTargetId() === id;
      this.el.nativeElement.classList.toggle('guide-active-target', isActive);
      if (isActive) {
        this.guide.registerTarget(id!, this.el.nativeElement);
      }
    });
  }

  ngOnDestroy(): void {
    const id = this.appGuideTarget();
    if (id) {
      this.el.nativeElement.classList.remove('guide-active-target');
      this.guide.unregisterTarget(id, this.el.nativeElement);
    }
  }
}