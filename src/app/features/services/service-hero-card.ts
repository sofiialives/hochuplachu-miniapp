import { Component, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import { ServiceProduct } from '../../core/api/services.api';

@Component({
  selector: 'app-service-hero-card',
  standalone: true,
  imports: [RouterLink],
  template: `
    <a
      class="hero"
      [routerLink]="['/services', product().slug]"
      [class.hero--off]="product().disable_purchase"
    >
      <div class="hero-ico-wrap">
        @if (product().icon_url) {
          <img
            class="hero-ico"
            [src]="product().icon_url"
            [alt]="product().name"
            loading="lazy"
          />
        } @else {
          <span
            class="hero-ico hero-ico--stub"
            aria-hidden="true"
          >
            {{ product().name.charAt(0) }}
          </span>
        }
      </div>

      <span class="hero-body">
        <span class="hero-title">{{ product().name }}</span>
        <span class="hero-sub">{{ subtitle() }}</span>
      </span>

      <div class="hero-arr-container">
        <svg
          class="hero-arr"
          width="18"
          height="18"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
        >
          <path d="M9 6l6 6-6 6"></path>
        </svg>
      </div>
    </a>
  `,
  styles: [`
    :host {
      display: block;
      height: 100%;
    }

    .hero {
      height: 100%;
      display: flex;
      align-items: center;
      gap: var(--space-md);
      padding: 12px;
      border-radius: 24px;
      background: rgba(255, 245, 222, 1);
      box-shadow: 0px 25.67px 61.15px -21px rgba(0, 0, 0, 0.15);
      text-decoration: none;
      color: var(--color-ink);
      transition:
        transform var(--dur-quick) var(--ease-out),
        box-shadow var(--dur-quick) ease;
    }

    .hero:hover {
      transform: translateY(-2px);
      box-shadow: var(--shadow-card-hover);
    }

    .hero--off {
      opacity: .6;
      pointer-events: none;
    }

    .hero-ico-wrap {
      position: relative;
      width: 58px;
      height: 58px;
      flex: 0 0 58px;

      display: flex;
      align-items: center;
      justify-content: center;
    }

.hero-ico-wrap::before {
  content: "";
  position: absolute;
  inset: -6px;
  border-radius: 50%;
  padding: 0.96px;

  background: radial-gradient(
    123.9% 123.9% at 76.7% 63.64%,
    #FFBA26 0%,
    rgba(255, 186, 38, 0) 100%
  );

  -webkit-mask:
    linear-gradient(#fff 0 0) content-box,
    linear-gradient(#fff 0 0);
  -webkit-mask-composite: xor;

  mask:
    linear-gradient(#fff 0 0) content-box,
    linear-gradient(#fff 0 0);
  mask-composite: exclude;

  pointer-events: none;
}

    .hero-ico {
  position: relative;
  z-index: 1;

  width: 58px;
  height: 58px;
  border-radius: 50%;
  object-fit: cover;
}

    .hero-ico--stub {
      display: flex;
      align-items: center;
      justify-content: center;

      background: var(--color-surface);
      color: var(--color-primary-ink);
      font-family: var(--font-display);
      font-size: 24px;
      font-weight: 700;
    }

    .hero-body {
      flex: 1;
      min-width: 0;

      display: flex;
      flex-direction: column;
      gap: 2px;
    }

    .hero-title {
      font-family: 'Syncopate Cyr';
      text-transform: uppercase;
      font-size: 20px;
      line-height: 1;
    }

    .hero-sub {
      color: rgba(0, 0, 0, 1);
      font-size: 16px;
    }

    .hero-arr-container {
      display: inline-flex;
      align-items: center;
      justify-content: center;

      width: 44px;
      height: 44px;
      border-radius: 50%;

      background: rgba(255, 186, 38, 1);
      cursor: pointer;
      color: var(--color-ink);

      transition: transform .15s ease;
    }

    .hero-arr-container svg {
      width: 24px;
      height: 44px;
    }
  `],
})
export class ServiceHeroCard {
  readonly product = input.required<ServiceProduct>();

  protected subtitle(): string {
    switch (this.product().kind) {
      case 'account_topup':
        return 'Пополнение аккаунта';
      case 'subscription':
        return 'Подписка';
      default:
        return 'Гифткарта';
    }
  }
}