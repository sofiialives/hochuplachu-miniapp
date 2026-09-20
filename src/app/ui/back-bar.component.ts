import { Component, computed, inject, input } from '@angular/core';
import { BrandLogoComponent } from './brand-logo.component';
import { Location } from '@angular/common';
import { RuntimeConfigService } from '../core/config/runtime-config.service';
import { AuthService } from '../core/auth/auth.service';

@Component({
  selector: 'app-back-bar',
  standalone: true,
  imports: [BrandLogoComponent],
  template: `<header class="bar">
    @if (effectiveShowBack()) {
      <button class="back" (click)="back()" aria-label="Назад">
        <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
          <path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" d="M15 6l-6 6 6 6"/>
        </svg>
        <span>Назад</span>
      </button>
    }
    <a class="brand" href="/" aria-label="На главную">
      @if (tintColor()) {
        <app-brand-logo class="brand-tint" [label]="serviceName" [ink]="tintColor()!" />
      } @else {
        <img [src]="logoUrl" [alt]="serviceName" />
      }
    </a>
  </header>`,
  styles: [`
    
    
    .bar {
      position: relative;
      display: flex; align-items: center; justify-content: center;
      box-sizing: border-box;

      padding: 52px 16px 24px;
      min-height: calc(
        max(var(--tg-safe-area-inset-top, 0px), env(safe-area-inset-top, 0px))
        + var(--tg-content-safe-area-inset-top, 72px)
      );
      background: transparent;
      max-width: 1200px; margin: 0 auto; width: 100%;
    }
    /*
     * .back вынута из потока (position:absolute), чтобы .brand всегда была
     * ровно по центру .bar, независимо от того, есть кнопка "Назад" или нет
     * и какой у неё текст/ширина. Контейнером позиционирования для
     * position:absolute служит padding-box родителя (.bar), а не его
     * содержимое — то есть left отсчитывается от САМОГО края .bar, а не от
     * края внутри её padding. Поэтому left задаём равным padding у .bar
     * (16px на мобилке, 120px на десктопе), а не 0 — иначе кнопка вылезала
     * бы вплотную к краю экрана мимо контейнера.
     */
    .back {
      position: absolute;
      left: 16px;
      top: 50%;
      transform: translateY(-50%);
      display: inline-flex; align-items: center; gap: 4px;

      padding: 8px 14px 8px 4px; border-radius: var(--rounded-pill);
      background: var(--color-surface-card); color: var(--color-ink);
      font-weight: 500; font-size: 14px;
    }
    .back:hover { background: var(--color-surface-soft, var(--color-surface-card)); }
  .brand {
  display: inline-flex;
  align-items: center;
}

.brand img,
.brand .brand-tint {
  width: 104px;
  height: 48px;
  display: block;
  object-fit: contain;
}

@media (min-width: 1024px) {
  .brand img,
  .brand .brand-tint {
    width: 168px;
  }

  .bar {
    padding: 52px 120px 68px;
  }

  .back {
    left: 120px;
  }
}
  `],
})
export class BackBarComponent {
  private readonly location = inject(Location);
  private readonly cfg = inject(RuntimeConfigService);
  private readonly auth = inject(AuthService);
  readonly showBack = input<boolean>(true);
  readonly tintColor = input<string | null>(null);
  protected readonly effectiveShowBack = computed(() => this.showBack() && !this.auth.isTelegramMobile());
  protected readonly logoUrl = this.cfg.brand.logo_url;
  protected readonly serviceName = this.cfg.brand.service_name;
  back(): void { this.location.back(); }
}