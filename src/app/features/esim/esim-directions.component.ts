import { Component, computed, input, output, signal } from '@angular/core';
import { EsimDirection } from '../../core/api/esim.api';
import { formatAmount } from '../../core/currency/currency-symbols';

@Component({
  selector: 'app-esim-directions',
  standalone: true,
  template: `
    <section class="wrap">
      <div class="bar">
        <div class="tabs" role="tablist">
          <button type="button" role="tab" [attr.aria-selected]="tab() === 'countries'"
            [class.tab--on]="tab() === 'countries'" (click)="tab.set('countries')">По странам</button>
          <button type="button" role="tab" [attr.aria-selected]="tab() === 'regions'"
            [class.tab--on]="tab() === 'regions'" (click)="tab.set('regions')">Регионы</button>
        </div>
        @if (tab() === 'countries') {
          <label class="search">
            <img class="search-ico" src="/assets/coins/find.svg" alt="search" loading="lazy" />
            <input type="search" [value]="query()" placeholder="Поиск страны…"
              (input)="query.set($any($event.target).value)" />
          </label>
        }
      </div>

      <div class="grid">
        @for (d of visible(); track d.code) {
          <button type="button" class="card" (click)="picked.emit(d)">
            <span class="ico">
              @if (d.flag) {
                <img class="flag" [src]="'/assets/flags/' + d.flag + '.svg'" [alt]="d.name" loading="lazy" />
              } @else {
                <span class="emoji">{{ d.emoji || '🌍' }}</span>
              }
            </span>
            <span class="name-block">
              <span class="name">{{ d.name }}</span>
              @if (d.countries) { <span class="cnt">{{ d.countries }} стран</span> }
            </span>
            <span class="from">от {{ money(d.min_price, d.currency) }}</span>
            @if (d.popular) { <span class="badge">Популярно</span> }
          </button>
        } @empty {
          <p class="empty">
            @if (query()) { Ничего не нашлось — попробуйте другое название. }
            @else { Направления пока не настроены. }
          </p>
        }
      </div>
    </section>
  `,
  styles: [`
    

    .bar { display: flex; flex-direction: column; align-items: stretch; gap: 10px; margin-bottom: 24px; }
    .tabs { display: flex; padding: 6px; background: white; border-radius: var(--rounded-pill); align-self: flex-start; }
    .tabs button {
      min-width: 110px; text-align: center; white-space: nowrap;
      background: transparent; color: var(--color-black); cursor: pointer;
      padding: 12px 16px; border-radius: var(--rounded-pill); font: inherit; font-size: 14px; font-weight: 500;
      transition: background var(--dur-quick) ease, color var(--dur-quick) ease;
    }
    .tabs button.tab--on { background: var(--color-brand-gold); color: var(--color-black); font-weight: 600; }

    .search { position: relative; width: 320px; max-width: 100%; align-self: flex-start; }
    .search-ico { position: absolute; left: 26px; top: 50%; transform: translateY(-50%); width: 24px; height: 24px; }
    .search input {
      width: 100%; padding: 16px 24px 16px 62px;
      border: 1px solid var(--color-grey-200); border-radius: var(--rounded-pill);
      background: var(--color-surface); color: var(--color-ink); font-size: 16px;
    }
    .search input:focus { outline: none; border-color: var(--color-primary); }

    
    .grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 10px; }

    .card {
      display: grid;
      grid-template-columns: clamp(40px, 8vw + 20px, 60px) 1fr;
      grid-template-rows: auto auto;
      column-gap: 8px; row-gap: 4px;
      align-items: start; justify-items: start;
      min-width: 0;
      padding: 12px; border-radius: 14px;
      background: var(--color-white);
      box-shadow: 0px 26.44px 62.98px -21.64px var(--overlay-black-15);
      cursor: pointer; font: inherit; text-align: left;
      border: 1px solid transparent; transition: border-color var(--dur-quick) ease;
    }
    .card:hover { border-color: var(--color-brand-gold); }
    .card:active { transform: scale(.98); }

    .ico { grid-column: 1; grid-row: 1; display: flex; align-items: center; height: clamp(20px, 4vw + 10px, 28px); }
    .flag { width: clamp(28px, 6vw + 12px, 40px); height: clamp(21px, 4.5vw + 9px, 30px); object-fit: cover; border-radius: 6px; box-shadow: 0 1px 4px var(--overlay-black-16); flex-shrink: 0; }
    .emoji { font-size: clamp(18px, 4vw + 8px, 26px); line-height: 1; }

    .name-block { grid-column: 1; grid-row: 2; min-width: 0; max-width: 100%; }
    .name { display: block; font-weight: 600; font-size: clamp(11px, 1vw + 8px, 13px); }
    .cnt { color: var(--color-muted); font-size: clamp(9px, 0.6vw + 7.5px, 11px); font-family: 'Gilroy', sans-serif; }

    .from {
      grid-column: 2; grid-row: 1; justify-self: end;
      font-family: 'Syncopate Cyr'; color: var(--color-badge-brown); font-size: clamp(9px, 0.8vw + 7px, 11px);
      background: var(--color-grey-100);
      padding: 6px 9px; border-radius: var(--rounded-pill);
    }
    .badge {
      grid-column: 2; grid-row: 2; justify-self: end;
      font-family: 'Syncopate Cyr';
      background: var(--color-brand-gold); color: var(--color-black);
      padding: 5px 8px; font-size: clamp(6px, 0.4vw + 5px, 7px); text-transform: uppercase;
      border-radius: var(--rounded-pill);
    }

    .empty { text-align: center; color: var(--color-muted); padding: 32px 0; }

    
    @media (min-width: 1024px) {
      .bar { flex-direction: row; align-items: center; justify-content: flex-start; gap: 20px; margin-bottom: 40px; }
      .tabs { align-self: auto; }
      .search { width: 424px; max-width: 424px; flex: 0 0 424px; }

      .grid { grid-template-columns: repeat(4, 1fr); gap: 20px; }

      .card { grid-template-columns: 60px 1fr; column-gap: 10px; row-gap: 8px; padding: 16px; }
      .ico { height: 30px; }
      .flag { width: 44px; height: 33px; }
      .name { font-size: 14px; }
      .cnt { font-size: 11px; }
      .from { font-size: 11px; padding: 8px 11px; }
      .badge { font-size: 7px; padding: 5px 9px; }
    }
  `],
})
export class EsimDirectionsComponent {
  readonly countries = input<EsimDirection[]>([]);
  readonly regions = input<EsimDirection[]>([]);
  readonly picked = output<EsimDirection>();

  protected readonly tab = signal<'countries' | 'regions'>('countries');
  protected readonly query = signal('');

  protected readonly visible = computed<EsimDirection[]>(() => {
    if (this.tab() === 'regions') return this.regions();
    const q = this.query().trim().toLowerCase();
    if (!q) return this.countries();
    return this.countries().filter((d) =>
      d.name.toLowerCase().includes(q) || d.code.toLowerCase().startsWith(q));
  });

  protected money(v: number, c: string): string { return formatAmount(v, c); }
}