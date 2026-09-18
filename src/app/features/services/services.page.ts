import { Component, OnDestroy, OnInit, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { BackBarComponent } from '../../ui/back-bar.component';
import { ButtonComponent } from '../../ui/button.component';
import { InputComponent } from '../../ui/input.component';
import { PullToRefreshComponent } from '../../ui/pull-to-refresh.component';
import { CatalogApi, CatalogSections } from '../../core/api/catalog.api';
import { HERO_SERVICE_SLUG, ServiceKind, ServicesApi, ServiceProduct } from '../../core/api/services.api';
import { ServiceHeroCard } from './service-hero-card';

@Component({
  selector: 'app-services-page',
  standalone: true,
  imports: [BackBarComponent, ButtonComponent, InputComponent, PullToRefreshComponent, RouterLink, ServiceHeroCard],
  template: `<app-pull-to-refresh #ptr (refresh)="onPullRefresh(ptr)">
    <app-back-bar [showBack]="false" />
    <section class="wrap">
      <h1>Сервисы</h1>

      @if (!sections()) {
        <div class="skel-list" role="status" aria-label="Загрузка">
          <span class="skel skel-lg"></span><span class="skel"></span>
        </div>
      } @else if (!sectionAvailable()) {
        <div class="soon">
          <div class="soon-title">Раздел в разработке</div>
          <div class="soon-sub">Скоро здесь появятся пополнения, подписки и гифткарты</div>
        </div>
      } @else {
        <!-- Поле поиска живёт ВНЕ ветвлений загрузки: внутри @else оно
             пересоздавалось на каждый запрос — фокус слетал с поля прямо во
             время набора, а вся секция мигала. -->
        <app-input
          [value]="query()"
          (valueChange)="onQuery($event)"
          placeholder="Поиск сервиса"
          class="input-search"
          type="text"></app-input>

        @if (products() === null) {
          <div class="skel-grid" role="status" aria-label="Загрузка сервисов">
            <span class="skel"></span><span class="skel"></span><span class="skel"></span>
            <span class="skel"></span><span class="skel"></span><span class="skel"></span>
          </div>
        }

        @if (visible().length > 0 || hero()) {
          <!-- Steam (hero) — ПРЯМОЙ элемент того же грида, что и остальные
             плитки (как в main.page.ts): на мобиле растягивается на всю
             ширину строки, на десктопе — на 2 колонки из 5, остаток строки
             занимают следующие плитки. Каскадное появление — только у
             неотфильтрованного каталога: на результатах поиска оно
             проигрывалось бы заново с каждым введённым словом. -->
          <div class="grid" [class.stagger-in]="!query()" [class.grid--busy]="searching()">
            @if (hero(); as h) {
              <app-service-hero-card [product]="h" />
            }
            @for (s of visible(); track s.id) {
              <a class="svc" [routerLink]="['/services', s.slug]" [class.svc--disabled]="s.disable_purchase">
                @if (s.featured) { <span class="svc-hot">Популярно</span> }
                @if (s.icon_url) {
                  <img class="svc-ico" [src]="s.icon_url" [alt]="s.name" loading="lazy" />
                } @else {
                  <span class="svc-ico svc-ico--stub" aria-hidden="true">{{ s.name.charAt(0) }}</span>
                }
                <div class="svc-name">{{ s.name }}</div>
                <div class="svc-kind">{{ kindLabel(s.kind) }}</div>
              </a>
            }
          </div>
        }

        @if (hasMore()) {
          <app-button variant="secondary" [full]="true" [loading]="loadingMore()" (clicked)="loadMore()">
            Загрузить ещё
          </app-button>
        }

        @if (products() !== null && visible().length === 0 && !hero()) {
          <div class="soon">
            <div class="soon-sub">
              @if (query()) { Ничего не найдено по «{{ query() }}» }
              @else { Сервисы скоро появятся }
            </div>
          </div>
        }
      }
    </section>
  </app-pull-to-refresh>`,
  styles: [`
    .wrap {
      padding: 0 16px;
      
      padding-bottom: 110px;
      max-width: 1200px; margin: 0 auto;
      display: flex; flex-direction: column;
    }
    h1 { margin: 0; padding: 0; }

    
    .grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 10px; margin-top: 10px; }
    .grid app-service-hero-card { grid-column: 1 / -1; }
    
    .grid--busy { opacity: .5; transition: opacity var(--dur-quick) ease; }
    .input-search { margin-top: 10px; }
    .svc {
      position: relative;
      display: flex; flex-direction: column; align-items: center; gap: 6px;
      padding: var(--space-md) var(--space-sm);
      background: var(--color-surface);
      border: 1px solid transparent;
      border-radius: var(--rounded-lg);
      box-shadow: var(--shadow-card);
      text-decoration: none; color: var(--color-ink);
      text-align: center;
      transition: transform var(--dur-quick) var(--ease-out), border-color var(--dur-quick) ease, box-shadow var(--dur-quick) ease;
    }
    .svc:hover { transform: translateY(-2px); border-color: var(--color-primary); box-shadow: var(--shadow-card-hover); }
    .svc--disabled { opacity: .6; pointer-events: none; }
    .svc-ico { width: 56px; height: 56px; border-radius: 14px; object-fit: contain; }
    
    .svc-ico--stub {
      display: flex; align-items: center; justify-content: center;
      background: var(--color-primary-soft); color: var(--color-primary-ink);
      font-family: var(--font-display); font-size: 24px; font-weight: 700;
    }
    .svc-name {
      font-weight: 600; font-size: 14px; line-height: 1.25;
      display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden;
    }
    .svc-kind { color: var(--color-muted); font-size: 12px; }
    .svc-hot {
      position: absolute; top: 6px; left: 6px;
      padding: 5px 8px; border-radius: var(--rounded-pill);
      background: rgba(255, 186, 38, 1); color: rgba(0, 0, 0, 1);
      font-family: 'Syncopate Cyr'; font-size: 7px; text-transform: uppercase;
    }

    .soon {
      padding: var(--space-lg) var(--space-md);
      border: 2px dashed color-mix(in srgb, var(--color-ink) 22%, transparent);
      border-radius: var(--rounded-lg);
      text-align: center;
      background: var(--color-surface);
    }
    .soon-title { font-weight: 600; }
    .soon-sub { color: var(--color-muted); font-size: 13px; margin-top: 4px; }

    .skel-list { display: flex; flex-direction: column; gap: var(--space-sm); }
    
    .skel-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: var(--space-sm); }
    @media (max-width: 480px) { .skel-grid { grid-template-columns: repeat(2, 1fr); } }
    .skel-grid .skel { height: 124px; }
    .skel {
      display: block; height: 76px; border-radius: var(--rounded-lg);
      background: color-mix(in srgb, var(--color-primary) 6%, var(--color-surface));
      border: 1px solid color-mix(in srgb, var(--color-primary) 14%, var(--color-hairline-soft));
      position: relative; overflow: hidden;
    }
    .skel-lg { height: 120px; }
    .skel::after {
      content: ""; position: absolute; inset: 0;
      background: linear-gradient(100deg, transparent 32%, color-mix(in srgb, #fff 55%, transparent) 50%, transparent 68%);
      transform: translateX(-100%);
      animation: svc-skel 1.6s ease-in-out infinite;
    }
    @keyframes svc-skel { to { transform: translateX(100%); } }
    @media (prefers-reduced-motion: reduce) { .skel::after { animation: none; } }
    @media (min-width: 1024px) {
      .wrap { padding: 0 120px; }
      
      .grid { grid-template-columns: repeat(5, 1fr); }
      .grid app-service-hero-card { grid-column: span 2; }
    }
  `],
})
export class ServicesPage implements OnInit, OnDestroy {
  private readonly catalogApi = inject(CatalogApi);
  private readonly servicesApi = inject(ServicesApi);

  
  private static readonly PAGE = 24;
  
  private static readonly SEARCH_DEBOUNCE_MS = 300;

  protected readonly sections = signal<CatalogSections | null>(null);
  protected readonly products = signal<ServiceProduct[] | null>(null);
  protected readonly query = signal('');
  protected readonly hasMore = signal(false);
  protected readonly loadingMore = signal(false);
  
  protected readonly searching = signal(false);
  private searchTimer: ReturnType<typeof setTimeout> | null = null;
  private reqId = 0;

  protected readonly sectionAvailable = computed(() => this.sections()?.services === 'available');

  protected readonly hero = computed<ServiceProduct | null>(
    () => (this.products() ?? []).find((p) => p.slug === HERO_SERVICE_SLUG) ?? null,
  );

  protected readonly visible = computed<ServiceProduct[]>(() => {
    const list = this.products() ?? [];
    return this.hero() ? list.filter((p) => p.slug !== HERO_SERVICE_SLUG) : list;
  });

  ngOnInit(): void {
    this.catalogApi.sections().subscribe({
      next: (r) => this.sections.set(r.sections),
      error: () => this.sections.set({ cards: 'available', esim: 'coming_soon', services: 'coming_soon' }),
    });
    this.load(0, true);
  }

  ngOnDestroy(): void {
    if (this.searchTimer) clearTimeout(this.searchTimer);
  }

  
  protected onQuery(v: string): void {
    this.query.set(v);
    this.searching.set(true);
    if (this.searchTimer) clearTimeout(this.searchTimer);
    this.searchTimer = setTimeout(() => this.load(0), ServicesPage.SEARCH_DEBOUNCE_MS);
  }

  protected loadMore(): void {
    if (this.loadingMore()) return;
    this.loadingMore.set(true);
    this.load((this.products() ?? []).length);
  }

  private load(offset: number, initial = false): void {
    const id = ++this.reqId;
    if (initial) this.products.set(null);
    this.servicesApi.products({ q: this.query(), limit: ServicesPage.PAGE, offset }).subscribe({
      next: (r) => {
        if (id !== this.reqId) return;
        const page = r.products ?? [];
        this.products.set(offset === 0 ? page : [...(this.products() ?? []), ...page]);
        this.hasMore.set(!!r.has_more);
        this.loadingMore.set(false);
        this.searching.set(false);
      },
      error: () => {
        if (id !== this.reqId) return;
        if (offset === 0) this.products.set([]);
        this.hasMore.set(false);
        this.loadingMore.set(false);
        this.searching.set(false);
      },
    });
  }

  
  protected kindLabel(kind: ServiceKind): string {
    switch (kind) {
      case 'account_topup': return 'Пополнение';
      case 'subscription': return 'Подписка';
      default: return 'Гифткарта';
    }
  }

  protected onPullRefresh(ptr: PullToRefreshComponent): void {
    const id = ++this.reqId;
    this.servicesApi.products({ q: this.query(), limit: ServicesPage.PAGE, offset: 0 }).subscribe({
      next: (r) => {
        if (id === this.reqId) {
          this.products.set(r.products ?? []);
          this.hasMore.set(!!r.has_more);
          this.searching.set(false);
        }
        ptr.finishRefresh();
      },
      error: () => ptr.finishRefresh(),
    });
  }
}