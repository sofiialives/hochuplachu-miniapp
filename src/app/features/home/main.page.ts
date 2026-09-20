import { Component, OnDestroy, OnInit, PLATFORM_ID, computed, inject, signal } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { RouterLink } from '@angular/router';
import { BackBarComponent } from '../../ui/back-bar.component';
import { ButtonComponent } from '../../ui/button.component';
import { AuthService } from '../../core/auth/auth.service';
import { CardsApi } from '../../core/api/cards.api';
import { OrdersApi, clearIssuingOrderId, readIssuingOrderId } from '../../core/api/orders.api';
import { CatalogApi, CatalogSections } from '../../core/api/catalog.api';
import { EsimApi, EsimDirection } from '../../core/api/esim.api';
import { HERO_SERVICE_SLUG, ServicesApi, ServiceProduct } from '../../core/api/services.api';
import { ServiceHeroCard } from '../services/service-hero-card';
import { ReferralBanner } from '../profile/referral-banner';
import { ReferralDialog } from '../profile/referral.dialog';
import { formatAmount } from '../../core/currency/currency-symbols';

@Component({
  selector: 'app-main',
  standalone: true,
  imports: [BackBarComponent, ButtonComponent, RouterLink, ReferralBanner, ReferralDialog, ServiceHeroCard],
  template: `<app-back-bar [showBack]="false" />
    <section class="wrap">
      <!-- ===== Hero карт =====
           Виджет статуса выпуска живёт и здесь, и на /cards; при наличии
           карт показывается ВМЕСТЕ с компакт-виджетом (вторая карта). -->
      @if (isAuthed() && issuingOrderId()) {
        <div class="hero hero--issuing">
          <svg class="hero-spin" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" aria-hidden="true">
            <path d="M21 12a9 9 0 1 1-6.219-8.56" />
          </svg>
          <div class="hero-body">
            <div class="hero-title">Карта выпускается…</div>
            <div class="hero-sub">Обычно это занимает несколько минут</div>
          </div>
          <a class="hero-cta" routerLink="/cards"><app-button variant="secondary">К картам</app-button></a>
        </div>
      }
      @if (isAuthed() && cards().length > 0) {
        <a class="hero hero--cards" routerLink="/cards">
          <div class="hero-visual" aria-hidden="true">
            <div class="mini-card"></div>
            @if (cards().length > 1) { <div class="mini-card mini-card--back"></div> }
          </div>
          <div class="hero-body">
            <div class="hero-title">Мои карты</div>
            <div class="hero-sub">{{ cardsCountLabel() }} · пополнение и реквизиты</div>
          </div>
          <span class="hero-arr" aria-hidden="true">→</span>
        </a>
      } @else if (!isAuthed() || !issuingOrderId()) {
        <div class="top-row">
          <div class="hero hero--promo">
            <div class="hero-body">
              <div class="hero-title">Виртуальные карты</div>
              <div class="hero-sub">Выпустите карту для оплаты зарубежных сервисов за пару минут</div>
            </div>
            <a class="hero-cta" [routerLink]="isAuthed() ? '/cards/new' : '/cards'">
              <app-button variant="primary">Выпустить карту</app-button>
            </a>
          </div>
          @if (isAuthed()) {
            <app-referral-banner (clicked)="showReferral.set(true)" [stacked]="true" />
          }
        </div>
      } @else {
        @if (isAuthed()) {
          <app-referral-banner (clicked)="showReferral.set(true)" [stacked]="true" />
        }
      }

      <!-- ===== Секция eSIM ===== -->
      <div class="sec-head">
        <h2>eSIM для путешествий</h2>
        @if (esimAvailable()) { <a class="sec-link" routerLink="/esim">Все тарифы →</a> }
      </div>
      @if (!sections()) {
        <div class="skel-grid" role="status" aria-label="Загрузка">
          <span class="skel"></span><span class="skel"></span>
        </div>
      } @else if (!esimAvailable()) {
        <div class="soon">
          <div class="soon-title">Раздел в разработке</div>
          <div class="soon-sub">Скоро здесь появятся eSIM-тарифы для поездок</div>
        </div>
      } @else if (esimLoading()) {
        <div class="skel-grid" role="status" aria-label="Загрузка тарифов">
          <span class="skel"></span><span class="skel"></span>
        </div>
      } @else {
        <div class="esim-grid stagger-in">
          @for (d of topEsim(); track d.code) {
            <a class="card" [routerLink]="['/esim', 'direction', d.code]">
              <span class="ico">
                @if (d.flag) {
                  <img class="flag" [src]="'/assets/flags/' + d.flag + '.svg'" [alt]="d.name" loading="lazy" />
                } @else {
                  <span class="emoji">{{ d.emoji || '🌍' }}</span>
                }
              </span>
              <span class="name-block">
                <span class="name">{{ d.name }}</span>
                <span class="cnt">{{ d.plans }} {{ plansLabel(d.plans) }}</span>
              </span>
              <span class="from">от {{ money(d.min_price, d.currency) }}</span>
            </a>
          }
          @if (topEsim().length === 0) {
            <div class="soon"><div class="soon-sub">Тарифы скоро появятся</div></div>
          }
        </div>
      }

      <!-- ===== Секция Сервисы ===== -->
      <div class="sec-head">
        <h2>Пополнение сервисов</h2>
        @if (servicesAvailable()) { <a class="sec-link" routerLink="/services">Все сервисы →</a> }
      </div>
      @if (!sections()) {
        <div class="skel-grid" role="status" aria-label="Загрузка">
          <span class="skel"></span><span class="skel"></span>
        </div>
      } @else if (!servicesAvailable()) {
        <div class="soon">
          <div class="soon-title">Раздел в разработке</div>
          <div class="soon-sub">Скоро здесь появятся пополнение Steam и гифткарты</div>
        </div>
      } @else if (servicesLoading()) {
        <div class="skel-grid" role="status" aria-label="Загрузка сервисов">
          <span class="skel"></span><span class="skel"></span>
        </div>
      } @else {
        @if (gridServices().length > 0 || heroService()) {
          <div class="svc-grid stagger-in">
            @if (heroService(); as h) {
              <app-service-hero-card [product]="h" />
            }
            @for (s of gridServices(); track s.id) {
              <a class="svc-card" [routerLink]="['/services', s.slug]">
                @if (s.featured) { <span class="svc-hot">Популярно</span> }
                @if (s.icon_url) {
                  <img class="svc-ico" [src]="s.icon_url" [alt]="s.name" loading="lazy" />
                } @else {
                  <span class="svc-ico svc-ico--stub" aria-hidden="true">{{ s.name.charAt(0) }}</span>
                }
                <span class="svc-name">{{ s.name }}</span>
              </a>
            }
          </div>
        } @else {
          <div class="soon"><div class="soon-sub">Сервисы скоро появятся</div></div>
        }
      }

      @if (showReferral()) {
        <app-referral-dialog (closed)="showReferral.set(false)" />
      }
    </section>`,
  styles: [`
    .wrap {
      padding: 0 16px;
      
      padding-bottom: 110px;
      max-width: 1200px; margin: 0 auto;
      display: flex; flex-direction: column;
    }
    h2 { font-size: 24px; min-width: 0; }
    
    @media (max-width: 767px) {
      h2 { font-size: 19px; }
    }

    
    .hero {
      display: flex; align-items: center; gap: 10px;
      padding: 14px 14px;
      border-radius: var(--rounded-xl);
      border: 1px solid color-mix(in srgb, var(--color-primary) 24%, var(--color-hairline-soft));
      box-shadow: var(--shadow-card);
      text-decoration: none; color: var(--color-ink);
    }
    a.hero { transition: transform var(--dur-quick) var(--ease-out), box-shadow var(--dur-quick) ease; }
    a.hero:hover { transform: translateY(-2px); box-shadow: var(--shadow-card-hover); }
    
    .hero--promo { background-color: white; box-shadow: 0px 26.44px 62.98px -21.64px rgba(0, 0, 0, 0.15); }
    .hero-body { flex: 1; min-width: 0; }
    .hero-title { font-family: var(--font-display); font-size: 15px; font-weight: 700; line-height: 1.2; }
    .hero-sub { color: rgba(0, 0, 0, 1); font-size: 12px; margin-top: 3px; }
    .hero-cta { text-decoration: none; flex: 0 0 auto; }
    .hero-arr { color: var(--color-muted); font-size: 22px; }
    .hero-spin {
      width: 36px; height: 36px; flex: 0 0 36px;
      color: var(--color-primary-ink);
      animation: main-spin 1.2s linear infinite; transform-origin: 50% 50%;
    }
    @keyframes main-spin { to { transform: rotate(360deg); } }
    @media (prefers-reduced-motion: reduce) { .hero-spin { animation: none; } }
    
    .hero-visual { position: relative; width: 72px; height: 48px; flex: 0 0 72px; }
    .mini-card {
      position: absolute; inset: 0;
      border-radius: 8px;
      background: linear-gradient(135deg, #2563eb 0%, #0c1e5d 100%);
      box-shadow: 0 4px 12px rgba(20,20,19,.18);
    }
    .mini-card--back {
      transform: translate(8px, -8px) rotate(4deg);
      background: linear-gradient(135deg, #181715 0%, #2d2a25 100%);
      z-index: -1;
    }

    
    .sec-head {
      display: flex; align-items: center; justify-content: space-between;
      margin-top: 0;
      gap: 4px 12px;
    }
    
    .sec-link { color: rgba(137, 137, 137, 1); font-size: 14px; font-weight: 500; text-decoration: none; white-space: nowrap; flex-shrink: 0; }
    .sec-link:hover { text-decoration: underline; }
    .top-row {
      display: flex; flex-direction: column;
      gap: 16px;
      margin-bottom: 36px;
    }
    @media (min-width: 1024px) {
      .top-row { flex-direction: row; align-items: stretch; gap: 20px; }
      .top-row > * { flex: 1; min-width: 0; }
    }
    .soon {
      padding: var(--space-lg) var(--space-md);
      border: 2px dashed color-mix(in srgb, var(--color-ink) 22%, transparent);
      border-radius: var(--rounded-lg);
      text-align: center;
      background: var(--color-surface);
      margin-bottom: 36px;
    }
    .soon-title { font-weight: 600; }
    .soon-sub { color: var(--color-muted); font-size: 13px; margin-top: 4px; }

    
    .esim-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 10px; margin-bottom: 36px; margin-top: 20px }
    
    .esim-grid .card:nth-child(n+5) { display: none; }
    
    .svc-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 10px; margin-top: 20px}
    .svc-grid app-service-hero-card { grid-column: 1 / -1; }
    
    .svc-grid .svc-card:nth-child(n+6) { display: none; }

    .card {
      display: grid;
      grid-template-columns: clamp(40px, 8vw + 20px, 60px) 1fr;
      grid-template-rows: auto auto;
      column-gap: 8px; row-gap: 4px;
      align-items: start; justify-items: start;
      min-width: 0;
      padding: 12px; border-radius: 14px;
      background: rgba(255, 255, 255, 1);
      box-shadow: 0px 26.44px 62.98px -21.64px rgba(0, 0, 0, 0.15);
      text-decoration: none; color: var(--color-ink);
      text-align: left;
      border: 1px solid transparent; transition: border-color var(--dur-quick) ease;
    }
    .card:hover { border-color: rgba(255, 186, 38, 1); }
    .card:active { transform: scale(.98); }

    .ico { grid-column: 1; grid-row: 1; display: flex; align-items: center; height: clamp(20px, 4vw + 10px, 28px); }
    .flag { width: clamp(28px, 6vw + 12px, 40px); height: clamp(21px, 4.5vw + 9px, 30px); object-fit: cover; border-radius: 6px; box-shadow: 0 1px 4px rgba(0,0,0,.16); flex-shrink: 0; }
    .emoji { font-size: clamp(18px, 4vw + 8px, 26px); line-height: 1; }

    .name-block { grid-column: 1; grid-row: 2; min-width: 0; max-width: 100%; }
    .name { display: block; font-weight: 600; font-size: clamp(11px, 1vw + 8px, 13px); }
    .cnt { color: var(--color-muted); font-size: clamp(9px, 0.6vw + 7.5px, 11px); }

    .from {
      grid-column: 2; grid-row: 1; justify-self: end;
      font-family: 'Syncopate Cyr'; color: rgba(114, 86, 22, 1); font-size: clamp(9px, 0.8vw + 7px, 11px);
      background: rgba(244, 244, 244, 1);
      padding: 6px 9px; border-radius: var(--rounded-pill);
    }
    .badge {
      grid-column: 2; grid-row: 2; justify-self: end;
      font-family: 'Syncopate Cyr';
      background: rgba(255, 186, 38, 1); color: rgba(0, 0, 0, 1);
      padding: 5px 8px; font-size: clamp(6px, 0.4vw + 5px, 7px); text-transform: uppercase;
      border-radius: var(--rounded-pill);
    }

    
    .svc-card {
      position: relative;
      display: flex; flex-direction: column; align-items: center; gap: 8px;
      padding: 14px var(--space-sm);
      background: rgba(255, 255, 255, 1);
      border: 1px solid transparent;
      border-radius: 18px;
      box-shadow: 0px 26.44px 62.98px -21.64px rgba(0, 0, 0, 0.15);
      text-decoration: none; color: var(--color-ink);
      text-align: center;
      transition: border-color var(--dur-quick) ease;
    }
    .svc-card:hover { border-color: rgba(255, 186, 38, 1); }
    .svc-card:active { transform: scale(.98); }
    .svc-ico { width: 44px; height: 44px; border-radius: 12px; object-fit: contain; }
    .svc-ico--stub {
      display: flex; align-items: center; justify-content: center;
      background: var(--color-primary-soft); color: var(--color-primary-ink);
      font-family: var(--font-display); font-size: 20px; font-weight: 700;
    }
    .svc-name {
      font-size: 13px; font-weight: 500; line-height: 1.25; text-align: center;
      display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden;
    }
    
    .svc-hot {
      position: absolute; top: 12px; left: 8px;
      padding: 4px; border-radius: var(--rounded-pill);
      background: rgba(255, 186, 38, 1); color: rgba(0, 0, 0, 1);
      font-family: 'Syncopate Cyr'; font-size: 6px; text-transform: uppercase;
    }

    
    @media (min-width: 1024px) {
      .card { grid-template-columns: 60px 1fr; column-gap: 10px; row-gap: 8px; padding: 16px; }
      .ico { height: 30px; }
      .flag { width: 44px; height: 33px; }
      .name { font-size: 14px; }
      .cnt { font-size: 11px; }
      .from { font-size: 11px; padding: 8px 11px; }
      .badge { font-size: 7px; padding: 5px 9px; }
      .wrap { padding-right: 120px; padding-left: 120px }

      
      .esim-grid { grid-template-columns: repeat(4, 1fr); }
      .esim-grid .card:nth-child(n+5) { display: grid; }

      
      .svc-grid { grid-template-columns: repeat(5, 1fr); }
      .svc-grid app-service-hero-card { grid-column: span 2; }
      .svc-grid .svc-card:nth-child(n+8) { display: flex; }
    }

    
    .skel-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: var(--space-sm); margin-bottom: 36px; }    .skel {
      display: block; height: 92px; border-radius: var(--rounded-lg);
      background: color-mix(in srgb, var(--color-primary) 6%, var(--color-surface));
      border: 1px solid color-mix(in srgb, var(--color-primary) 14%, var(--color-hairline-soft));
      position: relative; overflow: hidden;
    }
    .skel::after {
      content: ""; position: absolute; inset: 0;
      background: linear-gradient(100deg, transparent 32%, color-mix(in srgb, #fff 55%, transparent) 50%, transparent 68%);
      transform: translateX(-100%);
      animation: main-skel 1.6s ease-in-out infinite;
    }
    @keyframes main-skel { to { transform: translateX(100%); } }
    @media (prefers-reduced-motion: reduce) { .skel::after { animation: none; } }

    
    @media (max-width: 1023px) {
      .esim-grid { grid-template-columns: repeat(2, 1fr); }
      .svc-grid { grid-template-columns: repeat(2, 1fr); }
      .svc-grid app-service-hero-card { grid-column: 1 / -1; }
    }
  `],
})
export class MainPage implements OnInit, OnDestroy {
  private readonly auth = inject(AuthService);
  private readonly cardsApi = inject(CardsApi);
  private readonly ordersApi = inject(OrdersApi);
  private readonly catalogApi = inject(CatalogApi);
  private readonly esimApi = inject(EsimApi);
  private readonly servicesApi = inject(ServicesApi);
  private readonly platformId = inject(PLATFORM_ID);

