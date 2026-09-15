import { Component, input, output } from '@angular/core';

@Component({
  selector: 'app-dialog',
  standalone: true,
  template: `<div class="backdrop" (pointerdown)="onPointerDown($event)" (pointerup)="onPointerUp($event)">
    <div class="sheet" [class.sheet--wide]="wide()">
      <header class="head">
        <h3>{{ title() }}</h3>
        @if (closable()) {
          <button class="close" (click)="dismissed.emit()" aria-label="Закрыть">×</button>
        }
      </header>
      <div class="body"><ng-content /></div>
    </div>
  </div>`,
  styles: [`
    .backdrop {
      position: fixed; inset: 0; background: rgba(33,37,41,.45);
      display: flex; align-items: flex-end; justify-content: center;
      z-index: 1000;
      animation: dlg-fade var(--dur-quick) ease both;
    }
    .sheet {
      position: relative;
      width: 100%; max-width: 540px;
      background: var(--color-surface);
      border-top-left-radius: var(--rounded-xl);
      border-top-right-radius: var(--rounded-xl);
      max-height: 90vh; overflow: auto;
      /* Боковые паддинги — тот же паттерн, что на остальных страницах:
         52px мобилка, 120px десктоп (медиа-запрос ниже). position:relative
         нужен как якорь для абсолютно позиционированного .close. */
      padding: var(--space-lg) 52px calc(var(--space-lg) + env(safe-area-inset-bottom, 0px));
      box-shadow: 0 -8px 32px rgba(0,0,0,.18);
      animation: dlg-up .34s var(--ease-spring) both;
    }
    .sheet--wide { max-width: 820px; }
    @keyframes dlg-fade { from { opacity: 0; } }
    @keyframes dlg-up { from { transform: translateY(48px); opacity: .4; } }
    @keyframes dlg-pop { from { transform: translateY(14px) scale(.97); opacity: 0; } }
    @media(min-width: 640px) {
      .backdrop { align-items: center; }
      .sheet {
        border-radius: var(--rounded-xl);
        animation: dlg-pop .28s var(--ease-spring) both;
      }
    }
    .head { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; margin-bottom: var(--space-md); }
    h3 { font-family:"Syncopate Cyr"; text-transform: uppercase; font-size: 32px; min-width: 0;}
    .close {
      position: absolute; top: 32px; right: 32px;
      width: 36px; height: 36px; border-radius: var(--rounded-pill);
      background: var(--color-surface-card); color: var(--color-ink);
      font-size: 24px; line-height: 1;
    }
    @media (max-width: 450px) {
      .head { padding-right: 56px; }
      h3 { font-size: 22px; }
    }
    @media (min-width: 1024px) {
      .sheet { padding-left: 120px; padding-right: 120px; }
      h3 { font-size: 44px; }
      .head { display: grid; grid-template-columns: 36px 1fr 36px; align-items: center; gap: 12px; }
      h3 { grid-column: 2; text-align: center; }
      /* position:static — у .close была ЖЁСТКАЯ position:absolute с
         top:32px/right:32px из базовых стилей (нужна на мобиле, где
         .head — обычный flex без своей сетки), которая здесь НЕ
         переопределялась. absolute полностью выключает элемент из
         grid-раскладки — он продолжал висеть по старым координатам,
         а не там, где его пытался поставить grid-column:3, из-за чего
         съезжался с центрированным длинным заголовком. */
      .close { grid-column: 3; position: static; }
    }
  `],
})
export class DialogComponent {
  readonly title = input('');
  readonly closable = input(true);
  /** Расширенный лист — для содержимого с таблицами. */
  readonly wide = input(false);
  readonly dismissed = output<void>();

  /** Нажатие началось на самой подложке, а не внутри диалога. */
  private pressedOnBackdrop = false;

  onPointerDown(e: PointerEvent): void {
    this.pressedOnBackdrop = e.target === e.currentTarget;
  }

  /* Закрываем по pointerup, а не по click: click всплывает с ОБЩЕГО предка
     точек нажатия и отпускания, поэтому выделение текста, начатое в форме и
     законченное за её пределами, приходило на .backdrop и закрывало диалог. */
  onPointerUp(e: PointerEvent): void {
    const pressed = this.pressedOnBackdrop;
    this.pressedOnBackdrop = false;
    if (pressed && e.target === e.currentTarget && this.closable()) this.dismissed.emit();
  }
}