import { Component, OnInit, PLATFORM_ID, inject } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { ActivatedRoute, Router } from '@angular/router';
import { AuthService } from '../../core/auth/auth.service';

// ReferralEntryPage — точка входа /r/:refCode: запоминает реф-код в
// localStorage и редиректит на /. Сюда ведёт опция «В браузере» попапа выпуска
// входа на лендинге (catcard-frontend LoginChannelDialog → attribution.appWebUrl
// строит {appUrl}/r/{ref}?utm_*). utm из query ловит AnalyticsService.captureUtm
// при bootstrap'е. isPlatformBrowser страхует от окружений без localStorage
// (например, Karma).
@Component({
  standalone: true,
  template: `<p style="padding: 32px; text-align:center;">Перенаправление...</p>`,
})
export class ReferralEntryPage implements OnInit {
  private readonly route = inject(ActivatedRoute);
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  private readonly platformId = inject(PLATFORM_ID);

  ngOnInit(): void {
    if (!isPlatformBrowser(this.platformId)) return;
    const code = this.route.snapshot.paramMap.get('refCode');
    if (code) this.auth.storeRef(code);
    this.router.navigate(['/']);
  }
}
