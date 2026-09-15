import { Component, ElementRef, HostListener, ViewChild, computed, input, output, signal } from '@angular/core';
import { translitToLatin } from '../shared/translit';

// searchable-select — порт coincat-frontend SearchableSelect под наш дизайн.
// UX: кнопка-toggle с лого+названием выбранного → выпадающее меню с поиском
// (translit-aware) и списком с круглыми лого. Standalone, без Bootstrap/Transloco.
export interface SearchableSelectItem {
  id: string;
  label: string;
  iconUrl?: string;
  searchAliases?: string[];
}

@Component({
  selector: 'app-searchable-select',
  standalone: true,
  template: `<div class="wrap" [class.open]="open()">
    <button type="button" class="toggle" [class.has-value]="!!selected()" (click)="toggle()">
      @if (selected(); as s) {
        @if (s.iconUrl) { <img class="icon" [src]="s.iconUrl" alt="" onerror="this.style.display='none'" /> }
        <span class="label">{{ s.label }}</span>
      } @else {
        <span class="label muted">{{ placeholder() || '— выберите —' }}</span>
      }
      <span class="arrow">▾</span>
    </button>

    @if (open()) {
      <div class="menu">
        <div class="search">
          <input #searchInput type="text" [value]="query()" (input)="onSearch($any($event.target).value)" [placeholder]="searchPlaceholder() || 'Поиск…'" />
          @if (query()) {
            <button type="button" class="clear" (click)="onSearch('')" aria-label="Очистить">×</button>
          }
        </div>
        <div class="list">
          @for (item of filtered(); track item.id) {
            <button type="button" class="item" [class.active]="item.id === value()" (click)="select(item)">
              @if (item.iconUrl) { <img class="icon" [src]="item.iconUrl" alt="" onerror="this.style.display='none'" /> }
              <span class="label">{{ item.label }}</span>
            </button>
          }
          @if (loading()) {
            <div class="empty">Загрузка…</div>
          } @else if (filtered().length === 0) {
            <div class="empty">Ничего не найдено</div>
          } @else if (limitNote() > 0 && filtered().length >= limitNote()) {
            <!-- Серверный режим: список обрезан провайдером — уточните запрос. -->
            <div class="limit-note">Показаны первые {{ limitNote() }} — уточните поиск</div>
          }
        </div>
      </div>
    }
  </div>`,
  styles: [`
    :host { display: block; width: 100%; }
    .wrap { position: relative; }

    .toggle {
      width: 100%; min-height: 44px;
      display: flex; align-items: center; gap: 8px;
      padding: 8px 12px;
      background: var(--color-surface-card);
      border: 1px solid var(--color-hairline);
      border-radius: var(--rounded-md);
      color: var(--color-muted);
      font-size: 15px; cursor: pointer;
      transition: border-color .15s, box-shadow .15s;
    }
    .toggle.has-value { color: var(--color-ink); }
    .toggle:focus, .wrap.open .toggle {
      outline: none;
      border-color: var(--color-primary);
      box-shadow: 0 0 0 3px color-mix(in srgb, var(--color-primary) 25%, transparent);
    }
    .toggle .label { flex: 1; min-width: 0; text-align: left; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .toggle .label.muted { color: var(--color-muted); }
    .toggle .arrow { color: var(--color-muted); font-size: 12px; flex-shrink: 0; transition: transform .2s; }
    .wrap.open .toggle .arrow { transform: rotate(180deg); }

    .menu {
      position: absolute; top: calc(100% + 4px); left: 0; right: 0;
      background: var(--color-canvas);
      border: 1px solid var(--color-hairline);
      border-radius: var(--rounded-md);
      box-shadow: 0 8px 24px rgba(0,0,0,.12);
      z-index: 50;
      overflow: hidden;
      display: flex; flex-direction: column;
      max-height: 360px;
    }
    .search {
      position: relative;
      padding: 8px;
      border-bottom: 1px solid var(--color-hairline);
      background: var(--color-canvas);
    }
    .search input {
      width: 100%; height: 36px;
      padding: 0 32px 0 12px;
      border: 1px solid var(--color-hairline);
      border-radius: var(--rounded-md);
      background: var(--color-surface-card);
      color: var(--color-ink);
      font-size: 14px;
    }
    .search input:focus {
      outline: none;
      border-color: var(--color-primary);
    }
    .clear {
      position: absolute; right: 14px; top: 50%; transform: translateY(-50%);
      width: 24px; height: 24px;
      border: none; background: transparent;
      color: var(--color-muted); font-size: 18px; cursor: pointer; line-height: 1;
    }
    .clear:hover { color: var(--color-ink); }

    .list { overflow-y: auto; overscroll-behavior: contain; }
    .item {
      width: 100%; display: flex; align-items: center; gap: 10px;
      padding: 10px 12px;
      border: none;
      border-bottom: 1px solid color-mix(in srgb, var(--color-hairline) 50%, transparent);
      background: transparent;
      color: var(--color-ink);
      font-size: 14px; text-align: left; cursor: pointer;
      transition: background-color .1s;
    }
    .item:last-child { border-bottom: none; }
    .item:hover { background: color-mix(in srgb, var(--color-primary) 8%, transparent); }
    .item.active { background: color-mix(in srgb, var(--color-primary) 16%, transparent); font-weight: 500; }
    .item .label { flex: 1; min-width: 0; }

    .icon {
      width: 28px; height: 28px;
      border-radius: 50%;
      object-fit: contain;
      background: var(--color-surface-card);
      flex-shrink: 0;
    }
    .empty {
      padding: 16px;
      color: var(--color-muted);
      text-align: center;
      font-size: 13px;
    }
    .limit-note {
      padding: 8px 12px;
      color: var(--color-muted);
      text-align: center;
      font-size: 12px;
      border-top: 1px dashed var(--color-hairline);
    }
  `],
})
export class SearchableSelectComponent {
  readonly items = input<SearchableSelectItem[]>([]);
  readonly value = input<string>('');
  readonly placeholder = input<string>('');
  readonly searchPlaceholder = input<string>('');
  /** Серверный режим: поиск уходит родителю (queryChanged, debounce ~300мс),
   *  локальная фильтрация выключена — items уже отфильтрованы сервером. */
  readonly serverMode = input(false);
  /** Идёт серверная загрузка списка (строка «Загрузка…» в меню). */
  readonly loading = input(false);
  /** >0: если строк не меньше лимита — пометка «Показаны первые N»
   *  (серверный каталог обрезает выдачу — уточните запрос). */
  readonly limitNote = input(0);
  /** Подпись выбранного значения, когда его нет в текущих items (серверный
   *  режим: выдача отфильтрована и выбранный элемент мог не попасть в неё). */
  readonly selectedLabel = input('');
  readonly valueChange = output<string>();
  /** Серверный режим: запрос поиска (эмит с debounce ~300мс; пустая строка —
   *  сразу при открытии меню, чтобы родитель подгрузил стартовый список). */
  readonly queryChanged = output<string>();

