import { Component, input, output } from '@angular/core';

// app-toggle — тумблер вкл/выкл в стиле дизайн-системы (трек в coral при
// включении). Управляемый компонент: состояние приходит через checked,
// клик эмитит toggled с желаемым значением — родитель сам решает, когда
// применить (например, после успешного PATCH).
@Component({
  selector: 'app-toggle',
  standalone: true,
  template: `<button
    type="button"
    class="wrap"
    role="switch"
    [attr.aria-checked]="checked()"
    [disabled]="disabled()"
    (click)="toggled.emit(!checked())">
    <span class="track" [class.on]="checked()"><span class="knob"></span></span>
    @if (label()) { <span class="text">{{ label() }}</span> }
  </button>`,
  styles: [`
    :host { display: inline-flex; }
    .wrap {
      display: inline-flex; align-items: center; gap: 8px;
      background: none; border: none; padding: 0; cursor: pointer;
      font: inherit; color: var(--color-ink);
    }
    .wrap:disabled { opacity: .5; cursor: default; }
    .track {
      width: 40px; height: 24px; border-radius: 999px; flex: 0 0 auto;
      background: var(--color-hairline); position: relative;
      transition: background .15s;
    }
    .track.on { background: var(--color-primary); }
    .knob {
      position: absolute; top: 3px; left: 3px; width: 18px; height: 18px;
      border-radius: 50%; background: #fff; transition: left .15s;
      box-shadow: 0 1px 3px rgba(0, 0, 0, .2);
    }
    .track.on .knob { left: 19px; }
    .text { font-size: 14px; }
  `],
})
export class ToggleComponent {
  readonly checked = input(false);
  readonly disabled = input(false);
  readonly label = input('');
  readonly toggled = output<boolean>();
}
