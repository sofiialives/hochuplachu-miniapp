import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { EsimApi, EsimProduct, formatDataMb } from '../../core/api/esim.api';
import { BackBarComponent } from '../../ui/back-bar.component';
import { ToastService } from '../../core/notifications/toast.service';
import { errorMessage } from '../../core/errors/api-error';
import { formatAmount } from '../../core/currency/currency-symbols';

const DATA_PRESETS: { key: string; title: string; note: string; icon: string; min: number; max: number }[] = [
  { key: 'unlim', title: 'Безлимит', note: '∞ ГБ', icon: '/assets/coins/limit.svg', min: 0, max: 0 },
  { key: 'chat', title: 'Чаты и карты', note: 'до 3 ГБ', icon: '/assets/coins/chat.svg', min: 1, max: 3072 },
  { key: 'social', title: 'Соцсети и фото', note: '3–15 ГБ', icon: '/assets/coins/picture.svg', min: 3073, max: 15360 },
  { key: 'media', title: 'Музыка и кино', note: '15–50 ГБ', icon: '/assets/coins/music.svg', min: 15361, max: 51200 },
];

const DEFAULT_OPEN_DAYS = 7;

interface DayGroup {
  days: number;
  title: string;
  total: number;
  volumes: { label: string; items: EsimProduct[] }[];
}