  protected readonly isAuthed = this.auth.isAuthenticated;
  protected readonly cards = this.cardsApi.cardsCache;
  protected readonly showReferral = signal(false);
  protected readonly sections = signal<CatalogSections | null>(null);
  protected readonly esimDirections = signal<EsimDirection[] | null>(null);
  protected readonly serviceProducts = signal<ServiceProduct[] | null>(null);
  protected readonly issuingOrderId = signal('');
  private issuePollTimer: ReturnType<typeof setInterval> | null = null;

  protected readonly esimAvailable = computed(() => this.sections()?.esim === 'available');
  protected readonly servicesAvailable = computed(() => this.sections()?.services === 'available');
  protected readonly esimLoading = computed(() => this.esimAvailable() && this.esimDirections() === null);
  protected readonly servicesLoading = computed(() => this.servicesAvailable() && this.serviceProducts() === null);

  protected readonly topEsim = computed<EsimDirection[]>(() =>
    (this.esimDirections() ?? []).slice(0, 8),
  );
  protected readonly heroService = computed<ServiceProduct | null>(
    () => (this.serviceProducts() ?? []).find((p) => p.slug === HERO_SERVICE_SLUG) ?? null,
  );
  protected readonly gridServices = computed<ServiceProduct[]>(() => {
    const list = (this.serviceProducts() ?? []).filter((p) => !p.disable_purchase);
    const rest = this.heroService() ? list.filter((p) => p.slug !== HERO_SERVICE_SLUG) : list;
    return rest.slice(0, MainPage.SERVICES_TOP);
  });

