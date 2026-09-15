import { Component, EventEmitter, Input, Output, computed, inject, signal } from '@angular/core';
import { ButtonComponent } from '../../ui/button.component';
import { InputComponent } from '../../ui/input.component';
import { DialogComponent } from '../../ui/dialog.component';
import { SearchableSelectComponent, SearchableSelectItem } from '../../ui/searchable-select.component';
import { CurrencyService, PaymentCurrency, PaymentCurrencyField, SbpBank, nonPhoneFromFields } from '../../core/currency/currency.service';
import { RequisitesCacheService } from '../../core/currency/requisites-cache.service';
import { translitToLatin } from '../../shared/translit';
import { formatPhoneInput } from '../../shared/phone-format';

// requisites.dialog — собирает реквизиты плательщика для CreateOrderRequest.from.
// Поля приходят с бекенда (PaymentCurrency.fields_from) — это зеркало
// Currency.fieldsFrom из coincat openapi. Для RUB_SBP направлений отдельно
// тянем список банков (/payment/cc/sbp-banks) и заменяем поле bankName на
// выбор из списка.
@Component({
  selector: 'app-requisites-dialog',
  standalone: true,
  imports: [ButtonComponent, InputComponent, DialogComponent, SearchableSelectComponent],
  template: `<app-dialog [title]="'Реквизиты оплаты'" (dismissed)="dismissed.emit()">
    <p class="hint">Заполните данные плательщика.</p>
    <form (submit)="$event.preventDefault(); submit()">
      @for (f of effectiveFields(); track f.name) {
        @if (f.name === 'bankName' && isSbp()) {
          <div class="row">
            <label>Банк{{ f.required ? ' *' : '' }}</label>
            <app-searchable-select
              [items]="bankItems()"
              [value]="value(f.name)"
              placeholder="— выберите банк —"
              searchPlaceholder="Поиск банка…"
              (valueChange)="setValue(f.name, $event)" />
          </div>
        } @else {
          <div class="row">
            <label>{{ fieldLabel(f) }}{{ f.required ? ' *' : '' }}</label>
            <app-input
              [value]="value(f.name)"
              (valueChange)="setValue(f.name, $event)"
              [placeholder]="fieldPlaceholder(f)"
              [inputmode]="inputModeFor(f)"
              [maxLength]="maxLengthFor(f)" />
          </div>
        }
      }
      @if (error()) { <div class="err">{{ error() }}</div> }
      <app-button variant="primary" [full]="true" [disabled]="!canSubmit()" (click)="submit()">Продолжить</app-button>
    </form>
  </app-dialog>`,
  styles: [`
    .hint { color: var(--color-muted); margin: 0 0 var(--space-md); }
    .row { display: flex; flex-direction: column; gap: 6px; margin-bottom: var(--space-md); }
    label { font-size: 13px; color: var(--color-muted); }
    select {
      height: 44px; padding: 0 12px;
      border-radius: var(--rounded-md);
      border: 1px solid var(--color-hairline);
      background: var(--color-surface-card);
      color: var(--color-ink);
      font-size: 15px;
    }
    .err { color: var(--color-danger, #c0392b); font-size: 13px; margin-bottom: var(--space-sm); }
  `],
})
export class RequisitesDialogComponent {
  @Input({ required: true }) currency!: PaymentCurrency;
  @Output() dismissed = new EventEmitter<void>();
  @Output() submitted = new EventEmitter<Record<string, string>>();

  private readonly currencyService = inject(CurrencyService);
  private readonly cache = inject(RequisitesCacheService);

  protected readonly values = signal<Record<string, string>>({});
  protected readonly banks = signal<SbpBank[]>([]);
  protected readonly error = signal<string | null>(null);

  protected readonly isSbp = computed(() => this.currency?.id?.startsWith('RUB_SBP') ?? false);

  // Для гривна-карты (UAH_CARD.*) поле `address` от coincat означает не адрес
  // крипто-кошелька, а номер карты отправителя — метку показываем осмысленную.
  protected readonly isUahCard = computed(() => this.currency?.id?.startsWith('UAH_CARD') ?? false);

  protected readonly bankItems = computed<SearchableSelectItem[]>(() =>
    this.banks().map((b) => ({
      id: b.bank_id,
      label: b.name,
      iconUrl: b.logo_url,
      searchAliases: [translitToLatin(b.name)],
    })),
  );

  // fields_from приходит от coincat (Currency.fieldsFrom). Если пусто — крипто-
  // направления (BTC, LTC, TON, USDT_TRX) coincat ничего не запрашивает,
  // диалог не должен открываться вовсе (см. checkout/topup selectCurrency).
  // Поле phone скрываем: backend сам подставит User.Phone в callCoincatCreateOrder
  // (см. nonPhoneFromFields в currency.service).
  protected readonly effectiveFields = computed<PaymentCurrencyField[]>(() => nonPhoneFromFields(this.currency));