@Component({
  selector: 'app-esim-direction',
  standalone: true,
  imports: [BackBarComponent],
  template: `
    <app-back-bar title="Тарифы" />

    <div class="wrap">
      @if (loading()) {
        <p class="dim">Загружаем тарифы…</p>
      } @else if (!items().length) {
        <p class="dim">Для этого направления пока нет тарифов.</p>
      } @else {
        <div class="head-row">
          <header class="head">
            @if (flag(); as f) {
              <img class="flag" [src]="'/assets/flags/' + f + '.svg'" [alt]="title()" />
            } @else {
              <span class="emoji">{{ emoji() }}</span>
            }
            <div class="head-body">
              <h1>{{ title() }}</h1>
              <p class="meta">
                <b>От {{ money(minPrice(), currency()) }}</b> / {{ items().length }} {{ plural(items().length) }}
                @if (countries() > 1) { / {{ countries() }} {{ countryWord(countries()) }} }
              </p>
            </div>
          </header>
          <p class="lead">Выберите пакет и оплатите по СБП. QR-код придёт на email сразу после оплаты.</p>
        </div>

        <div class="filters">
          <div class="chips" role="group" aria-label="Срок">
            @for (d of daysList(); track d) {
              <button type="button" class="chip" [class.chip--on]="fDays() === d" (click)="pickDays(d)">
                {{ d }} {{ dayWord(d) }}
              </button>
            }
          </div>
          <div class="chips" role="group" aria-label="Трафик">
            @for (t of dataPresets; track t.key) {
              @if (trafficAvailable().has(t.key)) {
                <button type="button" class="chip" [class.chip--on]="fTraffic() === t.key" (click)="pickTraffic(t.key)">
                  <img class="chip-ico" aria-hidden="true" [src]="t.icon" [alt]="t.title" />{{ t.title }}
                </button>
              }
            }
          </div>
          @if (hasFilter()) {
            <button type="button" class="link" (click)="resetFilters()">Сбросить фильтры</button>
          }
        </div>

        @if (!groups().length) {
          <p class="dim">Под выбранные фильтры тарифов нет.
            <button type="button" class="link" (click)="resetFilters()">Сбросить</button>
          </p>
        }

        <div class="grp-list">
          @for (g of groups(); track g.days) {
            <section class="grp">
              <button type="button" class="grp-head" (click)="toggle(g.days)">
                <span class="grp-title">{{ g.title }}</span>
                <span class="grp-count">{{ g.total }} {{ plural(g.total) }}</span>
                <span class="grp-chev" [class.grp-chev--open]="isOpen(g.days)" aria-hidden="true">⌃</span>
              </button>
              @if (isOpen(g.days)) {
                <div class="grp-body">
                  @for (v of g.volumes; track v.label) {
                    <div class="vol">
                      <div class="vol-head">
                        <span class="vol-label">{{ v.label }}</span>
                        <span class="vol-count">{{ v.items.length }} {{ plural(v.items.length) }}</span>
                      </div>
                      @for (p of v.items; track p.id) {
                        <button type="button" class="row" (click)="open(p)">
                          <span class="row-main">
                            <span class="row-name">{{ volumeLabel(p) }} / <span class="row-days">{{ p.days }} дн.</span></span>
                            <span class="row-sub">{{ trafficNote(p) }}</span>
                          </span>
                          <span class="row-price">
                            <b>{{ money(p.issue_price, p.issue_currency) }}</b>
                            <span class="per">{{ perDay(p) }}</span>
                          </span>
                          <span class="chev" aria-hidden="true">›</span>
                        </button>
                      }
                    </div>
                  }
                </div>
              }
            </section>
          }
        </div>
      }
    </div>
  `,
  styles: [`
    .wrap {
      padding: 0 16px; padding-bottom: 110px;
      max-width: 1200px; margin: 0 auto;
    }
    h1 { margin: 0 0 2px; }
    p { margin: 0; }
    .dim { color: var(--color-muted); padding: var(--space-lg) 0; }

    .head { display: flex; gap: var(--space-md); align-items: center; margin-bottom: var(--space-sm); }
    .flag { width: 100px; border-radius: 10px; box-shadow: 0 2px 8px rgba(0, 0, 0, .16); }
    .emoji { font-size: 28px; line-height: 1; }
    .head-body { min-width: 0; }
    .meta { font-size: 14px; color: rgba(0, 0, 0, 1); }
    .meta b {font-family: 'Gilroy'; color: var(--color-primary-ink); font-weight: 400; }
    .lead { font-size: 14px; color: rgba(0, 0, 0, 1); margin-bottom: 20px; }

    .filters { display: flex; flex-direction: column; gap: 8px; margin-bottom: var(--space-md); }
    .chips { display: flex; gap: 6px; overflow-x: auto; padding-bottom: 2px; scrollbar-width: none; }
    .chips::-webkit-scrollbar { display: none; }
    .chip {
      display: flex; align-items: center; gap: 12px;
      padding: 12px 18px; border-radius: 16px; white-space: nowrap;
      background: var(--color-surface); color: rgba(0, 0, 0, 1);
      cursor: pointer; font: inherit; font-size: 13px; font-weight: 500;
      transition: background var(--dur-quick) ease, border-color var(--dur-quick) ease, color var(--dur-quick) ease;
    }
    .chip:hover { border-color: var(--color-primary); }
    .chip--on { background: var(--color-primary); border-color: var(--color-primary); color: var(--color-on-primary); font-weight: 600; }
    .chip-ico { width: 26px; transition: filter var(--dur-quick) ease; }
    .chip--on .chip-ico { filter: brightness(0); }

    .row {
      width: 100%; display: flex; flex-direction: column; align-items: flex-start; gap: 6px;
      position: relative; text-align: left;
      padding: 14px 40px 14px 16px; margin-bottom: 8px; cursor: pointer; font: inherit;
      border: 1px solid var(--color-hairline); border-radius: var(--rounded-lg); background: var(--color-surface);
      transition: border-color var(--dur-quick) ease, transform var(--dur-quick) ease;
    }
    .row:hover { border-color: var(--color-primary); }
    .row:active { transform: scale(.995); }
    .row-main { width: 100%; min-width: 0; display: flex; flex-direction: column; gap: 2px; }
    .row-name { font-weight: 600; font-size: 15px; }
    .row-days { font-weight: 400; font-size: 13px; }
    .row-sub { font-size: 13px; color: rgba(0, 0, 0, 1); }
    .row-price { display: flex; flex-direction: row; align-items: baseline; gap: 8px; }
    .row-price b { font-family: 'Gilroy'; font-weight: 500; font-size: 17px; color: var(--color-primary-ink); }
    .per { font-family: 'Gilroy'; font-weight: 400; font-size: 12px; color: rgba(0, 0, 0, 1); }
    .chev { position: absolute; top: 16px; right: 14px; color: var(--color-muted); font-size: 22px; }

    .grp { margin-bottom: 16px; box-shadow: 0px 26.44px 62.98px -21.64px rgba(0, 0, 0, 0.15); border-radius: var(--rounded-lg); overflow: hidden; }
    .grp-head {
      width: 100%; box-shadow: 0px 26.44px 62.98px -21.64px rgba(0, 0, 0, 0.15); display: flex; align-items: center; gap: 20px; padding: 24px;
      background: white; cursor: pointer; text-align: left;
    }
    .grp-title { font-weight: 600; font-size: 16px; }
    .grp-count { color: rgba(0, 0, 0, 1); font-size: 14px; flex: 1; }
    .grp-chev { transition: transform var(--dur-quick) ease; color: var(--color-muted); font-size: 24px; }
    .grp-chev--open { transform: rotate(180deg); }
    .grp-body { padding: 40px; background: rgba(255, 255, 255, 0.36); backdrop-filter: blur(11.3px); }
    .vol { margin-bottom: 10px; }
    .vol-head { display: flex; justify-content: space-between; align-items: baseline; margin: 0 4px 6px; }
    .vol-label { font-size: 14px; color: rgba(0, 0, 0, 1); }
    .vol-count { font-size: 14px; color: rgba(0, 0, 0, 1); }
    .link {
      align-self: flex-start; background: none; border: 0; padding: 0;
      color: var(--color-primary-ink); cursor: pointer; font: inherit; font-size: 13px;
    }

    @media (min-width: 470px) {
      .row { flex-direction: row; align-items: center; gap: 12px; padding: 14px 16px; }
      .row-main { flex: 1; }
      .row-name { font-size: 20px; }
      .row-days { font-size: 16px; }
      .row-sub { font-size: 16px; }
      .row-price { flex-direction: column; align-items: flex-end; gap: 2px; }
      .row-price b { font-size: 20px; }
      .per { font-size: 14px; }
      .chev { position: static; font-size: 36px; }
    }

    @media (min-width: 1024px) {
      .wrap { padding-left: 120px; padding-right: 120px; }
      .chip { font-size: 17px; }
      .grp-title { font-size: 19px; }

      .head-row {
        display: flex; flex-direction: row; align-items: flex-start;
        justify-content: space-between; gap: 40px;
        margin-bottom: 32px;
      }
      .head { flex: 0 0 auto; margin-bottom: 0; }
      .lead { flex: 1 1 420px; max-width: 460px; margin-bottom: 0; align-self: center; }

      .flag { width: 120px; }
      h1 { font-size: 32px; }
      .meta { font-size: 20px; }
      .lead { font-size: 20px; }

      .grp-list { display: grid; grid-template-columns: repeat(2, 1fr); gap: 20px; align-items: start; }
      .grp { margin-bottom: 0; }
    }
  `],
})
export class EsimDirectionPage implements OnInit {
  private readonly api = inject(EsimApi);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly toast = inject(ToastService);

