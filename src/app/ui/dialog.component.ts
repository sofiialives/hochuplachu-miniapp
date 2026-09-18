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
      max-height: 90vh; overflow-y: auto; overflow-x: hidden;
      
      padding: var(--space-lg) 16px calc(var(--space-lg) + env(safe-area-inset-bottom, 0px));
      box-shadow: 0 -8px 32px rgba(0,0,0,.18);
      animation: dlg-up .34s var(--ease-spring) both;
    }
    .body { overflow-wrap: break-word; word-break: break-word; }
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
    h3 { font-family:"Syncopate Cyr"; text-transform: uppercase; font-size: 22px; min-width: 0;}
    .close {
      position: absolute; top: var(--space-lg); right: 16px;
      width: 36px; height: 36px; border-radius: var(--rounded-pill);
      background: var(--color-surface-card);
      font-size: 24px; line-height: 1; color: rgba(137, 137, 137, 1);
    }
    @media (max-width: 450px) {
      .head { padding-right: 56px; }
      h3 { font-size: 19px; }
    }
    @media (min-width: 1024px) {
      h3 { font-size: 32px; }
      .head { align-items: center }
      .close { width: 61px; height: 61px }
      .body { font-size: 15px; }
    }
  `],
})
export class DialogComponent {
  readonly title = input('');
  readonly closable = input(true);
  
  readonly wide = input(false);
  readonly dismissed = output<void>();

  
  private pressedOnBackdrop = false;

  onPointerDown(e: PointerEvent): void {
    this.pressedOnBackdrop = e.target === e.currentTarget;
  }

  
  onPointerUp(e: PointerEvent): void {
    const pressed = this.pressedOnBackdrop;
    this.pressedOnBackdrop = false;
    if (pressed && e.target === e.currentTarget && this.closable()) this.dismissed.emit();
  }
}