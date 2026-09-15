import { Component, computed, effect, inject, signal, HostListener } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { NavigationEnd, Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { filter } from 'rxjs/operators';
import { AuthService } from '../../core/auth/auth.service';
import { AdminApi, IssuerBalance } from '../../core/api/admin.api';
import { errorMessage } from '../../core/errors/api-error';
import { formatAmount } from '../../core/currency/currency-symbols';

@Component({
  selector: 'app-admin-shell',
  standalone: true,
  imports: [RouterLink, RouterLinkActive, RouterOutlet],
  template: `<div class="admin" [class.menu-open]="menuOpen()">
    <aside>
      <div class="top">
        <h2>Админ</h2>
        <!-- Остаток кошелька issuer-аккаунта (деньги СЕРВИСА, с них идут выпуск
             карт, funding пополнений и комиссии провайдера) — admin-only, как и
             сам endpoint. Значение живое: грузится при входе в админку и по
             клику «обновить». Живёт внутри .top: на десктопе занимает свою
             строку под заголовком (flex-wrap), на мобиле встаёт в одну строку
             шапки между заголовком и бургером. -->
        @if (isAdmin()) {
          <div class="balance" [class.err]="!!balanceError()">
            <span class="bal-label">Баланс issuer</span>
            <span class="bal-row">
              <span class="bal-value" [title]="balanceError() || ''">{{ balanceText() }}</span>
              <button type="button" class="bal-refresh" (click)="loadBalance()"
                      [disabled]="balanceLoading()" title="Обновить баланс" aria-label="Обновить баланс">
                <svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true">
                  <path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"
                        d="M20 11a8 8 0 1 0-.6 4M20 5v6h-6"/>
                </svg>
              </button>
            </span>
            <!-- Свободные лоты выпуска карт из KYC-пула issuer'а (1 KYC даёт
                 квоту карт, обычно 3). Поле опциональное: старый backend/issuer
                 его не отдаёт — строка тогда не рисуется. -->
            @if (freeCardSlots() !== null) {
              <span class="bal-slots" title="Сколько карт ещё можно выпустить из KYC-пула issuer'а">
                Свободно лотов карт: <b>{{ freeCardSlots() }}</b>
              </span>
            }
            @if (balanceError()) {
              <span class="bal-err">{{ balanceError() }}</span>
            }
          </div>
        }
        <!-- Бургер — только мобильный (на десктопе display:none). Открывает
             выпадающее меню разделов; иконка морфится в «×». -->
        <button type="button" class="burger" (click)="toggleMenu()"
                [attr.aria-expanded]="menuOpen()" aria-label="Разделы админки" aria-haspopup="menu">
          @if (menuOpen()) {
            <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
              <path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" d="M6 6l12 12M18 6L6 18"/>
            </svg>
          } @else {
            <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
              <path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" d="M4 7h16M4 12h16M4 17h16"/>
            </svg>
          }
        </button>
      </div>
      <!-- Клик по любой ссылке всплывает сюда и закрывает выпадашку на мобиле. -->
      <nav (click)="closeMenu()">
        <!-- Карты-продукты / Промокоды / Партнёры / Реф-программа — только
             admin: их endpoints закрыты RequireAdmin, роуты — adminOnlyGuard. -->
        @if (isAdmin()) {
          <a routerLink="products" routerLinkActive="active">Карты-продукты</a>
          <!-- eSIM/Сервис-продукты — admin-only (endpoints под RequireAdmin). -->
          <a routerLink="esim-products" routerLinkActive="active">eSIM-продукты</a>
          <a routerLink="service-products" routerLinkActive="active">Сервисы-продукты</a>
        }
        <a routerLink="cards" routerLinkActive="active">Выпущенные карты</a>
        <a routerLink="orders" routerLinkActive="active">Заявки</a>
        @if (isAdmin()) {
          <!-- Транзакции карт (общий список) — admin-only: модератор видит
               движения только в разрезе пользователя (deep-link из
               «Пользователей»). С фичей eSIM/сервисов подпись уточняет, что
               здесь ТОЛЬКО карточные движения. -->
          <a routerLink="transactions" routerLinkActive="active">Транзакции карт</a>
          <a routerLink="payment-methods" routerLinkActive="active">Методы оплаты</a>
          <a routerLink="promo" routerLinkActive="active">Промокоды</a>
          <a routerLink="partners" routerLinkActive="active">Партнёры</a>
          <a routerLink="referral" routerLinkActive="active">Реф-программа</a>
          <a routerLink="retention" routerLinkActive="active">Ретеншен</a>
          <a routerLink="notifications" routerLinkActive="active">Логирование</a>
        }
        <a routerLink="users" routerLinkActive="active">Пользователи</a>
      </nav>
      <!-- «К приложению» — на десктопе футер sticky-сайдбара (всегда в зоне
           видимости, не надо доскролливать), на мобиле — fixed pill внизу
           экрана (см. media-query). -->
      <a class="back" routerLink="/">
        <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
          <path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" d="M15 6l-6 6 6 6"/>
        </svg>
        <span>К приложению</span>
      </a>
    </aside>
    <!-- Затемнение под выпадашкой (только мобиле). Клик — закрыть. -->
    <div class="backdrop" (click)="closeMenu()" aria-hidden="true"></div>
    <main><router-outlet /></main>
  </div>`,
  styles: [`
    .admin { display: grid; grid-template-columns: 240px 1fr; min-height: 100vh; }
    /* sticky + height:100vh: сайдбар пришпилен к вьюпорту, контент main
       скроллится под ним, футер «К приложению» всегда виден. align-self:start
       — чтобы grid-трек не растягивал aside по высоте контента. */
    aside {
      position: sticky; top: 0; align-self: start; height: 100vh; box-sizing: border-box;
      background: var(--color-surface-dark); color: var(--color-on-dark);
      padding: var(--space-lg); display: flex; flex-direction: column; gap: var(--space-md);
    }
    /* flex-wrap — чтобы плашка баланса (flex-basis:100%) уехала на свою
       строку под заголовком; на мобиле она встаёт в ту же строку (см. media). */
    .top { display: flex; align-items: center; flex-wrap: wrap; gap: var(--space-sm); }
    aside h2 { color: var(--color-on-dark); margin: 0; }

    .balance {
      flex: 1 0 100%;
      display: flex; flex-direction: column; gap: 2px;
      padding: 8px 12px; border-radius: var(--rounded-md);
      background: var(--color-surface-dark-soft);
    }
    .bal-label { font-size: 11px; text-transform: uppercase; letter-spacing: .04em; color: var(--color-on-dark-soft); }
    .bal-row { display: flex; align-items: center; gap: 6px; }
    .bal-value { font-size: 17px; font-weight: 600; color: var(--color-on-dark); font-variant-numeric: tabular-nums; }
    .balance.err .bal-value { color: var(--color-on-dark-soft); }
    .bal-refresh {
      margin-left: auto; display: inline-flex; align-items: center; justify-content: center;
      width: 26px; height: 26px; padding: 0; border: 0; border-radius: var(--rounded-sm);
      background: transparent; color: var(--color-on-dark-soft); cursor: pointer;
      transition: background .12s ease, color .12s ease;
    }
    .bal-refresh:hover:not(:disabled) { background: var(--color-surface-dark-elevated); color: var(--color-on-dark); }
    .bal-refresh:disabled { opacity: .5; cursor: default; }
    .bal-slots { font-size: 11px; line-height: 1.3; color: var(--color-on-dark-soft); }
    .bal-slots b { font-weight: 600; color: var(--color-on-dark); font-variant-numeric: tabular-nums; }
    .bal-err { font-size: 11px; line-height: 1.3; color: var(--color-on-dark-soft); }
    /* Бургер и бэкдроп — чисто мобильные, на десктопе их нет. */
    .burger { display: none; }
    .backdrop { display: none; }
    /* flex:1 + own overflow: длинное меню скроллится внутри сайдбара, не
       выталкивая футер за пределы вьюпорта. */
    nav { display: flex; flex-direction: column; gap: 4px; flex: 1 1 auto; min-height: 0; overflow-y: auto; }
    nav a { color: var(--color-on-dark-soft); padding: 8px 12px; border-radius: var(--rounded-sm); text-decoration: none; white-space: nowrap; transition: color .12s ease, background .12s ease; }
    nav a:hover { color: var(--color-on-dark); }
    nav a.active { background: var(--color-surface-dark-elevated); color: var(--color-on-dark); }
    .back {
      flex: 0 0 auto;
      display: inline-flex; align-items: center; justify-content: center; gap: 6px;
      padding: 11px 12px; border-radius: var(--rounded-md);
      background: var(--color-surface-dark-soft); color: var(--color-on-dark);
      font-size: 14px; font-weight: 500; text-decoration: none;
      transition: background .12s ease;
    }
    .back:hover { background: var(--color-surface-dark-elevated); }
    .back svg { flex: 0 0 auto; }
    /* min-width:0 — даёт 1fr-треку сжиматься, чтобы широкие таблицы
       скроллились ВНУТРИ main (overflow:auto), а не распирали всю страницу. */
    main { padding: var(--space-xl); background: var(--color-canvas); overflow: auto; min-width: 0; }

    @media (max-width: 768px) {
      .admin { grid-template-columns: 1fr; }
      /* Компактная липкая шапка: заголовок слева + бургер справа. Никаких
         рядов ссылок — они уезжают в выпадашку.
         min-width:0 — обязателен: без него авто-минимум 1fr-трека берёт
         max-content содержимого и распирает грид → горизонтальный скролл. */
      aside {
        position: sticky; top: 0; height: auto; min-width: 0;
        flex-direction: column; align-items: stretch; gap: 0;
        padding: var(--space-sm) var(--space-md); z-index: 40;
      }
      .top { justify-content: space-between; gap: var(--space-sm); }
      aside h2 { font-size: 16px; }
      /* Мобильная шапка — одна строка: заголовок, компактный баланс, бургер.
         Подпись, лоты и текст ошибки прячем (причина остаётся в title
         значения), иначе шапка растёт в высоту на каждом экране админки. */
      .balance {
        flex: 0 1 auto; margin-left: auto;
        flex-direction: row; align-items: center; gap: 4px;
        padding: 4px 8px; min-width: 0;
      }
      .bal-label, .bal-slots, .bal-err { display: none; }
      .bal-value { font-size: 14px; }
      .bal-refresh { width: 24px; height: 24px; }
      .burger {
        display: inline-flex; align-items: center; justify-content: center;
        width: 40px; height: 40px; margin: -4px -6px -4px 0; padding: 0;
        border: 0; border-radius: var(--rounded-md);
        background: transparent; color: var(--color-on-dark); cursor: pointer;
        -webkit-tap-highlight-color: transparent;
        transition: background .12s ease;
      }
      .burger:hover, .burger:active { background: var(--color-surface-dark-elevated); }

      /* Выпадашка: карточка под шапкой (absolute относительно sticky-aside).
         По умолчанию скрыта — fade + сдвиг вверх; открывается по .menu-open. */
      nav {
        position: absolute; top: 100%; left: var(--space-md); right: var(--space-md);
        flex-direction: column; gap: 2px; margin-top: var(--space-xs);
        padding: var(--space-xs);
        background: var(--color-surface-dark-elevated);
        border-radius: var(--rounded-lg);
        box-shadow: 0 12px 32px rgba(20, 20, 19, .44), 0 4px 12px rgba(20, 20, 19, .28);
        max-height: min(70vh, 460px); overflow-y: auto; z-index: 50;
        opacity: 0; transform: translateY(-8px) scale(.98); transform-origin: top right;
        visibility: hidden; pointer-events: none;
        transition: opacity .16s ease, transform .16s ease, visibility 0s linear .16s;
      }
      .admin.menu-open nav {
        opacity: 1; transform: none; visibility: visible; pointer-events: auto;
        transition: opacity .16s ease, transform .16s ease;
      }
      nav a { padding: 12px 14px; border-radius: var(--rounded-md); font-size: 15px; }
      nav a:hover { background: var(--color-surface-dark-soft); }
      nav a.active { background: var(--color-surface-dark-soft); color: var(--color-on-dark); }

      /* Бэкдроп затемняет контент под открытой выпадашкой (не саму шапку —
         aside z:40 выше бэкдропа z:35). */
      .backdrop {
        display: block; position: fixed; inset: 0; z-index: 35;
        background: rgba(20, 20, 19, .5);
        opacity: 0; pointer-events: none; transition: opacity .16s ease;
      }
      .admin.menu-open .backdrop { opacity: 1; pointer-events: auto; }

      /* «К приложению» — fixed pill внизу, всегда доступен без скролла. */
      .back {
        position: fixed; left: var(--space-md); right: var(--space-md);
        bottom: max(var(--space-sm), env(safe-area-inset-bottom)); z-index: 60;
        padding: 14px; border-radius: var(--rounded-pill);
        background: var(--color-surface-dark);
        box-shadow: 0 6px 20px rgba(20, 20, 19, .28), 0 2px 6px rgba(20, 20, 19, .16);
      }
      .back:hover { background: var(--color-surface-dark-elevated); }
      /* padding-bottom — резерв под fixed pill, чтобы он не перекрывал контент.
         overflow:auto наследуется из базового правила — широкие таблицы
         скроллятся внутри main, а не распирают страницу по горизонтали. */
      main { padding: var(--space-lg) var(--space-md) 88px; }
    }
  `],
})
export class AdminShell {
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  private readonly api = inject(AdminApi);
  protected readonly isAdmin = computed(() => this.auth.user()?.role === 'admin');
  protected readonly menuOpen = signal(false);

  // Баланс кошелька issuer-аккаунта. Запрос идёт живьём в card-issuer, поэтому
  // держим три состояния: загрузка, значение, причина отказа.
  protected readonly balance = signal<IssuerBalance | null>(null);
  protected readonly balanceLoading = signal(false);
  protected readonly balanceError = signal('');
  private balanceRequested = false;

  // Свободные лоты выпуска карт из KYC-пула issuer'а (приходит вместе с
  // балансом). null — поле не пришло (старый backend/issuer либо счётчик
  // недоступен) — строка не показывается.
  protected readonly freeCardSlots = computed(() => {
    const v = this.balance()?.free_card_slots;
    return typeof v === 'number' ? v : null;
  });

  // «$1 234,50»; до первого ответа — многоточие, при ошибке — прочерк
  // (причина живёт в подписи под значением и в title, чтобы плашка не прыгала).
  protected readonly balanceText = computed(() => {
    const b = this.balance();
    if (b) {
      const value = b.balance.toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
      return formatAmount(value, b.currency);
    }
    return this.balanceError() ? '—' : '…';
  });

  constructor() {
    // Закрываем выпадашку на любой навигации (в т.ч. программной), чтобы она
    // не осталась висеть после перехода в раздел.
    this.router.events
      .pipe(filter((e): e is NavigationEnd => e instanceof NavigationEnd), takeUntilDestroyed())
      .subscribe(() => this.menuOpen.set(false));

    // Роль обычно известна уже к созданию шелла (adminGuard ждёт bootstrap),
    // но user() — сигнал, поэтому ждём подтверждения роли эффектом. Грузим
    // ровно один раз: дальше только по кнопке «обновить».
    effect(() => {
      if (this.isAdmin() && !this.balanceRequested) {
        this.balanceRequested = true;
        this.loadBalance();
      }
    });
  }

  // Модератору endpoint отвечает 403 — плашки у него нет, вызывать некому.
  protected loadBalance(): void {
    if (this.balanceLoading()) return;
    this.balanceLoading.set(true);
    this.api.issuerBalance().subscribe({
      next: (b) => {
        this.balance.set(b);
        this.balanceError.set('');
        this.balanceLoading.set(false);
      },
      error: (e: unknown) => {
        this.balanceError.set(errorMessage(e, 'Баланс недоступен'));
        this.balanceLoading.set(false);
      },
    });
  }

  protected toggleMenu(): void { this.menuOpen.update((v) => !v); }
  protected closeMenu(): void { this.menuOpen.set(false); }

  @HostListener('document:keydown.escape')
  protected onEscape(): void { this.closeMenu(); }
}
