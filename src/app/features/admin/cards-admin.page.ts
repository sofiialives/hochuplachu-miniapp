import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { ActivatedRoute, Router } from '@angular/router';
import { AdminApi, AdminCard, AdminCardsResponse, PromoCode } from '../../core/api/admin.api';
import { CardProduct, CardProviderRef, CardsApi } from '../../core/api/cards.api';
import { AuthService } from '../../core/auth/auth.service';
import { InputComponent } from '../../ui/input.component';
import { ButtonComponent } from '../../ui/button.component';
import { DialogComponent } from '../../ui/dialog.component';
import { ToastService } from '../../core/notifications/toast.service';
import { errorMessage } from '../../core/errors/api-error';

// CardsAdminPage — список выпущенных карт с пагинацией и фильтрами.
// Сортировка фиксированная: created_at DESC (новые сверху, делает бэкенд).
@Component({
  selector: 'app-cards-admin',
  standalone: true,
  imports: [InputComponent, ButtonComponent, DialogComponent, DatePipe],
  template: `<h1>Выпущенные карты</h1>

    @if (userFilter(); as uf) {
      <div class="user-chip">
        <span>Карты пользователя: <b>{{ uf.label }}</b></span>
        <button type="button" class="chip-clear" (click)="clearUserFilter()" aria-label="Сбросить фильтр по пользователю">×</button>
      </div>
    }

    <div class="filters">
      <app-input [(value)]="q" placeholder="Поиск (last4, email, имя, держатель)" (enterPressed)="apply()" />
      <label class="select">
        <span>Статус</span>
        <select [value]="status()" (change)="status.set($any($event.target).value)">
          <option value="">все</option>
          <option value="issuing">issuing</option>
          <option value="active">active</option>
          <option value="frozen">frozen</option>
          <option value="closed">closed</option>
          <option value="deleted">deleted</option>
        </select>
      </label>
      <label class="select">
        <span>Продукт</span>
        <select [value]="productID()" (change)="productID.set($any($event.target).value)">
          <option value="">все</option>
          @for (p of products(); track p.id) {
            <option [value]="p.id">{{ p.name }}</option>
          }
        </select>
      </label>
      <!-- /admin/promo закрыт от модератора (RequireAdmin) — фильтр только админу. -->
      @if (meIsAdmin()) {
        <label class="select">
          <span>Промокод</span>
          <select [value]="promoID()" (change)="promoID.set($any($event.target).value)">
            <option value="">все</option>
            @for (p of promos(); track p.id) {
              <option [value]="p.id!">{{ p.code }}</option>
            }
          </select>
        </label>
      }
      <label class="select">
        <span>На странице</span>
        <select [value]="pageSize()" (change)="setPageSize($any($event.target).value)">
          <option [value]="10">10</option>
          <option [value]="25">25</option>
          <option [value]="50">50</option>
          <option [value]="100">100</option>
        </select>
      </label>
      <app-button variant="primary" (click)="apply()">Применить</app-button>
      <app-button variant="ghost" (click)="reset()">Сбросить</app-button>
    </div>

    <div class="meta">Найдено: {{ total() }}</div>

    <table>
      <thead>
        <tr>
          <th>Создана</th>
          <th>Номер</th>
          <th>Держатель</th>
          <th>Email / TG</th>
          <th>Продукт</th>
          <th>Статус</th>
          <th>Баланс</th>
          <th>Срок дейст.</th>
          <th>Срок обсл.</th>
          <th>Действия</th>
        </tr>
      </thead>
      <tbody>
        @for (c of items(); track c.id) {
          <tr>
            <td><span class="dim">{{ c.created_at | date:'dd.MM.yy HH:mm' }}</span></td>
            <td>
              @if (panFor(c); as pan) {
                <code class="pan-full">{{ formatPan(pan) }}</code>
              } @else {
                <code>•• {{ c.last4 || '----' }}</code>
              }
              <!-- Раскрытие PAN доступно и модератору (карты админов backend
                   ему не отдаёт); у issuing-карт номера ещё нет (нет last4). -->
              @if (c.last4) {
                <button type="button" class="pan-toggle" [disabled]="panBusyId() === c.id" (click)="togglePan(c)">
                  {{ panBusyId() === c.id ? 'загрузка…' : (panFor(c) ? 'скрыть' : 'показать') }}
                </button>
              }
            </td>
            <td>{{ c.cardholder.trim() || '—' }}</td>
            <td>
              @if (c.user_email) { {{ c.user_email }} }
              @else { <span class="dim">— нет —</span> }
              <div class="sub">{{ c.user_first_name }} {{ c.user_last_name }}</div>
            </td>
            <td>{{ c.product_name || c.card_product_id }}</td>
            <td><span class="badge" [class]="'st-' + c.status">{{ c.status }}</span></td>
            <td>{{ c.balance }}</td>
            <td>
              @if (c.expiry_month && c.expiry_year) { <code>{{ expiryLabel(c) }}</code> }
              @else { <span class="dim">—</span> }
            </td>
            <td>
              @if (c.service_expires_at) { {{ c.service_expires_at | date:'dd.MM.yy' }} }
              @else { <span class="dim">—</span> }
            </td>
            <td class="row-actions">
              @if (c.status === 'active') {
                <button type="button" class="act act--freeze" [disabled]="busyId() === c.id" (click)="askFreeze(c)">Заморозить</button>
              } @else if (c.status === 'frozen') {
                @if (c.frozen_by_admin === false) {
                  <!-- Заморожена по истёкшему обслуживанию: разморозка через
                       админку бесполезна (воркер заморозит обратно, backend
                       вернёт SERVICE_EXPIRED) — показываем статус, не кнопку. -->
                  <span class="dim">истекло обслуживание</span>
                } @else {
                  <button type="button" class="act act--unfreeze" [disabled]="busyId() === c.id" (click)="askUnfreeze(c)">Разморозить</button>
                }
              } @else {
                <span class="dim">—</span>
              }
              <!-- Замена/удаление (admin-only endpoints): замена — старая карта
                   удаляется, новая выпускается под выбранный BIN с переносом
                   баланса; удаление — то же, но без перевыпуска. -->
              @if (meIsAdmin() && (c.status === 'active' || c.status === 'frozen')) {
                <button type="button" class="act act--replace" [disabled]="busyId() === c.id" (click)="askReplace(c)">Заменить</button>
                <button type="button" class="act act--delete" [disabled]="busyId() === c.id" (click)="askDelete(c)">Удалить</button>
              }
            </td>
          </tr>
        } @empty {
          <tr><td colspan="10" class="empty">Карт не найдено</td></tr>
        }
      </tbody>
    </table>

    <div class="pager">
      <app-button variant="ghost" (click)="prev()" [disabled]="page() <= 1">‹ Назад</app-button>
      <span>Страница {{ page() }} из {{ totalPages() }}</span>
      <app-button variant="ghost" (click)="next()" [disabled]="page() >= totalPages()">Вперёд ›</app-button>
    </div>

    @if (confirm(); as cf) {
      <app-dialog [title]="cf.freeze ? 'Заморозить карту' : 'Разморозить карту'" (dismissed)="cancelConfirm()">
        <p class="confirm-text">
          @if (cf.freeze) {
            Карта <code>•• {{ cf.card.last4 || '----' }}</code> будет заморожена — операции по ней
            станут недоступны до разморозки.
          } @else {
            Карта <code>•• {{ cf.card.last4 || '----' }}</code> снова станет активной.
          }
          <span class="confirm-owner">Владелец: {{ cf.card.user_email || (cf.card.user_first_name + ' ' + cf.card.user_last_name) || cf.card.user_id }}</span>
        </p>
        <div class="confirm-actions">
          <app-button variant="ghost" (click)="cancelConfirm()">Отмена</app-button>
          <app-button variant="primary" [disabled]="busyId() === cf.card.id" (click)="doConfirm()">
            {{ cf.freeze ? 'Заморозить' : 'Разморозить' }}
          </app-button>
        </div>
      </app-dialog>
    }

    @if (replaceDlg(); as rd) {
      <app-dialog title="Заменить карту" (dismissed)="cancelReplace()">
        <p class="confirm-text">
          Карта <code>•• {{ rd.card.last4 || '----' }}</code> будет <b>удалена</b> (не заморожена):
          у issuer'а карта удаляется, в базе помечается удалённой, у пользователя пропадает из списка.
          Взамен будет выпущена новая карта на выбранный BIN.
          @if (rd.card.balance > 0) {
            Баланс <b>{{ rd.card.balance }} {{ productCurrency(rd.card) }}</b> будет перенесён на новую карту.
          }
          <span class="confirm-owner">Владелец: {{ rd.card.user_email || (rd.card.user_first_name + ' ' + rd.card.user_last_name) || rd.card.user_id }}</span>
        </p>
        @if (replaceRefs().length) {
          <!-- Провайдер выпуска → его BIN'ы из providers продукта. Пара
               {provider, issuer_bin_id} валидируется бэком fail-closed. -->
          <label class="select select--dialog">
            <span>Провайдер выпуска</span>
            <select [value]="rd.provider" (change)="setReplaceProvider($any($event.target).value)">
              @for (pc of replaceProviders(); track pc) {
                <option [value]="pc" [selected]="pc === rd.provider">{{ pc }}</option>
              }
            </select>
          </label>
          <label class="select select--dialog">
            <span>BIN новой карты</span>
            <select [value]="rd.binId" (change)="setReplaceBin($any($event.target).value)">
              @for (b of replaceProviderBins(); track b.bin_id) {
                <option [value]="b.bin_id" [selected]="b.bin_id === rd.binId">{{ binLabel(b) }}{{ b.bin_id === rd.card.issuer_bin_id ? ' — текущий' : '' }}</option>
              }
            </select>
          </label>
        } @else {
          <p class="dim">У карты-продукта не настроены провайдер-привязки (BIN'ы) — замена невозможна.</p>
        }
        <div class="confirm-actions">
          <app-button variant="ghost" (click)="cancelReplace()">Отмена</app-button>
          <app-button variant="primary" [disabled]="busyId() === rd.card.id || !rd.binId" (click)="doReplace()">
            Заменить
          </app-button>
        </div>
      </app-dialog>
    }

    @if (deleteDlg(); as dd) {
      <app-dialog title="Удалить карту" (dismissed)="cancelDelete()">
        <p class="confirm-text">
          Карта <code>•• {{ dd.card.last4 || '----' }}</code> будет <b>удалена безвозвратно</b>
          (не заморожена): у issuer'а карта удаляется, в базе помечается удалённой,
          у пользователя пропадает из списка. Новая карта взамен НЕ выпускается.
          @if (dd.card.balance > 0) {
            Баланс <b>{{ dd.card.balance }} {{ productCurrency(dd.card) }}</b> будет утерян —
            остаток вернётся на кошелёк сервиса, пользователю не компенсируется.
          }
          <span class="confirm-owner">Владелец: {{ dd.card.user_email || (dd.card.user_first_name + ' ' + dd.card.user_last_name) || dd.card.user_id }}</span>
        </p>
        <div class="confirm-actions">
          <app-button variant="ghost" (click)="cancelDelete()">Отмена</app-button>
          <app-button variant="primary" [disabled]="busyId() === dd.card.id" (click)="doDelete()">
            Удалить
          </app-button>
        </div>
      </app-dialog>
    }`,
  styles: [`
    .filters { display: flex; flex-wrap: wrap; gap: 12px; align-items: end; margin-bottom: var(--space-md); }
    .filters app-input { min-width: 240px; }
    .select { display: flex; flex-direction: column; gap: 6px; font-size: 13px; color: var(--color-muted); }
    .select select {
      height: 44px; padding: 10px 14px;
      border: 1px solid var(--color-hairline);
      border-radius: var(--rounded-md);
      background: var(--color-canvas); color: var(--color-ink);
      font: inherit; min-width: 160px;
    }
    .select select:focus { outline: none; border-color: var(--color-primary); }
    .meta { color: var(--color-muted); font-size: 13px; margin-bottom: 8px; }
    table { width: 100%; border-collapse: collapse; }
    th, td { padding: 10px; text-align: left; border-bottom: 1px solid var(--color-hairline); font-size: 14px; vertical-align: top; }
    th { color: var(--color-muted); font-weight: 500; font-size: 12px; text-transform: uppercase; letter-spacing: 0.04em; }
    code { font-family: var(--font-mono, monospace); }
    .pan-full { white-space: nowrap; }
    .pan-toggle {
      display: block; margin-top: 2px; padding: 0;
      border: none; background: none; cursor: pointer;
      color: var(--color-muted); font-size: 12px; text-decoration: underline;
    }
    .pan-toggle:disabled { opacity: .5; cursor: default; }
    .dim { color: var(--color-muted); }
    .sub { color: var(--color-muted); font-size: 12px; }
    .empty { text-align: center; color: var(--color-muted); padding: 24px; }
    .badge { display: inline-block; padding: 2px 8px; border-radius: var(--rounded-pill); font-size: 12px; background: var(--color-surface-card); }
    .badge.st-active { background: rgba(16,185,129,0.15); color: #047857; }
    .badge.st-frozen { background: rgba(245,158,11,0.15); color: #b45309; }
    .badge.st-closed { background: rgba(239,68,68,0.15); color: #b91c1c; }
    .badge.st-deleted { background: rgba(107,114,128,0.15); color: #4b5563; }
    .badge.st-issuing { background: rgba(59,130,246,0.15); color: #1d4ed8; }
    .pager { display: flex; align-items: center; gap: 12px; margin-top: var(--space-md); justify-content: center; }
    .user-chip {
      display: inline-flex; align-items: center; gap: 8px;
      padding: 6px 10px 6px 14px; margin-bottom: var(--space-md);
      background: var(--color-surface-card); border: 1px solid var(--color-hairline);
      border-radius: var(--rounded-pill); font-size: 13px;
    }
    .chip-clear {
      width: 22px; height: 22px; border-radius: var(--rounded-pill);
      background: var(--color-canvas); color: var(--color-muted);
      font-size: 16px; line-height: 1; border: 1px solid var(--color-hairline);
    }
    .row-actions { white-space: nowrap; }
    .act {
      padding: 6px 12px; border-radius: var(--rounded-md); font: inherit; font-size: 13px;
      border: 1px solid var(--color-hairline); background: var(--color-canvas); cursor: pointer;
    }
    .act:disabled { opacity: .5; cursor: default; }
    .act--freeze { color: #b91c1c; border-color: rgba(239,68,68,0.4); }
    .act--freeze:hover:not(:disabled) { background: rgba(239,68,68,0.08); }
    .act--unfreeze { color: #047857; border-color: rgba(16,185,129,0.4); }
    .act--unfreeze:hover:not(:disabled) { background: rgba(16,185,129,0.08); }
    .act--replace { color: #1d4ed8; border-color: rgba(59,130,246,0.4); margin-left: 6px; }
    .act--replace:hover:not(:disabled) { background: rgba(59,130,246,0.08); }
    .act--delete { color: #b91c1c; border-color: rgba(239,68,68,0.4); margin-left: 6px; }
    .act--delete:hover:not(:disabled) { background: rgba(239,68,68,0.08); }
    /* Выпадашка BIN'а внутри диалога замены — на всю ширину. */
    .select--dialog { margin-bottom: var(--space-md); }
    .select--dialog select { width: 100%; min-width: 0; }
    .confirm-text { margin: 0 0 var(--space-md); line-height: 1.5; }
    .confirm-owner { display: block; margin-top: 8px; color: var(--color-muted); font-size: 13px; }
    .confirm-actions { display: flex; gap: 12px; justify-content: flex-end; }
  `],
})
export class CardsAdminPage implements OnInit {
  private readonly api = inject(AdminApi);
  private readonly cardsApi = inject(CardsApi);
  private readonly auth = inject(AuthService);
  private readonly toast = inject(ToastService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);