  protected readonly open = signal(false);
  protected readonly query = signal('');
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;

  @ViewChild('searchInput') private searchInput?: ElementRef<HTMLInputElement>;

  protected readonly selected = computed<SearchableSelectItem | undefined>(() => {
    const found = this.items().find((i) => i.id === this.value());
    if (found) return found;
    const v = this.value();
    if (!v) return undefined;
    // Значение выбрано, но его нет в items (серверная выдача сузилась) —
    // показываем переданную подпись, чтобы toggle не «терял» выбор.
    return { id: v, label: this.selectedLabel() || v };
  });
  protected readonly filtered = computed(() =>
    this.serverMode() ? this.items() : this.applyFilter(this.items(), this.query()));

  constructor(private readonly elRef: ElementRef<HTMLElement>) {}

  @HostListener('document:click', ['$event'])
  onDocClick(ev: MouseEvent): void {
    if (!this.open()) return;
    if (!this.elRef.nativeElement.contains(ev.target as Node)) {
      this.open.set(false);
      this.query.set('');
    }
  }

  protected toggle(): void {
    const next = !this.open();
    this.open.set(next);
    if (next) {
      this.query.set('');
      // Серверный режим: сразу просим родителя подгрузить стартовый список.
      if (this.serverMode()) this.queryChanged.emit('');
      // фокус на поле поиска + скролл к активной строке
      setTimeout(() => {
        this.searchInput?.nativeElement?.focus();
        const list = this.elRef.nativeElement.querySelector<HTMLElement>('.list');
        const active = this.elRef.nativeElement.querySelector<HTMLElement>('.item.active');
        if (list && active) {
          list.scrollTop = active.offsetTop - list.offsetTop - list.clientHeight / 2 + active.clientHeight / 2;
        }
      });
    }
  }

  protected onSearch(q: string): void {
    this.query.set(q);
    if (!this.serverMode()) return;
    // Debounce ~300мс, чтобы не бомбить каталог-прокси на каждый символ.
    if (this.debounceTimer) clearTimeout(this.debounceTimer);
    this.debounceTimer = setTimeout(() => {
      this.debounceTimer = null;
      this.queryChanged.emit(q.trim());
    }, 300);
  }

  protected select(item: SearchableSelectItem): void {
    this.valueChange.emit(item.id);
    this.open.set(false);
    this.query.set('');
  }

  private applyFilter(items: SearchableSelectItem[], query: string): SearchableSelectItem[] {
    const q = query.toLowerCase().trim();
    if (!q) return items;
    return items.filter((it) => SearchableSelectComponent.matchField(it.label, q) || it.searchAliases?.some((a) => SearchableSelectComponent.matchField(a, q)));
  }

  private static matchField(field: string, query: string): boolean {
    const f = field.toLowerCase();
    const qTranslit = translitToLatin(query).toLowerCase();
    if (f.includes(query) || f.includes(qTranslit)) return true;
    const fStripped = SearchableSelectComponent.stripSpecial(field);
    const qStripped = SearchableSelectComponent.stripSpecial(query);
    const qStripTranslit = SearchableSelectComponent.stripSpecial(qTranslit);
    return (!!qStripped && fStripped.includes(qStripped)) || (!!qStripTranslit && fStripped.includes(qStripTranslit));
  }

  private static stripSpecial(s: string): string { return s.replace(/[^a-zа-яёa-z0-9]/gi, '').toLowerCase(); }
}
