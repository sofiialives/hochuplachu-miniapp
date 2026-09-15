import { Component, computed, input, signal } from '@angular/core';
import { CopyButtonComponent } from '../../ui/copy-button.component';

// CCRequisitesComponent — рендер реквизитов оплаты по контракту coincat-fe
// (modules/guest/exchange-confirm/exchange-confirm.component.html + order-details.service.ts).
//
// Поддерживаются типы depositRequisitesType:
//   - raw / undefined — простой crypto-адрес (+ опц. memo)
//   - card  — номер карты + получатель + банк
//   - phone — телефон + получатель + банк
//   - account — счёт + получатель + банк
//   - complex — несколько блоков-табов:
//       * EUR_REVOLUT — Revtag / IBAN / cardNumber
//       * EUR_WISE    — Email Wise / IBAN
//       * EUR_CARD    — Номер карты / IBAN
//       * default     — Перевод на карту / Перевод по СБП (телефон)
//
// Логика split «sbpVal::cardVal» по полям owner/bankName — повторяет
// order-details.service.ts.finalNotes.
interface Field {
  key: string;
  label: string;
  value: string;
  mono?: boolean;
}

interface Block {
  header: string;
  fields: Field[];
}

@Component({
  selector: 'app-cc-requisites',
  standalone: true,
  imports: [CopyButtonComponent],
  template: `
    <div class="cc-row sum">
      <div class="lbl">Сумма</div>
      <div class="val mono">{{ formattedAmount() }} {{ amountSymbol() }}</div>
      <app-copy-button [value]="formattedAmount()" label="amount" />
    </div>

    @if (blocks().length === 1) {
      @for (f of blocks()[0].fields; track f.key) {
        <div class="cc-row">
          <div class="lbl">{{ f.label }}</div>
          <div class="val" [class.mono]="f.mono">{{ f.value }}</div>
          <app-copy-button [value]="f.value" [label]="f.key" />
        </div>
      }
    } @else if (blocks().length > 1) {
      <div class="tabs">
        @for (b of blocks(); track b.header; let i = $index) {
          <button class="tab" [class.active]="active() === i" (click)="active.set(i)" type="button">{{ b.header }}</button>
        }
      </div>
      @for (f of blocks()[active()].fields; track f.key) {
        <div class="cc-row">
          <div class="lbl">{{ f.label }}</div>
          <div class="val" [class.mono]="f.mono">{{ f.value }}</div>
          <app-copy-button [value]="f.value" [label]="f.key" />
        </div>
      }
    }
  `,
  styles: [`
    :host { display: block; }
    .cc-row { display: flex; gap: 8px; align-items: center; padding: 12px 0; border-bottom: 1px solid var(--color-hairline-soft); }
    .cc-row.sum { padding-top: 0; }
    .cc-row .lbl { flex: 0 0 140px; color: var(--color-muted); font-size: 13px; }
    .cc-row .val { flex: 1; font-weight: 600; word-break: break-all; font-size: 15px; }
    .mono { font-family: var(--font-mono, ui-monospace, SFMono-Regular, Menlo, monospace); }
    .tabs { display: flex; gap: 8px; flex-wrap: wrap; margin: 8px 0 4px; }
    .tab { padding: 8px 14px; border-radius: var(--rounded-pill); background: var(--color-canvas); border: 1px solid var(--color-hairline); cursor: pointer; font-size: 13px; font-weight: 500; }
    .tab.active { background: var(--color-primary); color: var(--color-on-primary, #fff); border-color: var(--color-primary); }
  `],
})
export class CcRequisitesComponent {
  readonly requisites = input<Record<string, unknown> | null>(null);
  readonly type = input<string>(''); // 'card' | 'phone' | 'account' | 'complex' | 'raw'
  readonly amount = input<number>(0);
  readonly amountSymbol = input<string>('');
  readonly currencyId = input<string>('');

  protected readonly active = signal(0);

  protected formattedAmount = computed(() => {
    const a = this.amount();
    if (!a) return '0';
    return Number.isInteger(a) ? a.toString() : a.toFixed(a < 1 ? 8 : 2);
  });

  protected blocks = computed<Block[]>(() => {
    const req = this.requisites();
    if (!req) return [];
    const t = (this.type() || '').toLowerCase();

    // split owner/bankName 'sbpVal::cardVal' (как у coincat-fe).
    const v = (k: string): string => {
      const raw = req[k];
      if (typeof raw !== 'string') return '';
      return raw;
    };
    const vSbp = (k: string): string => {
      const raw = v(k);
      if (raw.includes('::')) return raw.split('::')[0] ?? '';
      return raw;
    };
    const vCard = (k: string): string => {
      const raw = v(k);
      if (raw.includes('::')) return raw.split('::')[1] ?? '';
      return raw;
    };
    const ownerCardVal = v('ownerCard') || vCard('owner');

    // RAW / crypto — один блок без табов.
    if (!t || t === 'raw') {
      const addr = v('address');
      if (!addr) return [];
      const fields: Field[] = [{ key: 'address', label: 'Адрес перевода', value: addr, mono: true }];
      if (v('memo')) fields.push({ key: 'memo', label: 'Memo', value: v('memo'), mono: true });
      return [{ header: '', fields }];
    }

    if (t === 'complex') {
      return this.buildComplex(this.currencyId(), v, vSbp, vCard, ownerCardVal);
    }

    // card / phone / account — один набор полей.
    const addressLabel = t === 'card' ? 'Номер карты' : t === 'phone' ? 'Телефон получателя' : t === 'account' ? 'Номер счёта' : 'Реквизиты';
    const addressMono = t === 'card' || t === 'phone' || t === 'account';
    const fields: Field[] = [];
    if (v('address')) fields.push({ key: 'address', label: addressLabel, value: v('address'), mono: addressMono });
    if (v('phone')) fields.push({ key: 'phone', label: 'Телефон получателя', value: v('phone'), mono: true });
    if (v('cardNumber')) fields.push({ key: 'cardNumber', label: 'Номер карты', value: v('cardNumber'), mono: true });
    if (v('owner')) fields.push({ key: 'owner', label: 'Получатель', value: v('owner') });
    if (v('bankName')) fields.push({ key: 'bankName', label: 'Банк', value: v('bankName') });
    if (v('bik')) fields.push({ key: 'bik', label: 'БИК', value: v('bik'), mono: true });
    if (v('bic')) fields.push({ key: 'bic', label: 'BIC', value: v('bic'), mono: true });
    if (v('iban')) fields.push({ key: 'iban', label: 'IBAN', value: v('iban'), mono: true });
    if (v('memo')) fields.push({ key: 'memo', label: 'Memo', value: v('memo'), mono: true });
    return fields.length ? [{ header: '', fields }] : [];
  });

