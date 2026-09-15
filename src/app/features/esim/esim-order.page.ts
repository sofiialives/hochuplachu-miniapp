import { Component, OnInit, inject, signal } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { BackBarComponent } from '../../ui/back-bar.component';
import { ButtonComponent } from '../../ui/button.component';
import { EsimInstallComponent } from './esim-install.component';
import { EsimApi, EsimOrder } from '../../core/api/esim.api';
import { formatAmount } from '../../core/currency/currency-symbols';

// EsimOrderPage — «/esim/orders/:id», view-режим заказа (deep-link из
// истории/писем, возврат позже): статус, QR по кнопке, детали. Оплата
// незакрытой заявки — переход на payment-страницу.
@Component({
  selector: 'app-esim-order',
  standalone: true,
  imports: [BackBarComponent, ButtonComponent, RouterLink, EsimInstallComponent],
  template: `<app-back-bar />
    <section class="wrap">
      <h2>Заказ eSIM</h2>
      @if (order(); as o) {
        <div class="card">
          <div class="row">
            <span class="lbl">Тариф</span>
            <span class="val">{{ o.product_name }}</span>
          </div>
          <div class="row">
            <span class="lbl">Статус</span>
            <span class="badge" [attr.data-status]="o.status">{{ statusLabel(o.status) }}</span>
          </div>
          <div class="row">
            <span class="lbl">Сумма</span>
            <span class="val">{{ money(o.amount_issue, o.issue_currency) }}</span>
          </div>
          @if (o.created_at) {
            <div class="row">
              <span class="lbl">Создан</span>
              <span class="val">{{ dateOf(o.created_at) }}</span>
            </div>
          }
        </div>

        @if (o.status === 'issued') {
          @if (qrData(); as q) {
            <app-esim-install [qr]="q.qr" [iccid]="q.iccid" />
          } @else if (qrLoading()) {
            <div class="qr-card qr-card--skel" role="status" aria-label="Загрузка QR-кода"></div>
          } @else {
            <p class="muted small center">{{ qrError() || 'QR-код ещё не готов.' }}</p>
            <app-button variant="secondary" [full]="true" (clicked)="loadQr()">Повторить</app-button>
          }
        } @else if (o.status === 'pending_payment' || o.status === 'pending_kyc') {
          <a [routerLink]="['/esim/orders', o.id, 'payment']" class="pay-link">
            <app-button variant="primary" [full]="true">Перейти к оплате</app-button>
          </a>
        } @else if (o.status === 'paid') {
          <p class="muted center">Оплата получена — выпускаем eSIM. QR-код появится здесь и придёт на email.</p>
        } @else if (o.status === 'refunded') {
          <p class="muted center">Заказ не выполнен — средства будут возвращены.</p>
        } @else if (o.status === 'failed') {
          <p class="muted center">Заказ не выполнен. Обратитесь в поддержку — мы поможем решить проблему.</p>
        }

        <a class="link-btn" routerLink="/esim">К моим eSIM</a>
      } @else if (notFound()) {
        <p class="muted center">Заказ не найден.</p>
        <a class="link-btn" routerLink="/esim">К моим eSIM</a>
      } @else {
        <div role="status" aria-label="Загрузка заказа">
          <span class="skel"></span>
          <span class="skel"></span>
        </div>
      }
    </section>`,
  styles: [`
    .wrap { padding: var(--space-md); max-width: 560px; margin: 0 auto; padding-bottom: var(--space-xl); display: flex; flex-direction: column; gap: var(--space-md); }
    h2 { text-align: center; margin: 0; }
    /* Ритм задаёт gap флекс-колонки .wrap; браузерные margin'ы абзацев в
       флексе не схлопываются и складывались бы с gap в неровные разрывы. */
    .wrap p { margin: 0; }
    .muted { color: var(--color-muted); }
    .small { font-size: 13px; }
    .center { text-align: center; }
    .card {
      display: flex; flex-direction: column;
      padding: 4px var(--space-md);
      background: var(--color-surface);
      border: 1px solid var(--color-hairline-soft);
      border-radius: var(--rounded-lg);
    }
    .row {
      display: flex; align-items: center; justify-content: space-between; gap: var(--space-sm);
      padding: 12px 0;
      border-bottom: 1px solid var(--color-hairline-soft);
    }
    .row:last-child { border-bottom: none; }
    .lbl { color: var(--color-muted); font-size: 13px; }
    .val { font-weight: 500; text-align: right; }
    .badge {
      padding: 4px 10px; border-radius: var(--rounded-pill);
      font-size: 12px; font-weight: 600;
      background: color-mix(in srgb, var(--color-muted) 14%, transparent);
      color: var(--color-muted);
    }
    .badge[data-status="issued"] { background: color-mix(in srgb, var(--color-success) 14%, transparent); color: var(--color-success); }
    .badge[data-status="paid"], .badge[data-status="pending_payment"], .badge[data-status="pending_kyc"] { background: color-mix(in srgb, var(--color-warning) 16%, transparent); color: var(--color-warning); }
    .badge[data-status="failed"], .badge[data-status="refunded"] { background: color-mix(in srgb, var(--color-error) 12%, transparent); color: var(--color-error); }
    .qr-card { display: flex; justify-content: center; padding: var(--space-md); background: white; border-radius: var(--rounded-md); }
    .qr-card :is(canvas, img, svg) { max-width: 100%; height: auto; }
    /* Скелет ровно под QR 220×220 + паддинги — блок не «прыгает» при доезде. */
    .qr-card--skel { height: 220px; background: color-mix(in srgb, var(--color-primary) 6%, #fff); position: relative; overflow: hidden; }
    .qr-card--skel::after {
      content: ""; position: absolute; inset: 0;
      background: linear-gradient(100deg, transparent 32%, color-mix(in srgb, #fff 55%, transparent) 50%, transparent 68%);
      transform: translateX(-100%); animation: eo-skel 1.6s ease-in-out infinite;
    }
    @keyframes eo-skel { to { transform: translateX(100%); } }
    @media (prefers-reduced-motion: reduce) { .qr-card--skel::after { animation: none; } }
    .pay-link { text-decoration: none; }
    .link-btn {
      align-self: center;
      color: var(--color-primary-ink); font-size: 14px; font-weight: 500;
      text-decoration: none; padding: var(--space-sm);
    }
    .link-btn:hover { text-decoration: underline; }
    .skel {
      display: block; height: 72px; border-radius: var(--rounded-lg); margin-bottom: var(--space-sm);
      background: color-mix(in srgb, var(--color-primary) 6%, var(--color-surface));
      position: relative; overflow: hidden;
    }
    .skel::after {
      content: ""; position: absolute; inset: 0;
      background: linear-gradient(100deg, transparent 32%, color-mix(in srgb, #fff 55%, transparent) 50%, transparent 68%);
      transform: translateX(-100%);
      animation: eo-skel 1.6s ease-in-out infinite;
    }
    @keyframes eo-skel { to { transform: translateX(100%); } }
    @media (prefers-reduced-motion: reduce) { .skel::after { animation: none; } }
  `],
})
export class EsimOrderPage implements OnInit {
  private readonly route = inject(ActivatedRoute);
  private readonly esimApi = inject(EsimApi);