  protected readonly meIsAdmin = computed(() => this.auth.user()?.role === 'admin');
  protected readonly items = signal<AdminCard[]>([]);
  protected readonly total = signal(0);
  protected readonly page = signal(1);
  protected readonly pageSize = signal(25);
  protected readonly status = signal('');
  protected readonly productID = signal('');
  protected readonly promoID = signal('');
  protected readonly q = signal('');
  protected readonly products = signal<CardProduct[]>([]);
  protected readonly promos = signal<PromoCode[]>([]);

  // userId — точечный фильтр по владельцу из deep-link /admin/cards?user_id=…
  // (ссылка «Карты» в разделе «Пользователи»). Пустая строка = фильтра нет.
  protected readonly userId = signal('');
  // userFilter — данные для chip'а над таблицей: показываем email/имя владельца,
  // если первая строка выборки совпадает по user_id; иначе — сам id.
  protected readonly userFilter = computed(() => {
    const uid = this.userId();
    if (!uid) return null;
    const row = this.items().find((c) => c.user_id === uid);
    const label = row ? (row.user_email || `${row.user_first_name ?? ''} ${row.user_last_name ?? ''}`.trim() || uid) : uid;
    return { label };
  });

  // confirm — открытый диалог подтверждения заморозки/разморозки (null = закрыт).
  protected readonly confirm = signal<{ card: AdminCard; freeze: boolean } | null>(null);
  // replaceDlg — открытый диалог замены карты: карта + выбранная
  // провайдер-привязка {provider, binId} новой карты (null = закрыт).
  protected readonly replaceDlg = signal<{ card: AdminCard; provider: string; binId: string } | null>(null);
  // deleteDlg — открытый диалог удаления карты без перевыпуска (null = закрыт).
  protected readonly deleteDlg = signal<{ card: AdminCard } | null>(null);
  // replaceRefs — провайдер-привязки продукта карты из открытого диалога
  // замены (выбор, «на какую пару provider+BIN заменяется»). Legacy bins
  // (старый бэк в окно деплоя) конвертируются с provider='buvei'.
  protected readonly replaceRefs = computed<CardProviderRef[]>(() => {
    const rd = this.replaceDlg();
    if (!rd) return [];
    return this.productRefs(this.products().find((pp) => pp.id === rd.card.card_product_id));
  });
  // Провайдеры среди привязок продукта (селект «Провайдер выпуска»).
  protected readonly replaceProviders = computed<string[]>(() => {
    const seen: string[] = [];
    for (const r of this.replaceRefs()) {
      if (r.provider && !seen.includes(r.provider)) seen.push(r.provider);
    }
    return seen;
  });
  // BIN'ы выбранного провайдера.
  protected readonly replaceProviderBins = computed<CardProviderRef[]>(() => {
    const rd = this.replaceDlg();
    if (!rd) return [];
    return this.replaceRefs().filter((r) => r.provider === rd.provider);
  });