  ngOnInit(): void {
    // подставляем закэшированные значения (как у coincat-frontend FormCacheService) —
    // оставляем только те ключи, что заявлены fieldsFrom выбранной валюты, чтобы
    // случайно не залить мусор в `from`. Для card-полей форматируем под маску
    // (в кэше храним «голые» цифры, в UI — «0000 0000 0000 0000»).
    const cached = this.cache.load(this.currency.id);
    const byName = new Map(this.effectiveFields().map((f) => [f.name, f] as const));
    const prefill: Record<string, string> = {};
    for (const [k, v] of Object.entries(cached)) {
      const f = byName.get(k);
      if (!f) continue;
      if (this.isCardField(f)) prefill[k] = formatCard(v);
      else if (this.isPhoneField(f)) prefill[k] = formatPhoneInput(v);
      else prefill[k] = v;
    }
    if (Object.keys(prefill).length > 0) this.values.set(prefill);

    if (this.isSbp()) {
      this.currencyService.loadSbpBanks().subscribe({
        next: (r) => this.banks.set(r.banks),
        error: () => this.banks.set([]),
      });
    }
  }

  protected value(name: string): string { return this.values()[name] ?? ''; }
  protected setValue(name: string, v: string): void {
    const f = this.effectiveFields().find((x) => x.name === name);
    let next = v;
    if (f && this.isCardField(f)) next = formatCard(v);
    else if (f && this.isPhoneField(f)) next = formatPhoneInput(v);
    this.values.update((m) => ({ ...m, [name]: next }));
    this.error.set(null);
  }

  protected isCardField(f: PaymentCurrencyField): boolean {
    return f.type === 'card';
  }

  protected isPhoneField(f: PaymentCurrencyField): boolean {
    return f.type === 'phone';
  }

  protected inputModeFor(f: PaymentCurrencyField): 'text' | 'email' | 'numeric' | 'decimal' {
    if (this.isCardField(f) || this.isPhoneField(f)) return 'numeric';
    return 'text';
  }

  protected maxLengthFor(f: PaymentCurrencyField): number | null {
    if (this.isCardField(f)) return 23; // 19 цифр (ПриватБанк) + 4 пробела; точный лимит проверит submit() по f.max_length
    return f.max_length ?? null;
  }

  protected fieldLabel(f: PaymentCurrencyField): string {
    // Лейбл выбираем по `type` поля (как coincat-fe — он смотрит на семантику).
    // Имя поля `address` встречается у любых валют и НЕ означает «карту»: для
    // RUB_SBP это телефон, для крипты — адрес кошелька, для RUB_CARD — карта.
    if (this.isPhoneField(f)) return 'Телефон';
    if (this.isCardField(f)) return 'Номер карты';
    switch (f.name) {
      case 'bankName': return 'Банк';
      case 'fio': return 'ФИО';
      case 'tag': return 'Memo / Tag';
      case 'recipient': return 'Получатель';
      case 'sender': return 'Отправитель';
      case 'address': return this.isUahCard() ? 'Номер карты отправителя' : 'Адрес кошелька';
      default: return f.name;
    }
  }

  protected fieldPlaceholder(f: PaymentCurrencyField): string {
    if (this.isPhoneField(f)) return '+7 999 123-45-67';
    if (this.isCardField(f)) return '0000 0000 0000 0000';
    if (f.name === 'fio') return 'Иванов Иван Иванович';
    return '';
  }

  protected canSubmit(): boolean {
    const v = this.values();
    for (const f of this.effectiveFields()) {
      if (f.required && !(v[f.name] ?? '').trim()) return false;
    }
    return true;
  }

  protected submit(): void {
    const v = this.values();
    // нормализуем для отправки — пробелы из card убираем, phone оставляем как +digits.
    // coincat-fe ngx-mask использует dropSpecialCharacters=true: в payload и в
     // regex.test() уходит ТОЛЬКО digits (без '+', '-', пробелов).
    const normalized: Record<string, string> = {};
    for (const f of this.effectiveFields()) {
      const raw = (v[f.name] ?? '').trim();
      if (this.isCardField(f)) normalized[f.name] = raw.replace(/\D+/g, '');
      else if (this.isPhoneField(f)) normalized[f.name] = raw.replace(/\D+/g, '');
      else normalized[f.name] = raw;
    }
    for (const f of this.effectiveFields()) {
      const val = normalized[f.name];
      if (f.required && !val) { this.error.set(`Заполните «${this.fieldLabel(f)}»`); return; }
      if (val && f.min_length && val.length < f.min_length) { this.error.set(`«${this.fieldLabel(f)}» слишком короткое`); return; }
      if (val && f.max_length && val.length > f.max_length) { this.error.set(`«${this.fieldLabel(f)}» слишком длинное`); return; }
      for (const rule of f.validates ?? []) {
        if (rule.type === 'regex' && rule.rule && val) {
          try {
            const re = new RegExp(rule.rule);
            if (!re.test(val)) { this.error.set(`«${this.fieldLabel(f)}» не соответствует формату`); return; }
          } catch { /* invalid regex from backend — skip */ }
        }
      }
    }
    this.cache.save(this.currency.id, normalized);
    this.submitted.emit({ ...normalized });
  }
}

// formatCard — превращает строку в «0000 0000 0000 0000»: оставляет только цифры
// (до 19 — карты ПриватБанка бывают 19-значные) и расставляет пробелы каждые
// 4 символа. Используется и для prefill из кэша, и для on-input нормализации.
// Точный лимит цифр валидирует submit() по f.max_length из fields_from.
function formatCard(input: string): string {
  const digits = (input ?? '').replace(/\D+/g, '').slice(0, 19);
  return digits.replace(/(.{4})(?=.)/g, '$1 ');
}

// formatPhone теперь общий — см. ../../shared/phone-format.ts (formatPhoneInput).
// Маска: «+» автоматический при наличии цифр, ограничение 15 цифр, никакой
// национальной жёсткой маски (coincat принимает любой международный формат).
