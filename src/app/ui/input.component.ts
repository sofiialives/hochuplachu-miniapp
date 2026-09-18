import { Component, input, output } from '@angular/core';

@Component({
  selector: 'app-input',
  standalone: true,
  template: `<label class="wrap">
    @if (label()) { <span class="label">{{ label() }}</span> }
    <input
      [type]="type()"
      [name]="name() || null"
      [placeholder]="placeholder()"
      [disabled]="disabled()"
      [autocomplete]="autocomplete()"
      [attr.inputmode]="inputmode()"
      [attr.maxlength]="maxLength()"
      [attr.pattern]="pattern()"
      [class.has-error]="!!error()"
      [value]="value()"
      (input)="onInput($event)"
      (change)="onInput($event)"
      (keydown.enter)="enterPressed.emit()" />
    @if (error()) { <span class="err">{{ error() }}</span> }
  </label>`,
  styles: [`
    :host { display: block; }
    .wrap { display: flex; flex-direction: column; gap: 4px; }
    .label { font-size: 12px; color: rgba(0, 0, 0, 1); font-weight: 500; }
    input {
      height: 40px; padding: 0 14px;
      border-radius: var(--rounded-md);
      background: var(--color-surface);
      color: var(--color-ink);
      
      font-size: 16px;
      font-weight: 600;
      border: 1.5px solid rgba(211, 211, 211, 1);
      transition: border-color var(--dur-quick) ease, box-shadow var(--dur-quick) ease, background var(--dur-quick) ease;
      width: 100%;
    }
    input::placeholder { color: rgba(211, 211, 211, 1); }
    input:focus {
      outline: none;
      border-color: color-mix(in srgb, var(--color-primary) 80%, var(--color-ink));
      box-shadow: 0 0 0 3px color-mix(in srgb, var(--color-primary) 25%, transparent);
    }
    input.has-error { border-color: var(--color-error); }
    .err { font-size: 12px; color: var(--color-error); }
    @media (min-width: 1024px) {
      
      input { height: 44px; padding: 26px; font-size: 22px; }
    }
  `],
})
export class InputComponent {
  readonly value = input<string>('');
  readonly label = input('');
  readonly placeholder = input('');
  readonly type = input<'text' | 'email' | 'number' | 'password'>('text');
  readonly disabled = input(false);
  readonly autocomplete = input('off');
  readonly inputmode = input<'text' | 'email' | 'numeric' | 'decimal'>('text');
  readonly maxLength = input<number | null>(null);
  readonly name = input<string>('');
  readonly pattern = input<string | null>(null);
  readonly error = input('');
  readonly integerOnly = input(false);
  readonly prefix = input('');
  readonly valueChange = output<string>();
  readonly enterPressed = output<void>();

  onInput(e: Event): void {
    const el = e.target as HTMLInputElement;
    const raw = this.integerOnly() ? el.value.replace(/\s/g, '').match(/^\d*/)![0] : el.value;
    const v = this.withPrefix(raw);
    if (el.value !== v) el.value = v;
    this.valueChange.emit(v);
  }

  private withPrefix(v: string): string {
    const p = this.prefix();
    if (!p || v === '') return v;
    return p + v.split(p).join('');
  }
}