import { Component, OnInit, inject, output, signal } from '@angular/core';
import { ReferralApi } from '../../core/api/referral.api';
import { AuthService } from '../../core/auth/auth.service';
import { formatReferralAmount } from '../../core/referral/referral-format';

// ReferralBanner — баннер «X вам, Y другу» с динамическими суммами из
// публичного ReferralConfig. Если бэк недоступен — рендерится дефолт
// «$10 вам, $5 другу» как seed-значения, чтобы баннер не пропадал.
//
// Партнёру (referral_type='partner') суммы берём из авторизованного
// /referral/info: вознаграждение там — его персональная партнёрская ставка,
// а referee_bonus=0 (приглашённым партнёром welcome-бонус не даётся —
// привлечение промокодами), поэтому «Y другу» не обещаем. Для обычных юзеров
// остаётся дешёвый публичный конфиг без лишней нагрузки на /referral/info.
@Component({
  selector: 'app-referral-banner',
  standalone: true,
  template: `<button class="banner" (click)="clicked.emit()">
  <div class="icon-wrap">
    <svg xmlns="http://www.w3.org/2000/svg" width="25" height="25" viewBox="0 0 25 25" fill="none">
    <path fill-rule="evenodd" clip-rule="evenodd" d="M9.89518 5.20833V11.4583H17.1868V15.1042L23.9577 8.33333L17.1868 1.5625V5.20833H9.89518ZM7.81185 13.5417H15.1035V19.7917H7.81185V23.4375L1.04102 16.6667L7.81185 9.89583V13.5417Z" fill="#FFBA26"/>
    </svg>
  </div>
    <span class="text"><b>{{ headline() }}!</b><br>Приглашайте друзей и получайте бонусы</span>
    <span class="arrow">›</span>
  </button>`,
  styles: [`
    /* display:block на хосте — по умолчанию хост кастомного элемента
       inline, что мешало ему корректно растягиваться до высоты соседа в
       родительском flex-ряду (.top-row на главной, align-items:stretch).
       height:100% — сам хост занимает всю выданную родителем высоту. */
    /* display:flex (не просто block) — .banner внутри растягивается по
       flex-механике родителя-хоста, а не через height:100%, которая
       через лишний уровень вложенности (host → button) почему-то не
       добиралась до нужного результата. */
    /* БЕЗ явной height:100% на хосте — она могла мешать align-items:
       stretch родителя (.top-row) сработать: stretch растягивает
       flex-item только если его собственная cross-axis высота auto,
       а явный height:100% (даже резолвящийся в auto при неопределённой
       высоте родителя) в некоторых браузерах всё равно "отключает" эту
       механику. Просто display:flex — сам stretch от родителя даёт
       host нужную высоту, а .banner (flex:1) заполняет её целиком. */
    :host { display: flex; }
    .banner {
      width: 100%; flex: 1;
      display: flex; align-items: center; gap: 24px;
      padding: 18px 22px;
      background: var(--color-surface);
      border: 1px solid transparent;
      border-radius: var(--rounded-lg);
      box-shadow: var(--shadow-card);
      text-decoration: none; color: var(--color-ink); text-align: left;
      transition: background var(--dur-quick) ease, border-color var(--dur-quick) ease, transform var(--dur-quick) var(--ease-out), box-shadow var(--dur-quick) ease;
    }

    .banner:hover { background: var(--color-surface); border-color: var(--color-primary); transform: translateY(-1px); box-shadow: var(--shadow-card-hover); }
    .banner.muted { opacity: .55; pointer-events: none; }

    .icon-wrap {
  position: relative;
  width: 25px;
  height: 25px;
  flex: 0 0 25px;

  display: flex;
  align-items: center;
  justify-content: center;
}

.icon-wrap svg {
  width: 25px;
  height: 25px;
  display: block;
  position: relative;
  z-index: 1;
}
.icon-wrap::before {
  content: "";
  position: absolute;
  inset: -8.4px;
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
    .text { flex: 1; font-size: 15px; line-height: 1.25; }
    .text b { font-weight: 600; font-size: 20px }
    .text span { color: rgba(0, 0, 0, 1); }
    .arrow { color: var(--color-muted); font-size: 36px; }
  `],
})
export class ReferralBanner implements OnInit {
  private readonly api = inject(ReferralApi);
  private readonly auth = inject(AuthService);
  readonly clicked = output<void>();

  protected readonly headline = signal('$10 вам, $5 другу');

  ngOnInit(): void {
    if (this.auth.user()?.referral_type === 'partner') {
      this.api.info().subscribe({
        next: (i) => this.setHeadline(i.reward.amount, i.reward.currency, i.referee_bonus.amount),
        error: () => this.headline.set('Вознаграждение за каждого друга'),
      });
      return;
    }
    this.api.config().subscribe({
      next: (cfg) => this.setHeadline(cfg.referrer_reward, cfg.currency, cfg.referee_bonus),
      error: () => { /* оставляем seed-headline */ },
    });
  }

  private setHeadline(rewardAmount: number, rewardCurrency: string, refereeBonus: number): void {
    const reward = formatReferralAmount(rewardAmount, rewardCurrency);
    if (refereeBonus > 0) {
      const friend = formatReferralAmount(refereeBonus, rewardCurrency);
      this.headline.set(`${reward} вам, ${friend} другу`);
    } else {
      this.headline.set(`${reward} вам за каждого друга`);
    }
  }
}