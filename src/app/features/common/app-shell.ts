import { Component, DestroyRef, OnInit, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { NavigationEnd, Router, RouterOutlet } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { filter } from 'rxjs/operators';
import { BottomNavComponent } from '../../ui/bottom-nav.component';
import { CardsApi } from '../../core/api/cards.api';
import { KycApi } from '../../core/api/kyc.api';
import { ReferralApi, ReferralInfo } from '../../core/api/referral.api';
import { AuthService } from '../../core/auth/auth.service';
import { RuntimeConfigService } from '../../core/config/runtime-config.service';
import { VerificationService } from '../../core/verification/verification.service';
import { EmailLinkDialog } from '../auth/email-link.dialog';
import { WelcomeBonusDialog } from '../auth/welcome-bonus.dialog';
import { BotPermissionDialog } from '../tg/bot-permission.dialog';

function routePath(url: string): string {
  return url.split('#')[0].split('?')[0];
}

function isProductDetailRoute(url: string): boolean {
  const segments = routePath(url).split('/').filter(Boolean);
  return segments.length === 2 && segments[0] === 'cards';
}

@Component({
  selector: 'app-app-shell',
  standalone: true,
  imports: [RouterOutlet, BottomNavComponent, EmailLinkDialog, WelcomeBonusDialog, BotPermissionDialog],
  template: `<div class="shell has-nav">
    <main><router-outlet /></main>
    <app-bottom-nav [hiddenMobile]="hideNavMobile()" />

    @if (needsEmailLink()) { <app-email-link-dialog (linked)="onLinked()" /> }
    @if (needsBotPerm()) { <app-bot-permission-dialog (dismissed)="onBotPermDismiss()" /> }
    @if (welcomeBonus(); as wb) {
      <app-welcome-bonus-dialog
        [amount]="wb.amount"
        [currency]="wb.currency"
        (dismissed)="onWelcomeDismissed()" />
    }
  </div>`,
  styles: [`
    .shell {
      display: flex; flex-direction: column; min-height: 100vh;
      
      --bottom-nav-h: 76px;
    }
    main { flex: 1; }
    
  `],
})
export class AppShell implements OnInit {
  private readonly cardsApi = inject(CardsApi);
  private readonly auth = inject(AuthService);
  private readonly refApi = inject(ReferralApi);
  private readonly kycApi = inject(KycApi);
  private readonly verification = inject(VerificationService);
  private readonly cfg = inject(RuntimeConfigService);
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);

  protected readonly isAuthed = this.auth.isAuthenticated;
  protected readonly needsEmailLink = signal(false);
  protected readonly needsBotPerm = signal(false);

  protected readonly welcomeBonus = signal<{ amount: number; currency: string } | null>(null);

  protected readonly hideNavMobile = signal(isProductDetailRoute(this.router.url));

  ngOnInit(): void {
    this.router.events.pipe(
      filter((e): e is NavigationEnd => e instanceof NavigationEnd),
      takeUntilDestroyed(this.destroyRef),
    ).subscribe((e) => {
      this.hideNavMobile.set(isProductDetailRoute(e.urlAfterRedirects || e.url));
    });

    if (!this.auth.isAuthenticated()) return;
    this.refreshCards();
    if (this.auth.isTelegram() && !this.auth.user()?.bot_can_write) {
      this.needsBotPerm.set(true);
    }

    this.router.events.pipe(
      filter((e): e is NavigationEnd => e instanceof NavigationEnd),

      filter((e) => ['/', '/cards'].includes(routePath(e.urlAfterRedirects || e.url))),
      takeUntilDestroyed(this.destroyRef),
    ).subscribe(() => this.refreshCards());

    if (routePath(this.router.url) === '/') void this.resumePendingKyc();
  }

  private async resumePendingKyc(): Promise<void> {
    try {
      const active = await firstValueFrom(this.kycApi.active());
      const id = active?.session_id;
      if (id) {
        const s = await firstValueFrom(this.kycApi.getStatus(id)).catch(() => null);
        if (s && s.status !== 'Expired' && s.status !== 'Abandoned') {

          if (routePath(this.router.url) !== '/') return;
          void this.router.navigate(['/kyc', id]);
          return;
        }
      }
    } catch {  }
    await this.resumeStrictVerification();
  }

  private async resumeStrictVerification(): Promise<void> {
    if (this.cfg.verificationMode !== 'strict') return;

    let s = this.verification.status();
    if (!s) {
      await this.verification.refresh();
      s = this.verification.status();
    }
    if (!s || s.mode !== 'strict' || s.all_ok) return;
    if (!s.checks['email']?.ok || !s.checks['phone']?.ok) return;
    if (routePath(this.router.url) !== '/') return;
    void this.router.navigate(['/verification']);
  }

  private refreshCards(): void {
    this.cardsApi.myCards().subscribe({
      next: (res) => {
        const cards = res?.cards ?? [];
        const u = this.auth.user();
        if (u && cards.length > 0 && !u.email_linked) this.needsEmailLink.set(true);

        if (cards.length > 0) this.maybeShowWelcomeBonus();
      },
      error: (err) => console.error('myCards failed', err),
    });
  }

  private maybeShowWelcomeBonus(): void {

    if (this.welcomeBonus()) return;
    const u = this.auth.user();
    if (!u) return;
    if (!u.referred_by_id) return;
    if (u.referral_welcome_seen_at) return;
    if (u.referral_bonus_applied) return;
    this.refApi.info().subscribe({
      next: (info: ReferralInfo) => {
        if (info.bonus_available > 0) {
          this.welcomeBonus.set({ amount: info.bonus_available, currency: info.referee_bonus.currency });
          return;
        }

        const structuralZero = info.bonus_available === 0 &&
          (info.referee_bonus.amount > 0 || u.referral_type === 'partner');
        if (structuralZero) {
          this.refApi.dismissWelcome().subscribe({ error: () => {  } });
          const cur = this.auth.user();
          if (cur) {
            this.auth.user.set({ ...cur, referral_welcome_seen_at: new Date().toISOString() });
          }
        }
      },
      error: () => {},
    });
  }

  onLinked(): void { this.needsEmailLink.set(false); }
  onBotPermDismiss(): void { this.needsBotPerm.set(false); }
  onWelcomeDismissed(): void {
    this.welcomeBonus.set(null);

    const u = this.auth.user();
    if (u) {
      this.auth.user.set({ ...u, referral_welcome_seen_at: new Date().toISOString() });
    }
  }
}