  protected readonly cardsCountLabel = computed(() => {
    const n = this.cards().length;
    const mod10 = n % 10;
    const mod100 = n % 100;
    let w = 'карт';
    if (mod100 < 11 || mod100 > 14) {
      if (mod10 === 1) w = 'карта';
      else if (mod10 >= 2 && mod10 <= 4) w = 'карты';
    }
    return `${n} ${w}`;
  });

  ngOnInit(): void {
    this.catalogApi.sections().subscribe({
      next: (r) => {
        this.sections.set(r.sections);
        if (r.sections.esim === 'available') {
          this.esimApi.directions().subscribe({
            next: (res) => this.esimDirections.set(res.countries ?? []),
            error: () => this.esimDirections.set([]),
          });
        }
        if (r.sections.services === 'available') {
          this.loadServices();
        }
      },
      error: () => this.sections.set({ cards: 'available', esim: 'coming_soon', services: 'coming_soon' }),
    });
    if (this.auth.isAuthenticated()) {
      this.startIssuePollIfNeeded();
    }
  }

  
  private static readonly SERVICES_TOP = 8;

  private loadServices(): void {
    this.servicesApi.products({ limit: MainPage.SERVICES_TOP + 1, offset: 0 }).subscribe({
      next: (res) => this.serviceProducts.set(res.products ?? []),
      error: () => this.serviceProducts.set([]),
    });
  }