  /** Провайдер-привязки продукта: providers, fallback — legacy bins→buvei. */
  private productRefs(p: CardProduct | undefined): CardProviderRef[] {
    if (!p) return [];
    if (p.providers?.length) return p.providers;
    return (p.bins ?? []).map((b) => ({ provider: 'buvei', bin_id: b.bin_id, country: b.country, label: b.label }));
  }
  // busyId — id карты, по которой сейчас идёт запрос (блокирует кнопки от
  // двойного клика).
  protected readonly busyId = signal<string | null>(null);

  // panMap — кеш расшифрованных PAN на сессию (номер карты не меняется,
  // повторный показ не дёргает backend и не плодит audit-записи). Показывается
  // только для карт из revealedPanIds — «скрыть» прячет без потери кеша.
  private readonly panMap = signal<Record<string, string>>({});
  private readonly revealedPanIds = signal<Set<string>>(new Set());
  // panBusyId — карта, по которой сейчас летит POST /admin/cards/:id/details.
  protected readonly panBusyId = signal<string | null>(null);

  // totalPages — округление вверх; защита от деления на 0 (пустая выборка =
  // страница 1, иначе кнопка «Вперёд» останется disabled, но «Назад» тоже).
  protected readonly totalPages = computed(() => {
    const t = this.total();
    const ps = this.pageSize();
    if (t === 0 || ps === 0) return 1;
    return Math.ceil(t / ps);
  });

