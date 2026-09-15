import {
  AfterViewInit,
  Component,
  EventEmitter,
  OnDestroy,
  Output,
  PLATFORM_ID,
  computed,
  inject,
  signal,
} from '@angular/core';
import { isPlatformBrowser } from '@angular/common';

// Порог в пикселях, после которого release триггерит refresh.
const TRIGGER_THRESHOLD = 70;
// Максимальный pull для расчёта прогресса/индикатора.
const MAX_PULL = 160;

// PullToRefresh — мобильный pull-to-refresh контейнер. Использование:
//   <app-pull-to-refresh #ptr (refresh)="onRefresh(ptr)"> ... </app-pull-to-refresh>
//   onRefresh(ptr: PullToRefreshComponent) {
//     this.api.load().subscribe({ next: ..., complete: () => ptr.finishRefresh() });
//   }
// Родитель явно вызывает finishRefresh() когда данные подгрузились, чтобы
// скрыть индикатор. До этого пользователь видит крутящийся spinner.
@Component({
  selector: 'app-pull-to-refresh',
  standalone: true,
  template: `<div class="ptr" [style.transform]="indicatorTransform()">
      <div class="ptr__circle" [class.ptr__circle--ready]="ready()" [class.ptr__circle--spin]="refreshing()">
        @if (refreshing()) {
          <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true">
            <path d="M21 12a9 9 0 1 1-6.219-8.56" />
          </svg>
        } @else {
          <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" [style.transform]="arrowTransform()" aria-hidden="true">
            <path d="M12 5v14M5 12l7 7 7-7" />
          </svg>
        }
      </div>
    </div>
    <ng-content />`,
  styles: [`
    :host { display: block; }
    .ptr {
      /* fixed, не absolute — индикатор всегда у верха viewport, не зависит
         от высоты/скролла хоста. Так он точно перекроет back-bar и любые
         sticky-элементы, и в Telegram fullscreen уйдёт под safe-area. */
      position: fixed;
      top: 0; left: 0; right: 0;
      display: flex; justify-content: center; align-items: flex-start;
      pointer-events: none;
      z-index: 99999;
      /* Видимость управляется одним transform: при pull=0 индикатор стоит
         в translateY(-50px), что уносит его выше viewport и он не виден.
         Никаких opacity/visibility-классов — это исключает гонки между
         change-detection и расчётом transform. */
    }
    .ptr__circle {
      width: 36px; height: 36px;
      display: flex; align-items: center; justify-content: center;
      background: var(--color-surface);
      border: 1px solid var(--color-hairline);
      border-radius: 50%;
      box-shadow: 0 4px 14px rgba(20, 20, 19, .14);
      color: var(--color-muted);
      transition: color .15s ease;
      /* Постоянный отступ 8px. Вертикальное позиционирование кружка целиком
         задаёт indicatorTransform: он ставит центр кружка на центр логотипа
         BackBar (measureAnchorCenter), а тот уже учитывает и notch, и Telegram
         safe-area. Поэтому env()/safe-area сюда НЕ добавляем — иначе вырез
         посчитался бы дважды. */
      margin-top: 8px;
    }
    .ptr__circle--ready { color: var(--color-primary-ink); }
    .ptr__circle--spin svg { animation: ptr-spin .9s linear infinite; transform-origin: 50% 50%; }
    @keyframes ptr-spin { to { transform: rotate(360deg); } }
  `],
})
export class PullToRefreshComponent implements AfterViewInit, OnDestroy {
  @Output() readonly refresh = new EventEmitter<void>();

  private readonly platformId = inject(PLATFORM_ID);

