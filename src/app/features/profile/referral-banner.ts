import { Component, OnInit, inject, input, output, signal } from '@angular/core';
import { ReferralApi } from '../../core/api/referral.api';
import { AuthService } from '../../core/auth/auth.service';
import { formatReferralAmount } from '../../core/referral/referral-format';

@Component({
  selector: 'app-referral-banner',
  standalone: true,
  template: `
    <button
      class="banner"
      [class.stacked]="stacked()"
      (click)="clicked.emit()"
    >
      <div class="banner-content">
        <div class="icon-wrap">
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="25"
            height="25"
            viewBox="0 0 25 25"
            fill="none"
          >
            <path
              fill-rule="evenodd"
              clip-rule="evenodd"
              d="M9.89518 5.20833V11.4583H17.1868V15.1042L23.9577 8.33333L17.1868 1.5625V5.20833H9.89518ZM7.81185 13.5417H15.1035V19.7917H7.81185V23.4375L1.04102 16.6667L7.81185 9.89583V13.5417Z"
              fill="#FFBA26"
            />
          </svg>
        </div>

        <span class="text">
          <b>{{ headline() }}!</b><br>
          Приглашайте друзей и получайте бонусы
        </span>
      </div>

      <span class="arrow">›</span>
    </button>
  `,
  styles: [`
    :host {
      display: block;
    }

    .banner {
      width: 100%;
      height: 100%;
      display: flex;
      align-items: center;
      gap: 14px;
      padding: 14px 16px;
      background: var(--color-surface);
      border: 1px solid transparent;
      border-radius: var(--rounded-lg);
      box-shadow: var(--shadow-card);
      text-decoration: none;
      color: var(--color-ink);
      text-align: left;
      transition:
        background var(--dur-quick) ease,
        border-color var(--dur-quick) ease,
        transform var(--dur-quick) var(--ease-out),
        box-shadow var(--dur-quick) ease;
    }

    .banner:hover {
      background: var(--color-surface);
      border-color: var(--color-primary);
      transform: translateY(-1px);
      box-shadow: var(--shadow-card-hover);
    }

    .banner.muted {
      opacity: .55;
      pointer-events: none;
    }

    .banner-content {
      display: flex;
      align-items: center;
      gap: 14px;
      flex: 1;
      min-width: 0;
    }

    .icon-wrap {
      position: relative;
      width: 22px;
      height: 22px;
      flex: 0 0 22px;

      display: flex;
      align-items: center;
      justify-content: center;
    }

    .icon-wrap svg {
      width: 22px;
      height: 22px;
      display: block;
      position: relative;
      z-index: 1;
    }

    .icon-wrap::before {
      content: "";
      position: absolute;
      inset: -7px;
      border-radius: 50%;
      padding: 2.4px;
      background: radial-gradient(
        147.58% 147.58% at 53.03% 53.33%,
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

    .text {
      flex: 1;
      font-size: 13px;
      line-height: 1.25;
    }

    .text b {
      font-weight: 600;
      font-size: 16px;
    }

    .text span {
      color: rgba(0, 0, 0, 1);
    }

    .arrow {
      flex: 0 0 auto;
      color: var(--color-muted);
      font-size: 26px;
    }

    @media (min-width: 1024px) {
      .banner.stacked {
        position: relative;
      }

      .banner.stacked .banner-content {
        flex-direction: column;
        align-items: flex-start;
        gap: 10px;
      }

      .banner.stacked .text {
        flex: none;
      }

      /*
       * На десктопе в stacked-варианте (профиль/главная в колонку)
       * иконка со свечением визуально мельче остального контента —
       * увеличиваем сам символ до 32×32 и круг-подсветку вокруг него
       * до 60×60 (было 22×22 / 36×36, см. .icon-wrap выше). Инсет
       * ::before пересчитан под новый размер: (60-32)/2 = 14px.
       */
      .banner.stacked .icon-wrap {
        width: 32px;
        height: 32px;
        flex: 0 0 32px;
      }

      .banner.stacked .icon-wrap svg {
        width: 32px;
        height: 32px;
      }

      .banner.stacked .icon-wrap::before {
        inset: -9px;
      }

      .banner.stacked .arrow {
        position: absolute;
        right: 16px;
        top: 50%;
        transform: translateY(-50%);
      }
    }
  `],
})
export class ReferralBanner implements OnInit {
  private readonly api = inject(ReferralApi);
  private readonly auth = inject(AuthService);

  readonly clicked = output<void>();
  readonly stacked = input(false);

  protected readonly headline = signal('$10 вам, $5 другу');

  ngOnInit(): void {
    if (this.auth.user()?.referral_type === 'partner') {
      this.api.info().subscribe({
        next: (i) =>
          this.setHeadline(
            i.reward.amount,
            i.reward.currency,
            i.referee_bonus.amount
          ),
        error: () =>
          this.headline.set('Вознаграждение за каждого друга'),
      });

      return;
    }

    this.api.config().subscribe({
      next: (cfg) =>
        this.setHeadline(
          cfg.referrer_reward,
          cfg.currency,
          cfg.referee_bonus
        ),
      error: () => {},
    });
  }

  private setHeadline(
    rewardAmount: number,
    rewardCurrency: string,
    refereeBonus: number
  ): void {
    const reward = formatReferralAmount(rewardAmount, rewardCurrency);

    if (refereeBonus > 0) {
      const friend = formatReferralAmount(
        refereeBonus,
        rewardCurrency
      );

      this.headline.set(`${reward} вам, ${friend} другу`);
    } else {
      this.headline.set(`${reward} вам за каждого друга`);
    }
  }
}