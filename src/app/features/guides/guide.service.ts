import { Injectable, computed, signal } from '@angular/core';

export interface GuideStep {
  id: string;
  title: string;
  desc: string;
}

// GUIDE_IMG — одна статичная картинка для всех шагов (не по одной на
// каждый) — кружок в углу гайд-бокса. Путь-заглушка, положи реальный файл
// сюда (или поправь путь на свой).
export const GUIDE_IMG = '/assets/coins/mascot.png';

// GUIDE_STEPS — сценарий тура «как купить карту» (см. GuideService для
// логики запуска/остановки). Порядок и id должны совпадать с
// [appGuideTarget]="'...'" на реальных элементах страниц — см. комментарии
// у каждого шага, где именно он вешается. desc содержит <span class="acc">
// вокруг акцентного слова — рендерится через [innerHTML] в оверлее (см.
// guide-overlay.component.ts), не через {{ }}.
export const GUIDE_STEPS: GuideStep[] = [
  // 1. Иконка «Карты» в нижней навигации.
  { id: 'nav-cards', title: 'Оформление карты', desc: 'В этой вкладке выпускается виртуальная <span class="acc">карта</span>' },
  // 2. Кнопка «Выпустить карту» на главной (для тех, у кого карт ещё нет).
  { id: 'issue-cta', title: 'Выпустите карту', desc: 'Нажмите, чтобы перейти к <span class="acc">выбору</span> карты' },
  // 3. Любая карточка каталога на /cards/new.
  { id: 'catalog-row', title: 'Выберите карту', desc: 'Нажмите на карту для оформления — подойдёт <span class="acc">любая</span>' },
  // 4. Кнопка «Выпустить карту» на странице конкретного продукта.
  { id: 'product-cta', title: 'Выпустить карту', desc: 'Нажмите, чтобы перейти к <span class="acc">оформлению</span>' },
  // 5. Блок промокода + кнопка оплаты на чекауте.
  { id: 'checkout-pay', title: 'Промокод и оплата', desc: 'Здесь можно ввести свой <span class="acc">промокод</span> и оплатить карту' },
  // 6. Финальный шаг — без подсветки конкретного элемента (targetEl будет
  // null, оверлей просто центрирует бокс без «дырки»).
  {
    id: 'finish',
    title: 'Готово!',
    desc: 'Вот вы и узнали, как купить карту. А чтобы узнать, как оплачивать <span class="acc">сервисы</span> — загляните в <a href="https://t.me/hochuplachuguidesbot" class="acc">Хочу Плачу! | Гайды</a>',
  },
];

@Injectable({ providedIn: 'root' })
export class GuideService {
  readonly steps = GUIDE_STEPS;

  readonly active = signal(false);
  readonly stepIndex = signal(0);

  readonly currentStep = computed<GuideStep | null>(() => (this.active() ? this.steps[this.stepIndex()] : null));
  readonly currentTargetId = computed<string | null>(() => this.currentStep()?.id ?? null);
  readonly isFirst = computed(() => this.stepIndex() === 0);
  readonly isLast = computed(() => this.stepIndex() >= this.steps.length - 1);

  // targetEl — реальный DOM-элемент текущего шага. Директива appGuideTarget
  // на странице сама регистрирует/снимает себя здесь при смене шага —
  // сервис не ищет элементы по селекторам, только принимает то, что ему
  // отдают уже смонтированные директивы (переживает переходы между
  // страницами: на новой странице просто смонтируется другая директива
  // с нужным id и перерегистрируется сама).
  readonly targetEl = signal<HTMLElement | null>(null);

  start(): void {
    this.stepIndex.set(0);
    this.targetEl.set(null);
    this.active.set(true);
  }

  next(): void {
    if (this.isLast()) { this.finish(); return; }
    this.targetEl.set(null);
    this.stepIndex.update((i) => i + 1);
  }

  prev(): void {
    if (this.isFirst()) return;
    this.targetEl.set(null);
    this.stepIndex.update((i) => i - 1);
  }

  skip(): void { this.finish(); }

  finish(): void {
    this.active.set(false);
    this.targetEl.set(null);
  }

  registerTarget(id: string, el: HTMLElement): void {
    if (this.currentTargetId() === id) this.targetEl.set(el);
  }

  unregisterTarget(id: string, el: HTMLElement): void {
    if (this.targetEl() === el) this.targetEl.set(null);
  }
}