  protected readonly pull = signal(0);
  protected readonly refreshing = signal(false);
  // anchorCenter — экранный Y центра логотипа BackBar (замеряется при активации
  // жеста). К нему прижимаем центр кружка в состоянии refresh и на пике pull,
  // чтобы индикатор оставался «на уровне лого», а не отпрыгивал к верху вьюпорта
  // (в Telegram fullscreen лого опущено под status bar/чром — старый фикс с
  // translateY(20px) от верха экрана оставлял кружок заметно выше лого).
  private readonly anchorCenter = signal(46);
  protected readonly ready = computed(() => this.pull() >= TRIGGER_THRESHOLD);
  protected readonly indicatorTransform = computed(() => {
    // rest — translateY, при котором центр кружка (translateY + margin 8 +
    // радиус 18 = translateY + 26) совпадает с центром логотипа.
    const rest = this.anchorCenter() - 26;
    if (this.refreshing()) return `translateY(${rest}px)`;
    const p = this.pull();
    if (p <= 0) return 'translateY(-50px)'; // спрятан над верхом вьюпорта
    // Резинка: первые 70px идут 1:1 от пальца, после ослабляются (0.4 коэф).
    const eased = p <= TRIGGER_THRESHOLD ? p : TRIGGER_THRESHOLD + (p - TRIGGER_THRESHOLD) * 0.4;
    const visible = Math.min(eased, MAX_PULL);
    // Индикатор выезжает из-за верха (-50) и к порогу доходит ровно до уровня
    // лого (rest); за порогом — резинка чуть ниже rest. На пике = rest, поэтому
    // при отпускании (переход в refreshing → тоже rest) прыжка нет.
    if (visible > TRIGGER_THRESHOLD) return `translateY(${rest + (visible - TRIGGER_THRESHOLD) * 0.4}px)`;
    const progress = visible / TRIGGER_THRESHOLD;
    return `translateY(${-50 + (rest + 50) * progress}px)`;
  });
  protected readonly arrowTransform = computed(() => {
    return this.ready() ? 'rotate(180deg)' : 'rotate(0deg)';
  });

  // pending — палец на экране, ждём решения «куда жест: вертикаль/горизонталь
  // и сверху ли мы». active — приняли решение «это PTR», pull прогрессирует.
  private pending = false;
  private active = false;
  private startY = 0;
  private startX = 0;
  // activationY — clientY в тот момент, когда страница оказалась на самом
  // верху (scrollY <= 0). От него считаем pull-distance, а не от изначальной
  // touchstart-точки. Это позволяет тянуть PTR начиная с середины экрана:
  // пользователь сначала скроллит страницу вверх, потом продолжает движение
  // вниз — PTR подхватывает с момента «упёрлись в верх».
  private activationY = 0;

  // Слушаем touch-события на window, а не на хосте. Причины:
  // 1) На пустых страницах (например, история без транзакций) высота хоста
  //    минимальна — touch на «свободном» поле под контентом не bubble в хост.
  // 2) На странице с картой dom-структура такова, что touch'и тоже могут
  //    идти мимо хоста (карусель + sticky back-bar + т.д.).
  // window-listener ловит ВСЕ touch-события документа. Компонент существует
  // только пока он в DOM (home/history), поэтому конфликта между двумя PTR
  // не будет — Angular выгружает один при навигации на другой.
  private readonly onTouchStartBound = (e: TouchEvent) => this.onTouchStart(e);
  private readonly onTouchMoveBound = (e: TouchEvent) => this.onTouchMove(e);
  private readonly onTouchEndBound = () => this.onTouchEnd();
  private readonly onTouchCancelBound = () => this.onTouchCancel();

  ngAfterViewInit(): void {
    if (!isPlatformBrowser(this.platformId)) return;
    // capture: true — ловим события в capturing-фазе (сверху вниз), до того
    // как любой дочерний компонент успеет вызвать stopPropagation. Без этого
    // на home.page карусель карт и pointer-handlers могли «съесть» события
    // до того, как они доходили до window в bubbling-фазе.
    // passive: false на touchmove — обязательно, иначе preventDefault не
    // сработает (нужен для гашения нативного bounce на iOS после активации).
    window.addEventListener('touchstart', this.onTouchStartBound, { passive: true, capture: true });
    window.addEventListener('touchmove', this.onTouchMoveBound, { passive: false, capture: true });
    window.addEventListener('touchend', this.onTouchEndBound, { passive: true, capture: true });
    window.addEventListener('touchcancel', this.onTouchCancelBound, { passive: true, capture: true });
  }

