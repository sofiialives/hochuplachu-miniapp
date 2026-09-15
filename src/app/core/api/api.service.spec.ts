import { TestBed } from '@angular/core/testing';
import { provideZonelessChangeDetection } from '@angular/core';
import { HttpErrorResponse, provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ApiService, SLOW_REQUEST_TIMEOUT_MS } from './api.service';
import { RuntimeConfigService } from '../config/runtime-config.service';
import { extractApiError } from '../errors/api-error';

describe('ApiService', () => {
  let api: ApiService;
  let httpMock: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideZonelessChangeDetection(),
        provideHttpClient(),
        provideHttpClientTesting(),
        // ApiService читает только config.apiBaseUrl — полный сервис не нужен.
        { provide: RuntimeConfigService, useValue: { config: { apiBaseUrl: '/api/v1' } } },
      ],
    });
    api = TestBed.inject(ApiService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => httpMock.verify());

  it('postMultipart отправляет FormData как есть: файл в теле, Content-Type ставит браузер', async () => {
    const file = new File(['%PDF-1.4 fake-binary \x00\x01\x02'], 'bill.pdf', { type: 'application/pdf' });
    const fd = new FormData();
    fd.append('file', file, file.name);

    let result: { ok: boolean } | undefined;
    api.postMultipart<{ ok: boolean }>('/orders/42/bill', fd).subscribe((r) => (result = r));

    const req = httpMock.expectOne('/api/v1/orders/42/bill');
    expect(req.request.method).toBe('POST');
    // Тело — тот же объект FormData, без сериализации/копирования.
    expect(req.request.body).toBe(fd);
    // FormData.append(file, name) создаёт File-обёртку — сравниваем не ссылку,
    // а имя/тип/байты содержимого.
    const sent = (req.request.body as FormData).get('file') as File;
    expect(sent.name).toBe('bill.pdf');
    expect(sent.type).toBe('application/pdf');
    expect(sent.size).toBe(file.size);
    expect(await sent.text()).toBe(await file.text());
    // Content-Type не выставлен вручную — иначе браузер не добавит boundary
    // и бэкенд не распарсит multipart.
    expect(req.request.headers.has('Content-Type')).toBeFalse();

    req.flush({ ok: true, data: { ok: true } });
    expect(result).toEqual({ ok: true });
  });

  it('post разворачивает конверт {ok, data}', () => {
    let result: { sent: boolean } | undefined;
    api.post<{ sent: boolean }>('/auth/email/request', { email: 'a@b.c' }).subscribe((r) => (result = r));

    const req = httpMock.expectOne('/api/v1/auth/email/request');
    expect(req.request.body).toEqual({ email: 'a@b.c' });
    req.flush({ ok: true, data: { sent: true } });
    expect(result).toEqual({ sent: true });
  });

  // jasmine.clock вместо fakeAsync: приложение zoneless, zone.js/testing
  // не подключён. rxjs timeout сидит на глобальном setInterval — clock его
  // патчит, tick() промотает срабатывание.
  it('молчащий сервер: postMultipart падает TIMEOUT-ошибкой и абортит запрос', () => {
    jasmine.clock().install();
    try {
      const fd = new FormData();
      fd.append('file', new File(['x'], 'bill.pdf'), 'bill.pdf');

      let error: unknown;
      api.postMultipart('/orders/42/bill', fd).subscribe({
        next: () => fail('не должно быть next'),
        error: (e: unknown) => (error = e),
      });

      const req = httpMock.expectOne('/api/v1/orders/42/bill');
      jasmine.clock().tick(SLOW_REQUEST_TIMEOUT_MS + 1);

      expect(error).toBeInstanceOf(HttpErrorResponse);
      expect(extractApiError(error).code).toBe('TIMEOUT');
      // Underlying-запрос отменён — «зомби» не висит.
      expect(req.cancelled).toBeTrue();
    } finally {
      jasmine.clock().uninstall();
    }
  });
});