  protected readonly dataPresets = DATA_PRESETS;

  protected readonly loading = signal(true);
  protected readonly items = signal<EsimProduct[]>([]);
  private readonly code = signal('');
  private readonly kind = signal<'country' | 'region'>('country');

  protected readonly fDays = signal<number | null>(null);
  protected readonly fTraffic = signal<string | null>(null);
  private readonly openedDays = signal<Set<number>>(new Set());

  ngOnInit(): void {
    const code = (this.route.snapshot.paramMap.get('code') ?? '').trim();
    this.code.set(code.toUpperCase().length === 2 ? code.toUpperCase() : code.toLowerCase());
    this.kind.set(code.length === 2 ? 'country' : 'region');
    this.load();
  }

  private load(): void {
    this.loading.set(true);
    this.api.products(this.code()).subscribe({
      next: (r) => {
        const mine = r.products ?? [];
        mine.sort((a, b) => a.issue_price - b.issue_price);
        this.items.set(mine);
        this.loading.set(false);
        this.openDefaultGroup();
      },
      error: (e: unknown) => {
        this.loading.set(false);
        this.toast.error(errorMessage(e, 'Не удалось загрузить тарифы'));
      },
    });
  }

  protected readonly title = computed(() => {
    const p = this.items()[0];
    if (!p) return 'Направление';
    return this.kind() === 'country' ? (p.country_name || p.country_code) : (p.region_name || p.region_code || '');
  });
  protected readonly flag = computed(() => (this.kind() === 'country' ? this.code().toLowerCase() : ''));
  protected readonly emoji = computed(() => (this.code() === 'europe' ? '🇪🇺' : '🌍'));
  protected readonly minPrice = computed(() =>
    this.items().reduce((min, p) => (min === 0 || p.issue_price < min ? p.issue_price : min), 0));
  protected readonly currency = computed(() => this.items()[0]?.issue_currency ?? 'RUB');
  protected readonly countries = computed(() => {
    return this.items().reduce((max, p) => Math.max(max, p.locations?.length ?? 0), 0);
  });

