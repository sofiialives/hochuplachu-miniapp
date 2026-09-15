import { Component, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import { ServiceProduct } from '../../core/api/services.api';

// ServiceHeroCard — сервис, вынесенный из сетки ОТДЕЛЬНЫМ блоком (решение
// оператора: пополнение Steam — главный сервис каталога, и в общей сетке из
// шестисот плиток его искали глазами наравне с остальными).
//
// Компонент общий для главной и «/services»: блок обязан выглядеть и вести
// себя одинаково в обоих местах, а два независимых куска вёрстки разъехались
// бы на первой же правке.
//
// .hero НЕ унифицирован с .card/.svc-card — свой собственный стиль (мягкий
// primary-градиент), цвет и обводка у него отличаются намеренно.
@Component({
  selector: 'app-service-hero-card',
  standalone: true,
  imports: [RouterLink],
  template: `<a class="hero" [routerLink]="['/services', product().slug]" [class.hero--off]="product().disable_purchase">
    @if (product().icon_url) {
      <img class="hero-ico" [src]="product().icon_url" [alt]="product().name" loading="lazy" />
    } @else {
      <span class="hero-ico hero-ico--stub" aria-hidden="true">{{ product().name.charAt(0) }}</span>
    }
    <span class="hero-body">
      <span class="hero-title">{{ product().name }}</span>
      <span class="hero-sub">{{ subtitle() }}</span>
    </span>
    <span class="hero-arr" aria-hidden="true">→</span>
  </a>`,
  styles: [`
    /* display:block + height:100% на хосте — та же причина, что и в
       ReferralBanner: по умолчанию хост кастомного элемента inline, и
       без явной высоты видимая карточка не заполняет то, что ей выдал
       родительский flex-ряд (align-items:stretch) на десктопе — сосед
       (обычно другая .hero-карточка рядом) оказывается выше/ниже. */
    :host { display: block; height: 100%; }
    .hero {
      height: 100%;
      display: flex; align-items: center; gap: var(--space-md);
      padding: var(--space-md);
      border-radius: var(--rounded-xl);
      background:
        radial-gradient(circle at top right, color-mix(in srgb, var(--color-primary) 20%, transparent), transparent 60%),
        var(--color-primary-soft);
      border: 1px solid color-mix(in srgb, var(--color-primary) 24%, var(--color-hairline-soft));
      box-shadow: var(--shadow-card);
      text-decoration: none; color: var(--color-ink);
      transition: transform var(--dur-quick) var(--ease-out), box-shadow var(--dur-quick) ease;
    }
    .hero:hover { transform: translateY(-2px); box-shadow: var(--shadow-card-hover); }
    .hero--off { opacity: .6; pointer-events: none; }
    .hero-ico { width: 56px; height: 56px; border-radius: 16px; object-fit: contain; flex: 0 0 auto; }
    .hero-ico--stub {
      display: flex; align-items: center; justify-content: center;
      background: var(--color-surface); color: var(--color-primary-ink);
      font-family: var(--font-display); font-size: 24px; font-weight: 700;
    }
    .hero-body { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; }
    .hero-title { font-family: var(--font-display); font-size: 20px; font-weight: 700; line-height: 1.2; }
    .hero-sub { color: var(--color-muted); font-size: 14px; }
    .hero-arr { color: var(--color-muted); font-size: 22px; }
    /* <375px — та же логика, что у .hero--promo на главной: иконка
       (56px) + текст + стрелка в один ряд на узком экране оставляют
       .hero-body слишком мало места, название сервиса переносится по
       одному слову. Уменьшаем иконку и шрифты вместо смены раскладки —
       тут нет отдельной кнопки, которую нужно уводить на новую строку,
       достаточно ужать сами элементы. */
    @media (max-width: 374px) {
      .hero { gap: 10px; padding: 12px; }
      .hero-ico { width: 44px; height: 44px; border-radius: 12px; }
      .hero-title { font-size: 16px; }
      .hero-sub { font-size: 12px; }
      .hero-arr { font-size: 18px; }
    }
  `],
})
export class ServiceHeroCard {
  readonly product = input.required<ServiceProduct>();

  /** Подпись под названием: у пополнения — что именно делает сервис, у
   *  гифткарты и подписки — вид товара. */
  protected subtitle(): string {
    switch (this.product().kind) {
      case 'account_topup': return 'Пополнение аккаунта';
      case 'subscription': return 'Подписка';
      default: return 'Гифткарта';
    }
  }
}