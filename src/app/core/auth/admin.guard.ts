import { CanMatchFn, Router } from '@angular/router';
import { PLATFORM_ID, inject } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { AuthService } from './auth.service';

export const adminGuard: CanMatchFn = () => {
  if (!isPlatformBrowser(inject(PLATFORM_ID))) return true;
  const auth = inject(AuthService);
  const router = inject(Router);
  if (auth.isStaff()) return true;
  return router.createUrlTree(['/']);
};

/** Разделы только для role=admin: карты-продукты, промокоды, партнёры,
 *  реф-программа (модератору backend отвечает 403, меню их прячет).
 *  Модератора по прямому URL уводим на «Выпущенные карты» — первый доступный
 *  ему раздел. Bootstrap к этому моменту завершён: children матчатся после
 *  родительского /admin, чей authGuard его дожидается. */
export const adminOnlyGuard: CanMatchFn = () => {
  if (!isPlatformBrowser(inject(PLATFORM_ID))) return true;
  const auth = inject(AuthService);
  const router = inject(Router);
  if (auth.user()?.role === 'admin') return true;
  return router.createUrlTree(['/admin/cards']);
};