  // panFor — полный номер карты, если он раскрыт для этой строки.
  protected panFor = (c: AdminCard): string | undefined =>
    this.revealedPanIds().has(c.id) ? this.panMap()[c.id] : undefined;

  protected formatPan(pan: string): string {
    return pan.replace(/\s+/g, '').replace(/(.{4})/g, '$1 ').trim();
  }

  // togglePan — показать/скрыть полный номер карты (кнопка в колонке «Номер»).
  // Первый показ тянет PAN с backend'а, дальше — из кеша.
  togglePan(c: AdminCard): void {
    if (this.revealedPanIds().has(c.id)) {
      this.revealedPanIds.update((s) => {
        const n = new Set(s);
        n.delete(c.id);
        return n;
      });
      return;
    }
    if (this.panMap()[c.id]) {
      this.revealedPanIds.update((s) => new Set(s).add(c.id));
      return;
    }
    if (this.panBusyId()) return;
    this.panBusyId.set(c.id);
    this.api.cardPan(c.id).subscribe({
      next: (r) => {
        this.panMap.update((m) => ({ ...m, [c.id]: r.pan }));
        this.revealedPanIds.update((s) => new Set(s).add(c.id));
        this.panBusyId.set(null);
      },
      error: (e) => {
        this.toast.error(errorMessage(e, 'Не удалось получить номер карты'));
        this.panBusyId.set(null);
      },
    });
  }

