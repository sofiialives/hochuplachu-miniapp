import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Route } from '@angular/router';
import { firstValueFrom, of } from 'rxjs';
import { AuthService } from '../auth/auth.service';
import { SectionPreloadStrategy } from './section-preload.strategy';

describe('SectionPreloadStrategy', () => {
  const authenticated = signal(false);
  let strategy: SectionPreloadStrategy;

  beforeEach(() => {
    authenticated.set(false);
    TestBed.configureTestingModule({
      providers: [{ provide: AuthService, useValue: { isAuthenticated: authenticated } }],
    });
    strategy = TestBed.inject(SectionPreloadStrategy);
  });

  /** Зовёт стратегию и говорит, дошло ли дело до реальной загрузки чанка. */
  async function preloaded(route: Route): Promise<boolean> {
    let loaded = false;
    await firstValueFrom(strategy.preload(route, () => {
      loaded = true;
      return of('chunk');
    }));
    return loaded;
  }

  it('роут без флага preload не трогает', async () => {
    expect(await preloaded({ path: 'admin' })).toBeFalse();
  });

  it('помеченный роут тянет', async () => {
    expect(await preloaded({ path: 'esim', data: { preload: true } })).toBeTrue();
  });

  it('роут под canMatch гостю не тянет — чанк был бы скачан впустую', async () => {
    expect(await preloaded({ path: 'profile', canMatch: [() => true], data: { preload: true } })).toBeFalse();
  });

  it('роут под canMatch авторизованному тянет', async () => {
    authenticated.set(true);
    expect(await preloaded({ path: 'profile', canMatch: [() => true], data: { preload: true } })).toBeTrue();
  });
});
