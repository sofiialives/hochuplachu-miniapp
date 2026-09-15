import { Component, HostListener, computed, input, signal } from '@angular/core';

// HintComponent — «?» рядом с подписью поля: подсказка раскрывается по
// наведению (десктоп) и по нажатию (тач, где hover недоступен). Нативный
// title не годится — на тач-устройствах он не показывается вовсе.
@Component({
  selector: 'app-hint',
  standalone: true,
  template: `<span class="hint">
    <button
      type="button"
      class="hint__btn"
      aria-label="Подсказка"
      [attr.aria-expanded]="open()"
      (click)="toggle($event)"
      (mouseenter)="hovered.set(true)"
      (mouseleave)="hovered.set(false)"
      (focus)="hovered.set(true)"
      (blur)="hovered.set(false)">?</button>
    @if (open()) {
      <span class="hint__pop" role="tooltip">{{ text() }}</span>
    }
  </span>`,
  styles: [`
    .hint { position: relative; display: inline-flex; vertical-align: middle; margin-left: 4px; }
    .hint__btn {
      width: 16px; height: 16px; padding: 0;
      border: none; border-radius: 50%;
      background: color-mix(in srgb, var(--color-muted) 22%, transparent);
      color: var(--color-muted);
      font-size: 11px; font-weight: 700; line-height: 16px;
      cursor: pointer;
      transition: background var(--dur-quick) ease, color var(--dur-quick) ease;
    }
    .hint__btn:hover { background: var(--color-primary-soft); color: var(--color-primary-ink); }
    .hint__pop {
      position: absolute; bottom: calc(100% + 8px); left: 50%;
      transform: translateX(-50%);
      width: max-content; max-width: min(260px, 70vw);
      padding: 8px 10px;
      background: var(--color-ink); color: var(--color-surface);
      border-radius: var(--rounded-md);
      font-size: 12px; font-weight: 400; line-height: 1.4; text-align: left;
      white-space: normal;
      box-shadow: 0 6px 20px rgba(0,0,0,.18);
      z-index: 20;
      animation: hint-in var(--dur-quick) var(--ease-out) both;
    }
    /* Хвостик вниз, к самой кнопке. */
    .hint__pop::after {
      content: ""; position: absolute; top: 100%; left: 50%;
      transform: translateX(-50%);
      border: 5px solid transparent;
      border-top-color: var(--color-ink);
    }
    @keyframes hint-in { from { opacity: 0; transform: translateX(-50%) translateY(3px); } }
  `],
})
export class HintComponent {
  readonly text = input('');

  protected readonly hovered = signal(false);
  /** Подсказка «приколота» нажатием — живёт до клика вне или Esc. */
  protected readonly pinned = signal(false);
  protected readonly open = computed(() => this.hovered() || this.pinned());

  protected toggle(e: Event): void {
    // Без этого клик тут же дошёл бы до document-слушателя и снял pin.
    e.stopPropagation();
    this.pinned.update((v) => !v);
  }

  @HostListener('document:click')
  protected closeOnOutside(): void { this.pinned.set(false); }

  @HostListener('document:keydown.escape')
  protected closeOnEsc(): void { this.pinned.set(false); }
}
