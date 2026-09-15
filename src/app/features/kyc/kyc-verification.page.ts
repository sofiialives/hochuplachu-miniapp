import { Component, OnDestroy, OnInit, PLATFORM_ID, computed, effect, inject, signal } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { ActivatedRoute, Router } from '@angular/router';
import { DomSanitizer, SafeResourceUrl } from '@angular/platform-browser';
import { TranslocoService } from '@jsverse/transloco';
import { BackBarComponent } from '../../ui/back-bar.component';
import { ButtonComponent } from '../../ui/button.component';
import { KycApi } from '../../core/api/kyc.api';
import { KycDetailsService } from './kyc-details.service';
import { ToastService } from '../../core/notifications/toast.service';
import { buildVerificationUrl, resolveActiveLang } from '../../shared/verification-url';

// /kyc/:sessionId — порт KycVerificationInnerComponent из coincat/frontend.
// Refresh-safe: при прямом заходе/F5 фронт стартует свой polling с нуля по
// path-параметру (10s, см. KycDetailsService). После status='Approved'
// появляется «Завершить» — дёргает /kyc/:id/finish и редиректит обратно
// на оплату нашего CardOrder.
@Component({
  selector: 'app-kyc-verification',
  standalone: true,
  imports: [BackBarComponent, ButtonComponent],
  template: `<app-back-bar />
    <section class="wrap">
      <h2>Верификация</h2>
      @if (kyc.kycSession(); as s) {
        @if (isApproved()) {
          <p class="msg">Верификация подтверждена. Нажмите «Завершить», чтобы продолжить оплату.</p>
          <div class="actions">
            <app-button variant="primary" [full]="true" [loading]="finishing()" [disabled]="finishing()" (click)="finish()">Завершить</app-button>
          </div>
        } @else if (safeUrl(); as src) {
          <div class="frame-wrap">
            <iframe
              [src]="src"
              class="frame"
              frameborder="0"
              allow="camera; microphone; fullscreen; autoplay; encrypted-media"></iframe>
          </div>
        }
      } @else {
        <p class="msg muted">Загрузка…</p>
      }
    </section>`,
  styles: [`
    .wrap { padding: var(--space-md); max-width: 720px; margin: 0 auto; }
    h2 { text-align: center; }
    .msg { text-align: center; margin: var(--space-md) 0; }
    .msg.muted { color: var(--color-muted); }
    .actions { display: flex; justify-content: center; margin-top: var(--space-md); }
    .actions app-button { width: 220px; }
    .frame-wrap {
      width: 100%;
      aspect-ratio: 3 / 4;
      max-height: 75vh;
      border-radius: var(--rounded-md);
      overflow: hidden;
      background: var(--color-surface-card);
      margin-bottom: var(--space-md);
    }
    .frame { width: 100%; height: 100%; border: 0; display: block; }
  `],
})
export class KycVerificationPage implements OnInit, OnDestroy {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly api = inject(KycApi);
  private readonly sanitizer = inject(DomSanitizer);
  private readonly transloco = inject(TranslocoService, { optional: true });
  private readonly toast = inject(ToastService);
  private readonly isBrowser = isPlatformBrowser(inject(PLATFORM_ID));

  protected readonly kyc = inject(KycDetailsService);
  protected readonly finishing = signal(false);

  // safeUrl — writable signal, проставляется ровно один раз при первом приходе
  // verificationUrl. Без этого пересоздание SafeResourceUrl на каждый тик
  // polling'а (10s) меняло бы [src] iframe и перезагружало его — теряя сессию
  // верификации SumSub. Идентично coincat/frontend KycVerificationInnerComponent.
  protected readonly safeUrl = signal<SafeResourceUrl | null>(null);

  protected readonly isApproved = computed(() => this.kyc.kycSession()?.status === 'Approved');

  constructor() {
    effect(() => {
      const session = this.kyc.kycSession();
      if (session?.verificationUrl && !this.safeUrl()) {
        const lang = resolveActiveLang(this.transloco, this.isBrowser);
        const url = buildVerificationUrl(session.verificationUrl, lang);
        this.safeUrl.set(this.sanitizer.bypassSecurityTrustResourceUrl(url));
      }
    });
  }

  ngOnInit(): void {
    const id = this.route.snapshot.paramMap.get('sessionId') ?? '';
    if (!id) {
      this.router.navigate(['/']);
      return;
    }
    this.kyc.fetchKycSession(id);
  }

  ngOnDestroy(): void { this.kyc.stopWatching(); }

  protected finish(): void {
    const id = this.route.snapshot.paramMap.get('sessionId') ?? '';
    if (!id || !this.isBrowser) return;
    this.finishing.set(true);
    this.api.finish(id).subscribe({
      next: (r) => {
        this.finishing.set(false);
        this.toast.success('Верификация завершена');
        if (r.owner_type === 'card_order' && r.owner_id) {
          this.router.navigate(['/orders', r.owner_id, 'payment']);
        } else if (r.owner_type === 'topup' && r.owner_id && r.card_id) {
          this.router.navigate(['/topup', r.card_id, 'payment', r.owner_id]);
        } else if (r.owner_type === 'renewal' && r.owner_id && r.card_id) {
          this.router.navigate(['/cards', r.card_id, 'extend-service', 'payment', r.owner_id]);
        } else if (r.owner_type === 'esim_order' && r.owner_id) {
          this.router.navigate(['/esim/orders', r.owner_id, 'payment']);
        } else if (r.owner_type === 'esim_recharge' && r.owner_id) {
          this.router.navigate(['/esim/recharges', r.owner_id, 'payment']);
        } else if (r.owner_type === 'service_order' && r.owner_id) {
          this.router.navigate(['/services/orders', r.owner_id, 'payment']);
        } else {
          this.router.navigate(['/']);
        }
      },
      error: (e) => {
        this.finishing.set(false);
        this.toast.error(e?.error?.error?.message ?? 'Не удалось завершить верификацию');
      },
    });
  }
}
