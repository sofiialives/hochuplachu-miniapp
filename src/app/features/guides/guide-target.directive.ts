import { Directive, ElementRef, HostListener, OnDestroy, effect, inject, input } from '@angular/core';
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

  // Клик по подсвеченному элементу сам продвигает гайд на следующий шаг —
  // НЕ preventDefault/stopPropagation, обычное действие клика (навигация
  // по routerLink, submit и т.д.) должно отработать как обычно. next()
  // отложен на макротаск, чтобы гарантированно сработать ПОСЛЕ остальных
  // click-хендлеров того же элемента (например, routerLink) — иначе
  // порядок между несколькими слушателями клика на одном элементе не
  // гарантирован браузером/Angular. Повторная проверка id ВНУТРИ
  // колбэка (а не только при планировании) — на случай если событие
  // клика по какой-то причине сработало дважды (синтетический click от
  // touch-устройств поверх настоящего) и шаг уже успел продвинуться:
  // тогда второй отложенный вызов не продвинет гайд ещё раз мимо шага.
  @HostListener('click')
  onClick(): void {
    const id = this.appGuideTarget();
    if (!id || this.guide.currentTargetId() !== id) return;
    setTimeout(() => {
      if (this.guide.currentTargetId() === id) this.guide.next();
    }, 50);
  }

  ngOnDestroy(): void {
    const id = this.appGuideTarget();
    if (id) {
      this.el.nativeElement.classList.remove('guide-active-target');
      this.guide.unregisterTarget(id, this.el.nativeElement);
    }
  }
}