  // expiryLabel — срок ДЕЙСТВИЯ карты (MM/YY, напечатан на карте). Не путать со
  // «Срок обсл.» = service_expires_at (оплачено-до по годовому обслуживанию).
  // expiry_year приходит 2-значным (28) или полным (2028) — %100 нормализует к YY.
  protected expiryLabel(c: AdminCard): string {
    const mm = String(c.expiry_month).padStart(2, '0');
    const yy = String(c.expiry_year % 100).padStart(2, '0');
    return `${mm}/${yy}`;
  }

  ngOnInit(): void {
    this.cardsApi.listProducts().subscribe({
      next: (r) => this.products.set(r.products ?? []),
      error: () => {},
    });
    if (this.meIsAdmin()) {
      // Полный список промокодов для выпадашки-фильтра: запрашиваем крупную
      // страницу (бэк режет page_size до 200). Промокодов в системе немного —
      // 200 с запасом; при большем числе часть в фильтр не попадёт.
      this.api.listPromo({ page_size: 200 }).subscribe({
        next: (r) => this.promos.set(r.items ?? []),
        error: () => {},
      });
    }
    // user_id из query (deep-link «Карты» из раздела «Пользователи»).
    this.userId.set(this.route.snapshot.queryParamMap.get('user_id') ?? '');
    this.refresh();
  }

