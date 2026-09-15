import { TestBed } from '@angular/core/testing';
import { BrandLogoService } from './brand-logo.service';
import { RuntimeConfigService } from './runtime-config.service';

const SVG = `<svg width="947" height="369" viewBox="0 0 947 369" fill="none" xmlns="http://www.w3.org/2000/svg">
  <path fill="#0C0C0C" d="M0 0h10v10H0z"/>
  <path fill="black" d="M20 0h10v10H20z"/>
  <path fill="#FFBA26" d="M40 0h10v10H40z"/>
  <script>window.pwned = true;</script>
</svg>`;

describe('BrandLogoService', () => {
  let fetchSpy: jasmine.Spy;

  function configure(logoUrl: string): BrandLogoService {
    TestBed.configureTestingModule({
      providers: [{ provide: RuntimeConfigService, useValue: { brand: { logo_url: logoUrl } } }],
    });
    return TestBed.inject(BrandLogoService);
  }

  function respond(body: string, type = 'image/svg+xml'): void {
    fetchSpy = spyOn(window, 'fetch').and.resolveTo(
      new Response(body, { status: 200, headers: { 'Content-Type': type } }),
    );
  }

  it('красит тёмные заливки в currentColor и не трогает акцент', async () => {
    respond(SVG);
    const svg = await configure('/assets/logo.svg').template();
    const fills = Array.from(svg!.querySelectorAll('path')).map((p) => p.getAttribute('fill'));
    expect(fills).toEqual(['currentColor', 'currentColor', '#FFBA26']);
  });

  it('вычищает скрипты и снимает собственные размеры', async () => {
    respond(SVG);
    const svg = await configure('/assets/logo.svg').template();
    expect(svg!.querySelector('script')).toBeNull();
    expect(svg!.hasAttribute('width')).toBeFalse();
    expect(svg!.getAttribute('viewBox')).toBe('0 0 947 369');
  });

  it('ходит за логотипом один раз на сессию', async () => {
    respond(SVG);
    const svc = configure('/assets/logo.svg');
    await Promise.all([svc.template(), svc.template()]);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('не-SVG отдаёт null — владелец рисует маску', async () => {
    respond('\x89PNG\r\n', 'image/png');
    expect(await configure('/assets/logo.png').template()).toBeNull();
  });

  it('упавший запрос отдаёт null, а не ломает экран', async () => {
    spyOn(window, 'fetch').and.rejectWith(new TypeError('network'));
    expect(await configure('/assets/logo.svg').template()).toBeNull();
  });
});
