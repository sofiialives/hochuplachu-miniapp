import { Component, input, output, computed } from '@angular/core';
import { DialogComponent } from '../../ui/dialog.component';
import { CopyButtonComponent } from '../../ui/copy-button.component';

interface Row {
  key: string;
  label: string;
  hint?: string;
  value?: string;
  copy?: boolean;
}

// BillingStub — захардкоженный биллинг-адрес по стране выпуска (BIN). В БД лежат
// реальные данные из buvei (Card.BillingAddress), но пользователю показываем
// канонический «красивый» адрес по стране BIN — buvei-адрес (реальный, напр.
// US/Tucson) для чекаута на зарубежных сайтах не годится и НЕ показывается.
interface BillingStub {
  address: string;
  district: string;
  zip: string;
  region: string;
}

// Ключ — нормализованная страна BIN карты (Card.issuer_country; для
// legacy-карт — страна первого BIN продукта, см. home.binCountryOf).
// Алиасы (полные названия, UK) сведены к коду в normalizeCountry().
const BILLING_STUBS: Record<string, BillingStub> = {
  HK: { address: '26 Village Road', district: 'Happy Valley', zip: '999077', region: 'Hong Kong' },
  SG: { address: '21 Marina Way', district: 'West Region', zip: '018978', region: 'Singapore' },
  GB: { address: '20 Fenchurch Street', district: 'City of London', zip: 'EC3M 3BY', region: 'England' },
};

@Component({
  selector: 'app-billing-address-dialog',
  standalone: true,
  imports: [DialogComponent, CopyButtonComponent],
  template: `<app-dialog title="Биллинговый адрес" (dismissed)="closed.emit()">
    @for (row of rows(); track row.key) {
      <div class="row">
        <div class="col">
          <div class="lbl">{{ row.label }}</div>
          @if (row.hint) { <div class="hint">{{ row.hint }}</div> }
          @if (row.value) { <div class="val">{{ row.value }}</div> }
        </div>
        @if (row.copy && row.value) {
          <app-copy-button [value]="row.value" [label]="row.label" />
        }
      </div>
    }
  </app-dialog>`,
  styles: [`
    .row {
      display: flex; align-items: center; gap: var(--space-sm);
      padding: var(--space-sm) 0;
      border-bottom: 1px solid var(--color-hairline-soft);
    }
    .row:last-of-type { border-bottom: none; }
    .col { flex: 1; min-width: 0; }
    .lbl { font-size: 12px; color: var(--color-muted); }
    .hint { font-size: 12px; color: var(--color-muted); opacity: .8; margin-top: 2px; }
    .val { font-weight: 600; font-size: 15px; margin-top: 4px; overflow-wrap: anywhere; }
  `],
})
export class BillingAddressDialog {
  // binCountry — страна выпуска BIN карты (Card.issuer_country, HK/SG/GB).
  // ВАЖНО: это НЕ billing_address.country (там реальная страна buvei-адреса,
  // напр. US) — дискриминатор заглушки берётся строго от BIN'а выпуска.
  readonly binCountry = input<string>('');
  readonly closed = output<void>();

  protected rows = computed<Row[]>(() => {
    const out: Row[] = [];

    // Держатель карты: реальное ФИО из buvei пользователю не показываем —
    // строка-инструкция использовать своё имя латиницей (как в загранпаспорте),
    // без копирования (копировать инструкцию незачем).
    out.push({
      key: 'cardholder',
      label: 'Держатель карты',
      hint: 'Укажите свои имя и фамилию латиницей — как в загранпаспорте',
      copy: false,
    });

    // Fail-closed: реальный billing из buvei НИКОГДА не показываем. Если страна
    // BIN'а не задана/не распознана — просто не рисуем адрес (админ проставляет
    // страну у BIN'а продукта; до этого адреса не будет, но и реальный US-адрес
    // не утечёт).
    const stub = BILLING_STUBS[normalizeCountry(this.binCountry())];
    if (stub) {
      out.push({ key: 'address_1', label: this.labels['address_1'], value: stub.address, copy: true });
      out.push({ key: 'district', label: this.labels['district'], value: stub.district, copy: true });
      out.push({ key: 'zip', label: this.labels['zip'], value: stub.zip, copy: true });
      out.push({ key: 'region', label: this.labels['region'], value: stub.region, copy: true });
    }
    return out;
  });

  private readonly labels: Record<string, string> = {
    address_1: 'Адрес (Address line 1)',
    district: 'Район (District)',
    zip: 'Почтовый индекс (ZIP / Postal code)',
    region: 'Регион (Region)',
  };
}

// normalizeCountry — сводит страну BIN'а (код или полное название) к ISO-коду
// заглушки (HK/SG/GB). Пустое / незнакомое → '' (адрес не показываем,
// fail-closed).
function normalizeCountry(raw: string | undefined): string {
  const c = (raw ?? '').trim().toUpperCase();
  switch (c) {
    case 'HK':
    case 'HKG':
    case 'HONG KONG':
    case 'HONGKONG':
      return 'HK';
    case 'SG':
    case 'SGP':
    case 'SINGAPORE':
      return 'SG';
    case 'GB':
    case 'GBR':
    case 'UK':
    case 'ENGLAND':
    case 'GREAT BRITAIN':
    case 'UNITED KINGDOM':
      return 'GB';
    default:
      return '';
  }
}