  // refresh — единственный путь к API; читает все текущие signals.
  refresh(): void {
    this.api.listCards({
      page: this.page(),
      page_size: this.pageSize(),
      status: this.status() || undefined,
      card_product_id: this.productID() || undefined,
      promo_code_id: this.promoID() || undefined,
      user_id: this.userId() || undefined,
      q: this.q().trim() || undefined,
    }).subscribe({
      next: (r: AdminCardsResponse) => {
        this.items.set(r.items ?? []);
        this.total.set(r.total ?? 0);
      },
      error: (e) => this.toast.error(errorMessage(e, 'Не удалось загрузить карты')),
    });
  }

  // clearUserFilter — снимает deep-link-фильтр по владельцу и чистит query из URL.
  clearUserFilter(): void {
    this.userId.set('');
    this.router.navigate([], { relativeTo: this.route, queryParams: {} });
    this.page.set(1);
    this.refresh();
  }

  // ----- Точечная заморозка/разморозка -----

  askFreeze(card: AdminCard): void { this.confirm.set({ card, freeze: true }); }
  askUnfreeze(card: AdminCard): void { this.confirm.set({ card, freeze: false }); }
  cancelConfirm(): void { this.confirm.set(null); }

  // doConfirm — выполняет выбранное действие. Точечно обновляет статус карты в
  // текущей выборке (без полного refresh), чтобы не терять страницу/скролл.
  doConfirm(): void {
    const cf = this.confirm();
    if (!cf || this.busyId()) return;
    const { card, freeze } = cf;
    this.busyId.set(card.id);
    const req = freeze ? this.api.freezeCard(card.id) : this.api.unfreezeCard(card.id);
    req.subscribe({
      next: (res) => {
        this.items.update((list) =>
          list.map((c) => (c.id === res.id ? { ...c, status: res.status, frozen_by_admin: res.frozen_by_admin } : c)),
        );
        this.toast.success(freeze ? 'Карта заморожена' : 'Карта разморожена');
        this.busyId.set(null);
        this.confirm.set(null);
      },
      error: (e) => {
        this.toast.error(errorMessage(e, freeze ? 'Не удалось заморозить карту' : 'Не удалось разморозить карту'));
        this.busyId.set(null);
        this.confirm.set(null);
      },
    });
  }

  // ----- Замена карты (admin-only) -----