  protected readonly daysList = computed(() =>
    [...new Set(this.items().map((p) => p.days))].filter((d) => d > 0).sort((a, b) => a - b));
  protected readonly trafficAvailable = computed(() => {
    const keys = new Set<string>();
    for (const p of this.items()) keys.add(this.trafficKey(p));
    return keys;
  });
  protected readonly hasFilter = computed(() => this.fDays() !== null || this.fTraffic() !== null);

  private readonly filtered = computed<EsimProduct[]>(() =>
    this.items().filter((p) => {
      if (this.fDays() !== null && p.days !== this.fDays()) return false;
      if (this.fTraffic() !== null && this.trafficKey(p) !== this.fTraffic()) return false;
      return true;
    }));

  protected readonly groups = computed<DayGroup[]>(() => {
    const byDays = new Map<number, EsimProduct[]>();
    for (const p of this.filtered()) {
      const list = byDays.get(p.days) ?? [];
      list.push(p);
      byDays.set(p.days, list);
    }
    return [...byDays.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([days, list]) => {
        const byVolume = new Map<string, EsimProduct[]>();
        for (const p of list) {
          const label = p.data_mb === 0 ? 'БЕЗЛИМИТ' : formatDataMb(p.data_mb);
          const arr = byVolume.get(label) ?? [];
          arr.push(p);
          byVolume.set(label, arr);
        }
        const volumes = [...byVolume.entries()]
          .map(([label, arr]) => ({ label, items: arr.sort((a, b) => a.issue_price - b.issue_price) }))
          .sort((a, b) => {
            if (a.label === 'БЕЗЛИМИТ') return -1;
            if (b.label === 'БЕЗЛИМИТ') return 1;
            return (a.items[0]?.data_mb ?? 0) - (b.items[0]?.data_mb ?? 0);
          });
        return { days, title: this.daysTitle(days), total: list.length, volumes };
      });
  });

  private daysTitle(days: number): string {
    return `${days} ${this.dayWord(days)}`;
  }

  protected dayWord(n: number): string {
    const mod10 = n % 10;
    const mod100 = n % 100;
    if (mod10 === 1 && mod100 !== 11) return 'день';
    if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return 'дня';
    return 'дней';
  }

  protected countryWord(n: number): string {
    const mod10 = n % 10;
    const mod100 = n % 100;
    if (mod10 === 1 && mod100 !== 11) return 'страна';
    if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return 'страны';
    return 'стран';
  }

  protected plural(n: number): string {
    const mod10 = n % 10;
    const mod100 = n % 100;
    if (mod10 === 1 && mod100 !== 11) return 'тариф';
    if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return 'тарифа';
    return 'тарифов';
  }

  private trafficKey(p: EsimProduct): string {
    if (p.data_mb === 0) return 'unlim';
    const preset = DATA_PRESETS.find((t) => t.min > 0 && p.data_mb >= t.min && p.data_mb <= t.max);
    return preset?.key ?? 'media';
  }

  protected trafficNote(p: EsimProduct): string {
    return p.data_mb === 0 ? 'Безлимит' : 'Полный интернет';
  }

  protected volumeLabel(p: EsimProduct): string {
    return p.data_mb === 0 ? 'Безлимит' : formatDataMb(p.data_mb);
  }

  protected perDay(p: EsimProduct): string {
    if (p.days <= 0) return '';
    return `${formatAmount(Math.round(p.issue_price / p.days), p.issue_currency)} / день`;
  }

  protected pickDays(days: number): void {
    this.fDays.set(this.fDays() === days ? null : days);
    this.expandAllVisible();
  }

  protected pickTraffic(key: string): void {
    this.fTraffic.set(this.fTraffic() === key ? null : key);
    this.expandAllVisible();
  }

  protected resetFilters(): void {
    this.fDays.set(null);
    this.fTraffic.set(null);
    this.openDefaultGroup();
  }

  private openDefaultGroup(): void {
    const gs = this.groups();
    const start = gs.find((g) => g.days === DEFAULT_OPEN_DAYS) ?? gs[0];
    this.openedDays.set(new Set(start ? [start.days] : []));
  }

  private expandAllVisible(): void {
    this.openedDays.set(new Set(this.groups().map((g) => g.days)));
  }

  protected toggle(days: number): void {
    this.openedDays.update((set) => {
      const next = new Set(set);
      if (next.has(days)) next.delete(days); else next.add(days);
      return next;
    });
  }

  protected isOpen(days: number): boolean { return this.openedDays().has(days); }

  protected money(v: number, c: string): string { return formatAmount(v, c); }

  protected open(p: EsimProduct): void {
    this.router.navigate(['/esim', p.id, 'checkout']);
  }
}