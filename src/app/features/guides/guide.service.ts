import { Injectable, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';

export interface GuideStep {
  id: string;
  title: string;
  desc: string;
  /** Статичный маршрут этого шага — ЗАРАНЕЕ известный URL, где живёт его
   *  target. Есть только у шагов, чья страница не зависит от контекста
   *  (не от конкретного id продукта и т.п.) — у product-cta/checkout-pay
   *  его нет (динамический /cards/:id, узнаётся только когда пользователь
   *  реально доходит до конкретного продукта в каталоге). Используется
   *  ТОЛЬКО как fallback для next(), когда стрелка «→» продвигает шаг
   *  вперёд БЕЗ клика по самому target-у (клик по target-у и так
   *  естественно переходит на нужную страницу сам, через routerLink). */
  route?: string;
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
  { id: 'nav-cards', title: 'Оформление карты', desc: 'В этой вкладке выпускается виртуальная <span class="acc">карта</span>', route: '/' },
  // 2. Кнопка «Выпустить карту» на главной (для тех, у кого карт ещё нет).
  { id: 'issue-cta', title: 'Выпустите карту', desc: 'Нажмите, чтобы перейти к <span class="acc">выбору</span> карты', route: '/cards' },
  // 3. Любая карточка каталога на /cards/new.
  { id: 'catalog-row', title: 'Выберите карту', desc: 'Нажмите на карту для оформления — подойдёт <span class="acc">любая</span>', route: '/cards/new' },
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
  private readonly router = inject(Router);

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

  // clickTargetEl — необязательный БОЛЕЕ УЗКИЙ элемент внутри targetEl,
  // по которому ЗАСЧИТЫВАЕТСЯ клик для продвижения гайда, если он
  // зарегистрирован для текущего шага (appGuideClickTarget). Подсветка
  // (маска/вырез) продолжает опираться на targetEl как раньше — эта
  // штука ТОЛЬКО про то, что считать «кликом по target-у» в оверлее.
  // Большинство шагов её не используют (там кликабельно ровно то, что
  // подсвечено) — null означает «использовать targetEl для клика, как
  // обычно».
  readonly clickTargetEl = signal<HTMLElement | null>(null);

  // stepUrls — URL, на котором РЕАЛЬНО был найден target каждого шага
  // (по индексу шага), заполняется в registerTarget() по мере прохождения
  // гайда вперёд. Нужен, чтобы «Назад» мог вернуть пользователя на
  // правильную страницу — два шага (product-cta, checkout-pay) висят на
  // ДИНАМИЧЕСКОМ URL (/cards/:id, /cards/:id/checkout — конкретный id
  // продукта заранее неизвестен, узнаётся только когда пользователь
  // реально доходит до этого шага в каталоге). Прописать статическую
  // таблицу «шаг → маршрут» для них нельзя — запоминаем ФАКТИЧЕСКИЙ URL
  // в момент, когда target на нём был найден, вместо этого.
  private readonly stepUrls = new Map<number, string>();

  start(): void {
    this.stepIndex.set(0);
    this.targetEl.set(null);
    this.clickTargetEl.set(null);
    this.stepUrls.clear();
    this.active.set(true);
  }

  // next() навигирует сама ТОЛЬКО когда есть куда — стрелка «→» просто
  // продвигает индекс без клика по самому target-у (тот и так естественно
  // переходит на нужную страницу через свой routerLink). Порядок
  // фолбэков: (1) URL, реально запомненный при прошлом прохождении этого
  // шага (stepUrls — на случай если это динамический продукт/чекаут, тут
  // самый точный вариант); (2) статичный route у самого шага (для
  // nav-cards/issue-cta/catalog-row — у них он всегда один и тот же,
  // не зависит от контекста); если нет ни того, ни другого (динамический
  // шаг, который ещё ни разу не посещали) — просто продвигаем индекс,
  // оверлей честно покажет «не нашла элемент», пока пользователь не
  // дойдёт до него обычным кликом по предыдущему target-у.
  next(): void {
    if (this.isLast()) { this.finish(); return; }
    this.targetEl.set(null);
    this.clickTargetEl.set(null);
    const newIndex = this.stepIndex() + 1;
    this.stepIndex.set(newIndex);
    const url = this.stepUrls.get(newIndex) ?? this.steps[newIndex]?.route;
    if (url && url !== this.router.url) {
      this.router.navigateByUrl(url);
    }
  }

  // prev() — в отличие от next() (куда пользователь и так попадает
  // обычной навигацией по клику на сам target), «Назад» ничем, кроме
  // смены индекса, страницу не меняет — если предыдущий шаг был на
  // ДРУГОЙ странице, без явной навигации там просто нечего подсвечивать.
  // Возвращаемся на URL, запомненный в stepUrls для этого индекса; если
  // почему-то не запомнили (шаг ещё не проходили корректно) — остаёмся
  // на месте, оверлей сам покажет «не нашла элемент» вместо дырки.
  prev(): void {
    if (this.isFirst()) return;
    this.targetEl.set(null);
    this.clickTargetEl.set(null);
    const newIndex = this.stepIndex() - 1;
    this.stepIndex.set(newIndex);
    const url = this.stepUrls.get(newIndex);
    if (url && url !== this.router.url) {
      this.router.navigateByUrl(url);
    }
  }

  skip(): void { this.finish(); }

  finish(): void {
    this.active.set(false);
    this.targetEl.set(null);
    this.clickTargetEl.set(null);
    this.stepUrls.clear();
  }

  registerTarget(id: string, el: HTMLElement): void {
    if (this.currentTargetId() === id) {
      this.targetEl.set(el);
      this.stepUrls.set(this.stepIndex(), this.router.url);
    }
  }

  unregisterTarget(id: string, el: HTMLElement): void {
    if (this.targetEl() === el) this.targetEl.set(null);
  }

  registerClickTarget(id: string, el: HTMLElement): void {
    if (this.currentTargetId() === id) this.clickTargetEl.set(el);
  }

  unregisterClickTarget(id: string, el: HTMLElement): void {
    if (this.clickTargetEl() === el) this.clickTargetEl.set(null);
  }
}