  // askReplace — открывает диалог замены. Предвыбор: первая привязка
  // продукта, отличная от текущего BIN'а карты (замена обычно на другой);
  // если другой нет — первая.
  askReplace(card: AdminCard): void {
    const refs = this.productRefs(this.products().find((pp) => pp.id === card.card_product_id));
    const other = refs.find((r) => r.bin_id !== card.issuer_bin_id);
    const pick = other ?? refs[0];
    this.replaceDlg.set({ card, provider: pick?.provider ?? 'buvei', binId: pick?.bin_id ?? '' });
  }
  cancelReplace(): void { this.replaceDlg.set(null); }
  // Смена провайдера предвыбирает его первый BIN (пары {provider, bin}
  // валидируются бэком fail-closed — чужой BIN не отправить).
  setReplaceProvider(provider: string): void {
    this.replaceDlg.update((rd) => {
      if (!rd) return rd;
      const first = this.replaceRefs().find((r) => r.provider === provider);
      return { ...rd, provider, binId: first?.bin_id ?? '' };
    });
  }
  setReplaceBin(binId: string): void {
    this.replaceDlg.update((rd) => (rd ? { ...rd, binId } : rd));
  }
  // binLabel — подпись BIN'а в выпадашке: метка (или сам id) + страна.
  protected binLabel(b: CardProviderRef): string {
    return (b.label || b.bin_id) + (b.country ? ` · ${b.country}` : '');
  }
  // productCurrency — валюта карты (для суммы переносимого баланса в диалоге).
  protected productCurrency(c: AdminCard): string {
    return this.products().find((pp) => pp.id === c.card_product_id)?.card_currency ?? '';
  }

  // doReplace — выполняет замену: старая карта в выборке помечается deleted,
  // новая появится в списке после card.issued (заявка видна в «Заявках»).
  doReplace(): void {
    const rd = this.replaceDlg();
    if (!rd || !rd.binId || this.busyId()) return;
    this.busyId.set(rd.card.id);
    this.api.replaceCard(rd.card.id, rd.provider, rd.binId).subscribe({
      next: (res) => {
        this.items.update((list) =>
          list.map((c) => (c.id === res.id ? { ...c, status: res.status, balance: 0 } : c)),
        );
        this.toast.success('Карта удалена, новая выпускается');
        this.busyId.set(null);
        this.replaceDlg.set(null);
      },
      error: (e) => {
        this.toast.error(errorMessage(e, 'Не удалось заменить карту'));
        this.busyId.set(null);
        this.replaceDlg.set(null);
      },
    });
  }

  // ----- Удаление карты (admin-only) -----

  askDelete(card: AdminCard): void { this.deleteDlg.set({ card }); }
  cancelDelete(): void { this.deleteDlg.set(null); }

  doDelete(): void {
    const dd = this.deleteDlg();
    if (!dd || this.busyId()) return;
    this.busyId.set(dd.card.id);
    this.api.deleteCard(dd.card.id).subscribe({
      next: (res) => {
        this.items.update((list) =>
          list.map((c) => (c.id === res.id ? { ...c, status: res.status, balance: 0 } : c)),
        );
        this.toast.success('Карта удалена');
        this.busyId.set(null);
        this.deleteDlg.set(null);
      },
      error: (e) => {
        this.toast.error(errorMessage(e, 'Не удалось удалить карту'));
        this.busyId.set(null);
        this.deleteDlg.set(null);
      },
    });
  }

  // apply — сбрасывает страницу в 1 (фильтры изменились — текущий offset
  // может быть пуст) и перечитывает.
  apply(): void {
    this.page.set(1);
    this.refresh();
  }

  reset(): void {
    this.q.set('');
    this.status.set('');
    this.productID.set('');
    this.promoID.set('');
    this.pageSize.set(25);
    // «Сбросить» очищает и deep-link-фильтр по пользователю — иначе панель
    // фильтров выглядит пустой, а список молча остаётся суженным до одного юзера.
    this.userId.set('');
    this.router.navigate([], { relativeTo: this.route, queryParams: {} });
    this.page.set(1);
    this.refresh();
  }

  setPageSize(v: string): void {
    const n = parseInt(v, 10);
    if (!isNaN(n) && n > 0) {
      this.pageSize.set(n);
      this.page.set(1);
      this.refresh();
    }
  }

  prev(): void {
    if (this.page() > 1) {
      this.page.set(this.page() - 1);
      this.refresh();
    }
  }

  next(): void {
    if (this.page() < this.totalPages()) {
      this.page.set(this.page() + 1);
      this.refresh();
    }
  }
}
