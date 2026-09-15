import { CanMatchFn, Router, UrlSegment } from '@angular/router';
import { PLATFORM_ID, inject } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { AuthService } from './auth.service';

export const authGuard: CanMatchFn = async (_route, segments: UrlSegment[]) => {
  if (!isPlatformBrowser(inject(PLATFORM_ID))) return true;
  const auth = inject(AuthService);
  const router = inject(Router);

  if (!auth.bootstrapped()) {
    await auth.bootstrap();
  }
  if (auth.isAuthenticated()) return true;
  const returnUrl = '/' + segments.map((s) => s.path).join('/');
  return router.createUrlTree(['/login'], { queryParams: { return: returnUrl } });
};
