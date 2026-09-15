import { HttpInterceptorFn, HttpErrorResponse } from '@angular/common/http';
import { inject } from '@angular/core';
import { Router } from '@angular/router';
import { catchError, throwError } from 'rxjs';
import { AuthService } from '../auth/auth.service';

export const errorInterceptor: HttpInterceptorFn = (req, next) => {
  const auth = inject(AuthService);
  const router = inject(Router);

  return next(req).pipe(
    catchError((err: HttpErrorResponse) => {
      const body = err.error as { error?: { code?: string; message?: string; payload?: Record<string, unknown> } } | undefined;
      const code = body?.error?.code;

      // ORDER_NEEDS_KYC_VERIFICATION — coincat прислал готовый sessionId в payload.
      // Уходим на /kyc/:id — там KycDetailsService подхватит polling, а юзер
      // может рефрешить страницу без потери контекста.
      if (code === 'ORDER_NEEDS_KYC_VERIFICATION' || code === 'CARD_NEEDS_KYC') {
        const p = body?.error?.payload ?? {};
        const id =
          (p['vendorData'] as string | undefined) ??
          (p['sessionId'] as string | undefined) ??
          (p['kycSessionId'] as string | undefined);
        if (id) router.navigate(['/kyc', id]);
      }
      if (err.status === 401) {
        auth.logout();
        if (!req.url.includes('/auth/')) router.navigate(['/login']);
      }
      // LOGIN_BLOCKED — администратор заблокировал аккаунт. Чистим локальный
      // токен/initData кеш (через logout) и отправляем на /login. Сообщение
      // об ошибке всё равно дойдёт до места вызова и будет показано тостом.
      if (code === 'LOGIN_BLOCKED') {
        auth.logout();
        if (!req.url.includes('/auth/')) router.navigate(['/login']);
      }
      return throwError(() => err);
    }),
  );
};