  ngOnDestroy(): void {
    if (this.issuePollTimer) clearInterval(this.issuePollTimer);
  }

  private startIssuePollIfNeeded(): void {
    if (!isPlatformBrowser(this.platformId)) return;
    const id = readIssuingOrderId();
    if (!id) return;
    this.issuingOrderId.set(id);
    const tick = (): void => {
      this.ordersApi.get(id).subscribe({
        next: ({ order }) => {
          if (order.status === 'issued') {
            this.clearIssuingState();
            this.cardsApi.myCards().subscribe({ error: () => { } });
          } else if (order.status !== 'paid' && order.status !== 'issuing') {
            this.clearIssuingState();
          }
        },
        error: (err) => {
          const st = (err as { status?: number })?.status ?? 0;
          if (st === 404 || st === 403) this.clearIssuingState();
        },
      });
    };
    tick();
    this.issuePollTimer = setInterval(tick, 5000);
  }

  private clearIssuingState(): void {
    if (this.issuePollTimer) { clearInterval(this.issuePollTimer); this.issuePollTimer = null; }
    if (this.issuingOrderId()) this.issuingOrderId.set('');
    clearIssuingOrderId();
  }

  protected money(v: number, c: string): string { return formatAmount(v, c); }
  protected plansLabel(n: number): string {
    const mod10 = n % 10;
    const mod100 = n % 100;
    if (mod10 === 1 && mod100 !== 11) return 'тариф';
    if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return 'тарифа';
    return 'тарифов';
  }
}