  // buildComplex — copy of exchange-confirm.component.html switch(order.currencyFrom)
  // для RequisiteType.COMPLEX. Заголовки берём из i18n confirm_payment.do_payment_complex_*.
  private buildComplex(
    currencyId: string,
    v: (k: string) => string,
    vSbp: (k: string) => string,
    vCard: (k: string) => string,
    ownerCardVal: string,
  ): Block[] {
    switch (currencyId) {
      case 'EUR_REVOLUT': {
        const blocks: Block[] = [];
        if (v('revtag')) {
          blocks.push({
            header: 'По @Revtag',
            fields: [
              { key: 'revtag', label: 'Revtag', value: v('revtag') },
              ...(v('owner') ? [{ key: 'owner', label: 'Получатель', value: v('owner') }] : []),
            ],
          });
        }
        if (v('address')) {
          blocks.push({
            header: 'По номеру счета',
            fields: [
              { key: 'address', label: 'IBAN', value: v('address'), mono: true },
              ...(v('bic') ? [{ key: 'bic', label: 'BIC', value: v('bic'), mono: true }] : []),
              ...(v('bankName') ? [{ key: 'bankName', label: 'Банк', value: v('bankName') }] : []),
              ...(v('owner') ? [{ key: 'owner', label: 'Получатель', value: v('owner') }] : []),
            ],
          });
        }
        if (v('cardNumber')) {
          blocks.push({
            header: 'По номеру карты',
            fields: [
              { key: 'cardNumber', label: 'Номер карты', value: v('cardNumber'), mono: true },
              { key: 'ownerCard', label: 'Владелец карты', value: ownerCardVal },
            ],
          });
        }
        return blocks;
      }
      case 'EUR_WISE': {
        const blocks: Block[] = [
          {
            header: 'По @Wise email',
            fields: [
              { key: 'address', label: 'Email Wise', value: v('address') },
              ...(v('owner') ? [{ key: 'owner', label: 'Получатель', value: v('owner') }] : []),
            ],
          },
        ];
        if (v('iban')) {
          blocks.push({
            header: 'По номеру счета',
            fields: [
              { key: 'iban', label: 'IBAN', value: v('iban'), mono: true },
              ...(v('bic') ? [{ key: 'bic', label: 'BIC', value: v('bic'), mono: true }] : []),
              ...(v('bankName') ? [{ key: 'bankName', label: 'Банк', value: v('bankName') }] : []),
              ...(v('owner') ? [{ key: 'owner', label: 'Получатель', value: v('owner') }] : []),
            ],
          });
        }
        return blocks;
      }
      case 'EUR_CARD': {
        const blocks: Block[] = [
          {
            header: 'По номеру карты',
            fields: [
              { key: 'address', label: 'Номер карты', value: v('address'), mono: true },
              ...(v('bankName') ? [{ key: 'bankName', label: 'Банк', value: v('bankName') }] : []),
              ...(v('owner') ? [{ key: 'owner', label: 'Получатель', value: v('owner') }] : []),
            ],
          },
        ];
        if (v('iban')) {
          blocks.push({
            header: 'По номеру счета',
            fields: [
              { key: 'iban', label: 'IBAN', value: v('iban'), mono: true },
              ...(v('bic') ? [{ key: 'bic', label: 'BIC', value: v('bic'), mono: true }] : []),
              ...(v('bankName') ? [{ key: 'bankName', label: 'Банк', value: v('bankName') }] : []),
              ...(v('owner') ? [{ key: 'owner', label: 'Получатель', value: v('owner') }] : []),
            ],
          });
        }
        return blocks;
      }
      default: {
        // RUB_* и прочие сложные банковские — карта + СБП.
        const cardBlock: Block = {
          header: 'По номеру карты',
          fields: v('address')
            ? [
                { key: 'address', label: 'Номер карты', value: v('address'), mono: true },
                { key: 'ownerCard', label: 'Владелец карты', value: ownerCardVal },
              ]
            : [],
        };
        const phoneBlock: Block = {
          header: 'По номеру телефона',
          fields: [
            ...(v('phone') ? [{ key: 'phone', label: 'Телефон получателя', value: v('phone'), mono: true }] : []),
            ...(vSbp('bankName') ? [{ key: 'bankName', label: 'Банк', value: vSbp('bankName') }] : []),
            ...(vSbp('owner') ? [{ key: 'owner', label: 'Получатель', value: vSbp('owner') }] : []),
          ],
        };
        return [cardBlock, phoneBlock].filter((b) => b.fields.length > 0);
      }
    }
  }
}