  protected readonly order = signal<EsimOrder | null>(null);
  protected readonly notFound = signal(false);
  protected readonly qrData = signal<{ qr: string; iccid: string } | null>(null);
  protected readonly qrLoading = signal(false);
  protected readonly qrError = signal('');

  ngOnInit(): void {
    const id = this.route.snapshot.paramMap.get('id') ?? '';
    if (!id) {
      this.notFound.set(true);
      return;
    }
    this.esimApi.getOrder(id).subscribe({
      next: (r) => {
        this.order.set(r.order);
        // QR — сам товар: у выпущенной eSIM показываем его сразу, без кнопки
        // (просмотр аудитится бэком, лимит 10/мин — запрос один на заход).
        if (r.order?.status === 'issued') this.loadQr();
      },
      error: () => this.notFound.set(true),
    });
  }

  protected loadQr(): void {
    const esimId = this.order()?.issued_esim_id;
    if (!esimId || this.qrLoading()) return;
    this.qrLoading.set(true);
    this.qrError.set('');
    this.esimApi.qr(esimId).subscribe({
      next: (r) => { this.qrLoading.set(false); this.qrData.set(r); },
      error: (e) => {
        this.qrLoading.set(false);
        // Автозапрос: ошибку рисуем на месте QR, тостом при заходе на страницу
        // она читалась бы как сбой заказа.
        this.qrError.set(e?.error?.error?.message ?? 'QR-код ещё не готов.');
      },
    });
  }

  protected statusLabel(s: string): string {
    switch (s) {
      case 'pending_payment': return 'Ожидает оплаты';
      case 'pending_kyc': return 'Требуется верификация';
      case 'paid': return 'Выпускается';
      case 'issued': return 'Выпущена';
      case 'failed': return 'Ошибка';
      case 'refunded': return 'Возврат средств';
      case 'cancelled': return 'Отменён';
      default: return s;
    }
  }
  protected money(v: number, c: string): string { return formatAmount(v, c); }
  protected dateOf(iso: string): string {
    return new Date(iso).toLocaleString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  }
}
