import { Component, OnInit, computed, inject, input, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { ButtonComponent } from '../../ui/button.component';
import { DialogComponent } from '../../ui/dialog.component';
import { EsimInstallComponent } from './esim-install.component';
import { EsimApi, MyEsim, formatDataMb } from '../../core/api/esim.api';
import { ToastService } from '../../core/notifications/toast.service';

// MyEsimsComponent — список купленных eSIM (статус, остаток трафика, QR,
// «Продлить», обновление остатка) с диалогом установки. Данные грузит САМ,
// наружу торчит `reload()` — его зовёт pull-to-refresh страницы-хозяина.
//
// Один компонент на два места: на «/esim» он под лимитом (последние N + ссылка
// «Все eSIM»), на «/esim/my» — целиком. Раньше разметка жила прямо в EsimPage,
// и вторая страница означала бы её копию.
@Component({
  selector: 'app-my-esims',
  standalone: true,
  imports: [ButtonComponent, DialogComponent, RouterLink, EsimInstallComponent],
  template: `
    @if (esims(); as list) {
      @if (list.length > 0) {
        <div class="my-list stagger-in">
          @for (e of visible(); track e.id) {
            <div class="esim">
              <div class="esim-head">
                <div class="esim-title">
                  <div class="esim-name">{{ e.country_name || e.name || 'eSIM' }}</div>
                  <div class="esim-sub">{{ e.name }}</div>
                </div>
                <span class="badge" [attr.data-status]="e.status">{{ statusLabel(e.status) }}</span>
              </div>

              @if (e.data_total_mb) {
                <div class="traffic">
                  <div class="traffic-bar">
                    <span class="traffic-fill" [style.width.%]="trafficPct(e)"></span>
                  </div>
                  <div class="traffic-note">
                    Осталось {{ mb(e.data_left_mb ?? 0) }} из {{ mb(e.data_total_mb) }}
                  </div>
                </div>
              } @else if (e.data_mb === 0) {
                <div class="traffic-note">Безлимитный трафик</div>
              }

              <div class="esim-meta">
                @if (e.expire_at) { <span>Действует до {{ dateOf(e.expire_at) }}</span> }
                @else if (e.status === 'active') { <span>Срок начнётся с первой активации</span> }
                @if (e.usage_synced_at) { <span class="muted">· обновлено {{ timeOf(e.usage_synced_at) }}</span> }
              </div>

              <div class="esim-actions">
                @if (e.status !== 'issuing') {
                  <app-button variant="secondary" (clicked)="openQr(e)">QR-код</app-button>
                  <a [routerLink]="['/esim/my', e.id, 'recharge']">
                    <app-button variant="primary">Продлить</app-button>
                  </a>
                  <button type="button" class="refresh" [class.busy]="refreshing() === e.id"
                          [disabled]="refreshing() === e.id"
                          (click)="refreshUsage(e)" aria-label="Обновить остаток">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                      <path d="M3 12a9 9 0 1 0 3-6.7"/>
                      <path d="M3 4v5h5"/>
                    </svg>
                  </button>
                } @else {
                  <span class="issuing-note">Выпускается — QR появится через пару минут</span>
                }
              </div>
            </div>
          }
        </div>
        @if (hidden() > 0) {
          <a class="link-btn" routerLink="/esim/my">Все eSIM ({{ list.length }})</a>
        }
      } @else if (showEmpty()) {
        <p class="empty">Купленных eSIM пока нет.</p>
      }
    } @else {
      <div class="skel-list" role="status" aria-label="Загрузка eSIM">
        <span class="skel"></span>
      </div>
    }

    @if (qrFor()) {
      <app-dialog title="Установка eSIM" (dismissed)="closeQr()">
        @if (qrData(); as q) {
          <app-esim-install [qr]="q.qr" [iccid]="q.iccid" />
        } @else if (qrError()) {
          <p class="muted">{{ qrError() }}</p>
        } @else {
          <p class="muted">Загружаем QR-код…</p>
        }
      </app-dialog>
    }
  `,
  styles: [`
    :host { display: flex; flex-direction: column; gap: var(--space-sm); }
    .my-list { display: flex; flex-direction: column; gap: var(--space-sm); }
    .esim {
      display: flex; flex-direction: column; gap: 10px;
      padding: var(--space-md);
      background: var(--color-surface);
      border: 1px solid transparent;
      border-radius: var(--rounded-lg);
      box-shadow: var(--shadow-card);
    }
    .esim-head { display: flex; align-items: flex-start; justify-content: space-between; gap: var(--space-sm); }
    .esim-name { font-weight: 600; font-size: 16px; }
    .esim-sub { color: var(--color-muted); font-size: 13px; margin-top: 2px; }
    .badge {
      flex: 0 0 auto;
      padding: 4px 10px; border-radius: var(--rounded-pill);
      font-size: 12px; font-weight: 600;
      background: color-mix(in srgb, var(--color-muted) 14%, transparent);
      color: var(--color-muted);
    }
    .badge[data-status="active"] { background: color-mix(in srgb, var(--color-success) 14%, transparent); color: var(--color-success); }
    .badge[data-status="issuing"] { background: color-mix(in srgb, var(--color-warning) 16%, transparent); color: var(--color-warning); }
    .badge[data-status="expired"], .badge[data-status="depleted"] { background: color-mix(in srgb, var(--color-error) 12%, transparent); color: var(--color-error); }

    .traffic { display: flex; flex-direction: column; gap: 6px; }
    .traffic-bar {
      height: 8px; border-radius: 999px; overflow: hidden;
      background: color-mix(in srgb, var(--color-ink) 10%, transparent);
    }
    .traffic-fill {
      display: block; height: 100%;
      background: var(--grad-primary);
      border-radius: 999px;
      transition: width .6s var(--ease-out);
    }
    .traffic-note { color: var(--color-muted); font-size: 13px; }

    .esim-meta { display: flex; flex-wrap: wrap; gap: 6px; font-size: 13px; color: var(--color-body); }
    .muted { color: var(--color-muted); }
    .esim-actions { display: flex; align-items: center; gap: var(--space-sm); }
    .esim-actions a { text-decoration: none; }
    .issuing-note { color: var(--color-muted); font-size: 13px; }
    .refresh {
      width: 40px; height: 40px; flex: 0 0 40px;
      display: inline-flex; align-items: center; justify-content: center;
      border-radius: var(--rounded-pill);
      background: var(--color-surface-card); color: var(--color-ink);
      border: none; cursor: pointer;
      transition: background var(--dur-quick) ease, transform var(--dur-quick) var(--ease-out);
    }
    .refresh:hover:not(:disabled) { background: var(--color-primary-soft); }
    .refresh svg { width: 18px; height: 18px; }
    .refresh.busy svg { animation: my-esim-spin .9s linear infinite; transform-origin: 50% 50%; }
    @keyframes my-esim-spin { to { transform: rotate(360deg); } }

    .link-btn {
      align-self: center;
      color: var(--color-primary-ink); font-size: 14px; font-weight: 500;
      text-decoration: none; padding: var(--space-sm);
    }
    .link-btn:hover { text-decoration: underline; }
    .empty { margin: 0; color: var(--color-muted); text-align: center; }

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
      animation: my-esim-skel 1.6s ease-in-out infinite;
    }
    @keyframes my-esim-skel { to { transform: translateX(100%); } }
    @media (prefers-reduced-motion: reduce) { .skel::after { animation: none; } }
  `],
})
export class MyEsimsComponent implements OnInit {
  private readonly esimApi = inject(EsimApi);
  private readonly toast = inject(ToastService);

  /** Сколько карточек показывать; 0 = все (страница «Все eSIM»). */
  readonly limit = input(0);
  /** Рисовать ли «Купленных eSIM пока нет» — на «/esim» пусто молчит: ниже каталог. */
  readonly showEmpty = input(false);

  // null = грузится (скелетон), [] = пусто.
  protected readonly esims = signal<MyEsim[] | null>(null);
  protected readonly refreshing = signal('');
  protected readonly qrFor = signal<MyEsim | null>(null);
  protected readonly qrData = signal<{ qr: string; iccid: string } | null>(null);
  protected readonly qrError = signal('');

  protected readonly visible = computed(() => {
    const list = this.esims() ?? [];
    const n = this.limit();
    return n > 0 ? list.slice(0, n) : list;
  });
  protected readonly hidden = computed(() => (this.esims()?.length ?? 0) - this.visible().length);

  ngOnInit(): void { this.reload(); }

  /** Публичный — pull-to-refresh страницы-хозяина. */
  reload(): void {
    this.esimApi.my().subscribe({
      next: (r) => this.esims.set(r.esims ?? []),
      error: () => this.esims.set([]),
    });
  }

  // refreshUsage — живой остаток (бэк троттлит 1/мин на eSIM; провайдер
  // недоступен — приходит кеш со stale=true).
  protected refreshUsage(e: MyEsim): void {
    if (this.refreshing()) return;
    this.refreshing.set(e.id);
    this.esimApi.refreshUsage(e.id).subscribe({
      next: (r) => {
        this.refreshing.set('');
        const updated = r?.esim;
        if (updated) {
          this.esims.update((list) => (list ?? []).map((x) => (x.id === e.id ? { ...x, ...updated } : x)));
          // stale=true — запрос УСПЕШЕН (200), просто провайдер не ответил и
          // цифры остались прежними: это info, а не ошибка. И не обещаем
          // «сохранённый остаток»: у eSIM, которую ещё не устанавливали, его
          // может не быть вовсе.
          if (updated.stale) this.toast.info('Провайдер не ответил — остаток не обновился');
        }
      },
      error: (err) => {
        this.refreshing.set('');
        const code = err?.error?.error?.code ?? '';
        this.toast.error(code === 'RATE_LIMITED'
          ? 'Обновлять остаток можно раз в минуту'
          : 'Не удалось обновить остаток');
      },
    });
  }

  protected openQr(e: MyEsim): void {
    this.qrFor.set(e);
    this.qrData.set(null);
    this.qrError.set('');
    this.esimApi.qr(e.id).subscribe({
      next: (r) => this.qrData.set(r),
      error: (err) => this.qrError.set(err?.error?.error?.message ?? 'QR-код ещё не получен'),
    });
  }
  protected closeQr(): void {
    this.qrFor.set(null);
    this.qrData.set(null);
  }

  protected statusLabel(s: string): string {
    switch (s) {
      case 'issuing': return 'Выпускается';
      case 'active': return 'Активна';
      case 'expired': return 'Истекла';
      case 'depleted': return 'Трафик исчерпан';
      default: return s;
    }
  }
  protected trafficPct(e: MyEsim): number {
    const total = e.data_total_mb ?? 0;
    if (total <= 0) return 0;
    const left = Math.max(0, e.data_left_mb ?? 0);
    return Math.max(0, Math.min(100, (left / total) * 100));
  }
  protected mb(v: number): string { return formatDataMb(v); }
  protected dateOf(iso: string): string { return new Date(iso).toLocaleDateString('ru-RU'); }
  protected timeOf(iso: string): string {
    return new Date(iso).toLocaleString('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  }
}
