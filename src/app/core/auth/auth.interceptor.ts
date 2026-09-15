import { HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { AuthService } from './auth.service';

export const authInterceptor: HttpInterceptorFn = (req, next) => {
  const auth = inject(AuthService);
  const headers: Record<string, string> = {};
  const initData = auth.initData();
  if (initData) headers['X-Telegram-Init-Data'] = initData;
  const token = auth.token();
  if (token) headers['Authorization'] = `Bearer ${token}`;
  if (Object.keys(headers).length > 0) {
    return next(req.clone({ setHeaders: headers }));
  }
  return next(req);
};
