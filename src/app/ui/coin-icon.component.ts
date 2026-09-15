import { Component, computed, effect, input, signal } from '@angular/core';

// coin-icon — резолвит иконку валюты по тому же правилу, что coincat/frontend:
// сначала пытаемся файл по id (специальные вроде USDT_COINCAT.png), на ошибке
// fallback на short_name (USDT, BTC, ...), потом скрываем.
@Component({
  selector: 'app-coin-icon',
  standalone: true,
  template: `@if (visible()) {
    <img [class]="cls()" [src]="src()" [alt]="id()" (error)="onError()" />
  }`,
  styles: [`
    :host { display: inline-flex; flex: 0 0 auto; width: 32px; height: 32px; }
    img { width: 100%; height: 100%; object-fit: contain; border-radius: 50%; background: var(--color-canvas); }
  `],
})
export class CoinIconComponent {
  readonly id = input<string>('');
  readonly shortName = input<string>('');
  readonly cls = input<string>('ico');

  private readonly stage = signal<'id' | 'short' | 'hide'>('id');

  constructor() {
    // при смене id/shortName начинаем подбор иконки заново.
    effect(() => { this.id(); this.shortName(); this.stage.set('id'); });
  }

  protected readonly visible = computed(() => this.stage() !== 'hide');
  protected readonly src = computed(() => {
    const s = this.stage();
    if (s === 'id') return `/assets/coins/${this.id()}.png`;
    if (s === 'short' && this.shortName()) return `/assets/coins/${this.shortName()}.png`;
    return '';
  });

  protected onError(): void {
    const s = this.stage();
    if (s === 'id' && this.shortName()) this.stage.set('short');
    else this.stage.set('hide');
  }
}