  ngOnDestroy(): void {
    if (!isPlatformBrowser(this.platformId)) return;
    window.removeEventListener('touchstart', this.onTouchStartBound, { capture: true });
    window.removeEventListener('touchmove', this.onTouchMoveBound, { capture: true });
    window.removeEventListener('touchend', this.onTouchEndBound, { capture: true });
    window.removeEventListener('touchcancel', this.onTouchCancelBound, { capture: true });
  }

  // measureAnchorCenter — экранный Y центра логотипа BackBar. К нему потом
  // прижимаем кружок индикатора. Меряем реальный элемент (getBoundingClientRect),
  // поэтому вырез устройства и Telegram safe-area учитываются автоматически, без
  // магических констант. Страницы без BackBar (напр. /history) → прежняя
  // позиция (46 ≈ translateY 20 + margin 8 + радиус 18).
  private measureAnchorCenter(): void {
    if (!isPlatformBrowser(this.platformId)) return;
    const el = document.querySelector('app-back-bar .brand') as HTMLElement | null;
    const r = el?.getBoundingClientRect();
    this.anchorCenter.set(r && r.height > 0 ? r.top + r.height / 2 : 46);
  }

  // Вызывается родителем когда данные подгрузились — скрываем индикатор.
  finishRefresh(): void {
    this.refreshing.set(false);
    this.pull.set(0);
  }

  // touchstart — запоминаем точку старта, но не решаем сразу что это PTR.
  // Решение принимается в touchmove: смотрим вертикаль ли это, стоит ли
  // страница на самом верху, и какая дельта.
  private onTouchStart(e: TouchEvent): void {
    if (this.refreshing()) return;
    const t = e.touches[0];
    if (!t) return;
    this.startY = t.clientY;
    this.startX = t.clientX;
    this.pending = true;
    this.active = false;
  }

  // touchmove — основной решающий слот: ленивая активация PTR.
  private onTouchMove(e: TouchEvent): void {
    if (!this.pending && !this.active) return;
    if (this.refreshing()) return;
    const t = e.touches[0];
    if (!t) return;
    const dy = t.clientY - this.startY;
    const dx = t.clientX - this.startX;
    // Горизонталь должна быть ОЩУТИМО больше вертикали (×1.5), чтобы лёгкая
    // дрожь пальца при вертикальном жесте не отрубала PTR.
    if (!this.active && Math.abs(dx) > Math.abs(dy) * 1.5 && Math.abs(dx) > 12) {
      this.pending = false;
      return;
    }
    if (!this.active) {
      // Пока ещё не активны: ждём явного вертикального движения вниз с верха.
      if (dy <= 0) return;
      if (window.scrollY > 0) return;
      this.active = true;
      this.activationY = t.clientY;
      // Замеряем позицию лого именно сейчас: страница упёрта в верх
      // (scrollY<=0), BackBar на своём естественном месте.
      this.measureAnchorCenter();
    }
    // В активном режиме pull считается от точки активации, не от touchstart.
    const pullDist = t.clientY - this.activationY;
    if (pullDist <= 0) {
      this.pull.set(0);
      return;
    }
    // Глушим браузерный pull-to-refresh / overscroll-bounce пока активны.
    // НЕ вызываем preventDefault до активации — иначе режим resilience
    // (резиновость) перехвачен раньше времени.
    if (e.cancelable) e.preventDefault();
    this.pull.set(Math.min(pullDist, MAX_PULL));
  }

  // touchend — если pull добрался до порога, запускаем refresh; иначе
  // сбрасываем индикатор и ждём следующего жеста.
  private onTouchEnd(): void {
    const wasActive = this.active;
    this.pending = false;
    this.active = false;
    if (this.refreshing()) return;
    if (wasActive && this.pull() >= TRIGGER_THRESHOLD) {
      this.refreshing.set(true);
      this.refresh.emit();
    } else {
      this.pull.set(0);
    }
  }

  // touchcancel — система отменила жест (например, перехватили pointer
  // capture для скролла): сворачиваем индикатор как при отпускании без
  // порога.
  private onTouchCancel(): void {
    this.pending = false;
    this.active = false;
    if (!this.refreshing()) this.pull.set(0);
  }
}
