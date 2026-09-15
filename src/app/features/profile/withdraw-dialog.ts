import { Component, OnInit, computed, inject, input, output, signal } from '@angular/core';
import { Router } from '@angular/router';
import { DialogComponent } from '../../ui/dialog.component';
import { ButtonComponent } from '../../ui/button.component';
import { CardsApi, CardProduct, UserCard } from '../../core/api/cards.api';
import { ReferralApi } from '../../core/api/referral.api';
import { ToastService } from '../../core/notifications/toast.service';
import { errorMessage } from '../../core/errors/api-error';
import { formatReferralAmount } from '../../core/referral/referral-format';

// WithdrawDialog — выбор карты, на которую зачислить накопленные pending-выплаты.
// На вход родителем передаются amount/currency — то, что показано на кнопке
// «Вывести N» в реф-диалоге. После успеха — редирект на success-страницу
// пополнения (та же, что после обычного topup): /topup/:cardId/payment/:topupId.
//
// Карты фильтруются по: status=='active' и card_product.card_currency==currency.
// Если подходящих карт нет — диалог показывает понятный текст «нет карты в этой
// валюте» (выпускать карту прямо отсюда сейчас не предлагаем — слишком много
// побочных потоков).
@Component({
  selector: 'app-withdraw-dialog',
  standalone: true,
  imports: [DialogComponent, ButtonComponent],
  template: `<app-dialog title="Вывод на карту" (dismissed)="dismissed.emit()">
    <p class="hint">К зачислению: <b>{{ amountLabel() }}</b></p>

    @if (loadingCards()) {
      <p class="muted">Загрузка карт…</p>
    } @else if (eligible().length === 0) {
      <p class="muted">У вас нет активной карты в валюте {{ currency() }}. Выпустите карту в этой валюте, чтобы вывести начисления.</p>
    } @else {
      <ul class="cards">
        @for (c of eligible(); track c.card.id) {
          <li>
            <label>
              <input type="radio" name="card" [value]="c.card.id" [checked]="selectedId() === c.card.id" (change)="selectedId.set(c.card.id)" />
              <span class="card-text">
                <b>{{ c.product?.name ?? 'Карта' }}</b>
                <span class="muted">•••• {{ c.card.last4 }} · {{ c.product?.card_currency ?? '' }}</span>
              </span>
            </label>
          </li>
        }
      </ul>
      <app-button variant="primary" [full]="true" [loading]="submitting()" [disabled]="!selectedId() || submitting()" (clicked)="submit()">
        Зачислить {{ amountLabel() }}
      </app-button>
    }
  </app-dialog>`,
  styles: [`
    .hint { color: var(--color-body); margin: 0 0 var(--space-md); }
    .muted { color: var(--color-muted); font-size: 14px; }
    .cards { list-style: none; padding: 0; margin: 0 0 var(--space-md); display: flex; flex-direction: column; gap: 8px; }
    .cards label {
      display: flex; align-items: center; gap: 12px;
      padding: 12px;
      border: 1px solid var(--color-hairline);
      border-radius: var(--rounded-md);
      cursor: pointer;
    }
    .cards label:has(input:checked) { border-color: var(--color-primary); background: color-mix(in srgb, var(--color-primary) 6%, transparent); }
    .card-text { display: flex; flex-direction: column; gap: 2px; }
    .card-text .muted { font-size: 13px; }
    input[type="radio"] { accent-color: var(--color-primary); }
  `],
})
export class WithdrawDialog implements OnInit {
  private readonly cardsApi = inject(CardsApi);
  private readonly refApi = inject(ReferralApi);
  private readonly toast = inject(ToastService);
  private readonly router = inject(Router);

  readonly amount = input.required<number>();
  readonly currency = input.required<string>();
  readonly dismissed = output<void>();
  readonly success = output<void>();

  protected readonly loadingCards = signal(true);
  protected readonly submitting = signal(false);
  protected readonly cards = signal<UserCard[]>([]);
  protected readonly products = signal<Record<string, CardProduct>>({});
  protected readonly selectedId = signal<string>('');

  // eligible — карты, на которые можно вывести: active + currency совпадает.
  protected readonly eligible = computed<{ card: UserCard; product?: CardProduct }[]>(() => {
    const cur = (this.currency() || '').toUpperCase();
    const map = this.products();
    return this.cards()
      .filter((c) => c.status === 'active')
      .map((c) => ({ card: c, product: map[c.card_product_id] }))
      .filter((row) => (row.product?.card_currency || '').toUpperCase() === cur);
  });

  protected amountLabel(): string {
    return formatReferralAmount(this.amount(), this.currency());
  }

  ngOnInit(): void {
    // myCards возвращает уже-загруженный кеш мгновенно (через tap) + свежий
    // запрос. listProducts нужен, чтобы получить card_currency по card_product_id.
    this.cardsApi.myCards().subscribe({
      next: (r) => this.cards.set(r?.cards ?? []),
      error: () => { /* фильтр всё равно отработает (пустой массив) */ },
    });
    this.cardsApi.listProducts().subscribe({
      next: (r) => {
        const map: Record<string, CardProduct> = {};
        for (const p of r.products) map[p.id] = p;
        this.products.set(map);
        this.loadingCards.set(false);
        // Если карта единственная — пред-выберем её.
        const e = this.eligible();
        if (e.length === 1) this.selectedId.set(e[0].card.id);
      },
      error: () => this.loadingCards.set(false),
    });
  }

  submit(): void {
    const cardId = this.selectedId();
    if (!cardId) return;
    this.submitting.set(true);
    this.refApi.withdraw(cardId).subscribe({
      next: (res) => {
        this.submitting.set(false);
        this.success.emit();
        // Та же success-страница, что после ручного topup'а: status=paid
        // отрисует «Платёж получен!», далее card-issuer пришлёт topup.done
        // и Status станет topped_up.
        this.router.navigate(['/topup', res.card_id, 'payment', res.topup_id]);
      },
      error: (e) => {
        this.submitting.set(false);
        this.toast.error(errorMessage(e, 'Не удалось вывести начисления'));
      },
    });
  }
}
