import { Component, OnInit, ViewChild, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { BackBarComponent } from '../../ui/back-bar.component';
import { PullToRefreshComponent } from '../../ui/pull-to-refresh.component';
import { AuthService } from '../../core/auth/auth.service';
import { CatalogApi, CatalogSections } from '../../core/api/catalog.api';
import { MyEsimsComponent } from './my-esims.component';
import { EsimApi, EsimDirection } from '../../core/api/esim.api';
import { EsimDirectionsComponent } from './esim-directions.component';

// EsimPage — «/esim»: зеркалит страницу Карт (решение №5 дизайна) — сверху
// ПОСЛЕДНЯЯ купленная eSIM со ссылкой «Все eSIM» на /esim/my (как «Последние
// операции» → /history на странице карт), ниже каталог направлений. Список
// рисует и грузит MyEsimsComponent; страница держит его только ради
// pull-to-refresh. Гость видит один каталог.
//
// «Все направления» + подпись живут ЗДЕСЬ, а не внутри EsimDirectionsComponent —
// на десктопе этот заголовок стоит в один ряд с ESIM (см. .head-row), а табы/
// поиск/сетка остаются в компоненте на всю ширину ниже.
@Component({
  selector: 'app-esim-page',
  standalone: true,
  imports: [
    BackBarComponent, PullToRefreshComponent, EsimDirectionsComponent, MyEsimsComponent,
  ],
  template: `<app-pull-to-refresh #ptr (refresh)="onPullRefresh(ptr)">
    <app-back-bar [showBack]="false" />
    <section class="wrap">
      <div class="head-row">
        <h1>ESIM</h1>
        <div class="head-sub">
          <h2>Все направления</h2>
          <p class="sub">Выберите страну или регион — покажем все доступные тарифы.</p>
        </div>
      </div>

      <!-- ===== Мои eSIM: последняя, полный список — на /esim/my ===== -->
      @if (isAuthed()) {
        <app-my-esims [limit]="1" />
      }

      <!-- ===== Каталог: направления ===== -->
      @if (!sections()) {
        <div class="skel-list" role="status" aria-label="Загрузка тарифов">
          <span class="skel"></span><span class="skel"></span>
        </div>
      } @else if (!sectionAvailable()) {
        <div class="soon">
          <div class="soon-title">Раздел в разработке</div>
          <div class="soon-sub">Скоро здесь появятся eSIM-тарифы для поездок</div>
        </div>
      } @else if (directions() === null) {
        <div class="skel-list" role="status" aria-label="Загрузка направлений">
          <span class="skel"></span><span class="skel"></span><span class="skel"></span>
        </div>
      } @else {
        <app-esim-directions [countries]="countries()" [regions]="regions()" (picked)="openDirection($event)" />
      }
    </section>
  </app-pull-to-refresh>`,
  styles: [`
    .wrap {
      /* Боковые паддинги: 52px на мобиле, 120px на десктопе (см. медиа-запрос ниже) */
      padding: 0 52px;
      max-width: 1200px; margin: 0 auto;
      display: flex; flex-direction: column;
    }

    /* ===== ESIM + «Все направления»: на мобиле друг под другом,
       на десктопе — в один ряд с отступом 70px между блоками ===== */
    .head-row { display: flex; flex-direction: column; }
    h1 {
      font-family: 'Syncopate Cyr';
      font-size: clamp(24px, 8vw, 76px);
      text-transform: uppercase;
    }
    .head-sub { margin-top: 20px; }
    .head-sub h2 {
      font-family: 'Syncopate Cyr';
      text-transform: uppercase;
      font-size: clamp(18px, 6vw, 28px);
      margin-bottom: 12px;
    }
    .head-sub .sub {
      color: rgba(0, 0, 0, 1);
      font-size: clamp(13px, 3.6vw, 18px);
      line-height: 1.2;
    }

    app-esim-directions { display: block; margin-top: 32px; }

    @media (min-width: 1024px) {
      .wrap { padding: 0 120px; }

      .head-row { flex-direction: row; align-items: flex-start; gap: 70px; }
      .head-sub { margin-top: 0; }
      .head-sub h2 { margin-bottom: 26px; }
      app-esim-directions { margin-top: 60px; }
    }

    /* ===== Каталог: заглушка «в разработке» ===== */
    .soon {
      padding: var(--space-lg) var(--space-md);
      border: 2px dashed color-mix(in srgb, var(--color-ink) 22%, transparent);
      border-radius: var(--rounded-lg);
      text-align: center;
      background: var(--color-surface);
    }
    .soon-title { font-weight: 600; }
    .soon-sub { color: var(--color-muted); font-size: 13px; margin-top: 4px; }

    /* ===== Скелетоны ===== */
    .skel-list { display: flex; flex-direction: column; gap: var(--space-sm); }
    .skel {
      display: block; height: 96px; border-radius: var(--rounded-lg);
      background: color-mix(in srgb, var(--color-primary) 6%, var(--color-surface));
      border: 1px solid color-mix(in srgb, var(--color-primary) 14%, var(--color-hairline-soft));
      position: relative; overflow: hidden;
    }
    .skel::after {
      content: ""; position: absolute; inset: 0;
      background: linear-gradient(100deg, transparent 32%, color-mix(in srgb, #fff 55%, transparent) 50%, transparent 68%);
      transform: translateX(-100%);
      animation: esim-skel 1.6s ease-in-out infinite;
    }
    @keyframes esim-skel { to { transform: translateX(100%); } }
    @media (prefers-reduced-motion: reduce) { .skel::after { animation: none; } }
  `],
})
export class EsimPage implements OnInit {
  private readonly auth = inject(AuthService);
  private readonly esimApi = inject(EsimApi);
  private readonly catalogApi = inject(CatalogApi);
  private readonly router = inject(Router);

  protected readonly isAuthed = this.auth.isAuthenticated;
  protected readonly sections = signal<CatalogSections | null>(null);
  protected readonly directions = signal<{ countries: EsimDirection[]; regions: EsimDirection[] } | null>(null);
  @ViewChild(MyEsimsComponent) private readonly myList?: MyEsimsComponent;

  protected readonly sectionAvailable = computed(() => this.sections()?.esim === 'available');
  protected readonly countries = computed<EsimDirection[]>(() => this.directions()?.countries ?? []);
  protected readonly regions = computed<EsimDirection[]>(() => this.directions()?.regions ?? []);

  ngOnInit(): void {
    this.catalogApi.sections().subscribe({
      next: (r) => this.sections.set(r.sections),
      error: () => this.sections.set({ cards: 'available', esim: 'coming_soon', services: 'coming_soon' }),
    });
    this.loadCatalog();
  }

  private loadCatalog(): void {
    this.esimApi.directions().subscribe({
      next: (r) => this.directions.set({ countries: r.countries ?? [], regions: r.regions ?? [] }),
      error: () => this.directions.set({ countries: [], regions: [] }),
    });
  }

  protected openDirection(d: EsimDirection): void {
    this.router.navigate(['/esim', 'direction', d.code]);
  }

  protected onPullRefresh(ptr: PullToRefreshComponent): void {
    this.myList?.reload();
    this.esimApi.directions().subscribe({
      next: (r) => this.directions.set({ countries: r.countries ?? [], regions: r.regions ?? [] }),
      error: () => ptr.finishRefresh(),
      complete: () => ptr.finishRefresh(),
    });
  }
}