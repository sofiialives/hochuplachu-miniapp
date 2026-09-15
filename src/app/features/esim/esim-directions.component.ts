import { Component, computed, input, output, signal } from '@angular/core';
import { EsimDirection } from '../../core/api/esim.api';
import { formatAmount } from '../../core/currency/currency-symbols';

/**
 * Витрина «Все направления»: табы + поиск + карточки стран/регионов.
 *
 * Поиск на мобиле — фикс 320px, переключается на фикс 424px только на
 * @media (min-width:1024px).
 *
 * Карточка — ЧЕТЫРЕ внутренних состояния (сетка карточек при этом всего
 * два: 1 в ряд <375px, 2 в ряд от 375px, 4 в ряд от 1024px):
 *  - < 375px (1 в ряд): 2-колоночная сетка внутри — карточке хватает ширины.
 *  - 375–499px (2 в ряд, узко): карточке НЕ хватает на 2 колонки внутри —
 *    вертикальный список по центру.
 *  - 500–1023px (2 в ряд, уже достаточно широко): снова 2-колоночная сетка
 *    внутри — тут уже хватает места «по бокам».
 *  - >= 1024px (4 в ряд): 2-колоночная сетка, десктопные размеры.
 */
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
    /* ===================== БАЗА: 320–1023px ===================== */

    .bar { display: flex; flex-direction: column; align-items: stretch; gap: 10px; margin-bottom: 24px; }
    .tabs { display: flex; padding: 6px; background: white; border-radius: var(--rounded-pill); align-self: flex-start; }
    .tabs button {
      min-width: 110px; text-align: center; white-space: nowrap;
      background: transparent; color: rgba(0, 0, 0, 1); cursor: pointer;
      padding: 12px 16px; border-radius: var(--rounded-pill); font: inherit; font-size: 14px; font-weight: 500;
      transition: background var(--dur-quick) ease, color var(--dur-quick) ease;
    }
    .tabs button.tab--on { background: rgba(255, 186, 38, 1); color: rgba(0, 0, 0, 1); font-weight: 600; }

    .search { position: relative; width: 320px; max-width: 100%; align-self: flex-start; }
    .search-ico { position: absolute; left: 26px; top: 50%; transform: translateY(-50%); width: 24px; height: 24px; }
    .search input {
      width: 100%; padding: 16px 24px 16px 62px;
      border: 1px solid rgba(200, 200, 200, 1); border-radius: var(--rounded-pill);
      background: var(--color-surface); color: var(--color-ink); font-size: 16px;
    }
    .search input:focus { outline: none; border-color: var(--color-primary); }

    /* ===================== < 375px: список, 1 в ряд — 2 колонки внутри, места хватает ===================== */
    .grid { display: grid; grid-template-columns: 1fr; gap: 10px; }

    .card {
      display: grid;
      grid-template-columns: 72px 1fr;
      grid-template-rows: auto auto;
      column-gap: 12px; row-gap: 8px;
      align-items: start; justify-items: start;
      min-width: 0;
      padding: 16px; border-radius: 18px;
      background: rgba(255, 255, 255, 1);
      box-shadow: 0px 26.44px 62.98px -21.64px rgba(0, 0, 0, 0.15);
      cursor: pointer; font: inherit; text-align: left;
      border: 1px solid transparent; transition: border-color var(--dur-quick) ease;
    }
    .card:hover { border-color: rgba(255, 186, 38, 1); }
    .card:active { transform: scale(.98); }

    .ico { grid-column: 1; grid-row: 1; display: flex; align-items: center; height: 34px; }
    .flag { width: 48px; height: 36px; object-fit: cover; border-radius: 8px; box-shadow: 0 1px 4px rgba(0,0,0,.16); flex-shrink: 0; }
    .emoji { font-size: 30px; line-height: 1; }

    .name-block { grid-column: 1; grid-row: 2; min-width: 0; max-width: 100%; }
    .name { display: block; font-weight: 600; font-size: 14px; }
    .cnt { color: var(--color-muted); font-size: 11px; }

    .from {
      grid-column: 2; grid-row: 1; justify-self: end;
      font-family: 'Syncopate Cyr'; color: rgba(114, 86, 22, 1); font-size: 12px;
      background: rgba(244, 244, 244, 1);
      padding: 10px 14px; border-radius: var(--rounded-pill);
    }
    .badge {
      grid-column: 2; grid-row: 2; justify-self: end;
      font-family: 'Syncopate Cyr';
      background: rgba(255, 186, 38, 1); color: rgba(0, 0, 0, 1);
      padding: 7px 11px; font-size: 8px; text-transform: uppercase;
      border-radius: var(--rounded-pill);
    }

    .empty { text-align: center; color: var(--color-muted); padding: 32px 0; }

    /* ===================== 375–499px: 2 в ряд, узко — список по центру ===================== */
    @media (min-width: 375px) {
      .grid { grid-template-columns: repeat(2, 1fr); gap: 12px; }

      .card {
        display: flex; flex-direction: column; align-items: center; text-align: center;
        gap: 8px; padding: 14px;
      }
      .ico { justify-content: center; height: 28px; }
      .flag { width: 40px; height: 30px; }
      .name-block { max-width: 100%; }
      .name { font-size: 13px; }
      .cnt { font-size: 11px; }
      .from { font-size: 10px; padding: 7px 10px; }
      .badge { font-size: 7px; padding: 5px 9px; }
    }

    /* ===================== 500–1023px: 2 в ряд, уже хватает места — снова «по бокам» ===================== */
    @media (min-width: 500px) {
      .card {
        display: grid;
        grid-template-columns: 56px 1fr;
        grid-template-rows: auto auto;
        column-gap: 10px; row-gap: 6px;
        align-items: start; justify-items: start;
        text-align: left;
        padding: 14px;
      }
      .ico { grid-column: 1; grid-row: 1; justify-content: flex-start; height: 28px; }
      .flag { width: 40px; height: 30px; }
      .name-block { grid-column: 1; grid-row: 2; }
      .name { font-size: clamp(12px, 0.574vw + 9.13px, 15px); }
      .cnt { font-size: clamp(10px, 0.382vw + 8.09px, 12px); }
      .from { grid-column: 2; grid-row: 1; justify-self: end; font-size: clamp(9px, 0.574vw + 6.13px, 12px); padding: 7px 10px; }
      .badge { grid-column: 2; grid-row: 2; justify-self: end; font-size: clamp(7px, 0.382vw + 5.09px, 9px); padding: 5px 9px; }
    }

    /* ===================== >= 1024px: десктоп, 4 в ряд ===================== */
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