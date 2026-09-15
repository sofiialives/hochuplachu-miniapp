import { Component, OnDestroy, computed, effect, inject, input, output, signal } from '@angular/core';
import { AdminApi, ProductImportJob, ProviderMeta } from '../../core/api/admin.api';
import { ButtonComponent } from '../../ui/button.component';
import { InputComponent } from '../../ui/input.component';
import { ToastService } from '../../core/notifications/toast.service';
import { errorMessage } from '../../core/errors/api-error';

/** Как часто опрашиваем прогресс идущего прогона. */
const POLL_MS = 3000;

/**
 * Панель импорта каталога провайдера (eSIM-тарифы / гифткарты и пополнения).
 *
 * Импорт — фоновая джоба на бэкенде: каталог провайдера это сотни позиций, и
 * синхронный запрос отвалился бы по таймауту. Поэтому здесь только запуск и
 * поллинг прогресса; по завершении — событие `finished`, по которому страница
 * перечитывает список продуктов.
 */
@Component({
  selector: 'app-product-import',
  standalone: true,
  imports: [ButtonComponent, InputComponent],
  template: `
    <div class="panel">
      <p class="hint">
        Заводит продукты по всему каталогу выбранного провайдера: гифткарты и пополнения
        (Steam, Telegram Stars) — одним прогоном. Цена импортированных позиций всегда
        <b>динамическая</b>: себестоимость берётся у провайдера в долларах, умножается на курс и
        наценку, и округляется вниз до ближайшей «девятки»; у пополнений так же считается цена
        одной единицы зачисления, а «девятку» получает уже итог заявки. Повторный импорт обновляет
        только свои позиции — заведённые руками не трогает, а исчезнувшие у провайдера снимает
        с продажи.
      </p>

      <div class="row">
        <label class="fld">
          <span class="lbl">Провайдер</span>
          <select [value]="provider()" (change)="provider.set($any($event.target).value)">
            @for (p of importable(); track p.code) {
              <option [value]="p.code" [selected]="p.code === provider()">{{ p.title }}</option>
            } @empty {
              <option value="">— нет провайдеров с настроенным адресом —</option>
            }
          </select>
        </label>
        <app-input class="fld" [(value)]="markup" inputmode="decimal" label="Наценка, %" placeholder="30" />
        <app-button variant="primary" [loading]="starting()" [disabled]="!provider() || running()"
          (clicked)="start()">Импортировать</app-button>
      </div>

      <p class="hint hint--keep">
        Окно можно закрыть — импорт идёт на сервере и продолжится сам. Открыв его снова,
        вы увидите текущее состояние прогона.
      </p>

      @if (current(); as j) {
        <div class="job" [class.job--failed]="j.status === 'failed'">
          <div class="job-head">
            <b>{{ providerTitle(j.provider) }}</b>
            <span class="status status--{{ j.status }}">{{ statusLabel(j) }}</span>
          </div>
          @if (j.status === 'running') {
            <div class="bar"><div class="bar-fill" [style.width.%]="percent(j)"></div></div>
          }
          <p class="counts">
            обработано {{ j.processed }}@if (j.total) { / {{ j.total }} } ·
            создано {{ j.created }} · обновлено {{ j.updated }} ·
            пропущено {{ j.skipped }} · снято с продажи {{ j.disabled }}
            @if (j.failed) { · <span class="err">ошибок {{ j.failed }}</span> }
          </p>
          @if (j.error) { <p class="err">{{ j.error }}</p> }
        </div>
      }
    </div>
  `,
  styles: [`
    .hint { margin: 0 0 var(--space-sm); font-size: 12px; color: var(--color-muted); line-height: 1.45; }
    .hint--keep { margin: var(--space-sm) 0 0; }
    .row { display: flex; gap: 12px; align-items: flex-end; flex-wrap: wrap; }
    .fld { flex: 1 1 180px; min-width: 160px; }
    .lbl { display: block; font-size: 12px; color: var(--color-muted); margin-bottom: 6px; }
    select {
      width: 100%; height: 40px; padding: 0 10px;
      border: 1px solid var(--color-hairline); border-radius: var(--rounded-sm, 6px);
      background: var(--color-canvas); color: var(--color-ink); font: inherit; font-size: 14px;
    }
    .job { margin-top: var(--space-sm); padding: 10px 12px; border: 1px dashed var(--color-hairline); border-radius: var(--rounded-md); }
    .job--failed { border-color: var(--color-error); }
    .job-head { display: flex; gap: 8px; align-items: center; justify-content: space-between; font-size: 13px; }
    .status { font-size: 12px; color: var(--color-muted); }
    .status--done { color: var(--color-success, #198754); }
    .status--failed { color: var(--color-error); }
    .bar { height: 6px; border-radius: 999px; background: var(--color-hairline); margin: 8px 0; overflow: hidden; }
    .bar-fill { height: 100%; background: var(--color-primary); transition: width .3s ease; }
    .counts { margin: 6px 0 0; font-size: 12px; color: var(--color-muted); }
    .err { color: var(--color-error); font-size: 12px; margin: 4px 0 0; }
  `],
})
export class ProductImportComponent implements OnDestroy {
  private readonly api = inject(AdminApi);
  private readonly toast = inject(ToastService);

  /** 'esim' | 'service' — что импортируем. */
  readonly productType = input.required<'esim' | 'service'>();
  /** Провайдеры типа продукта (из /admin/providers/meta). */
  readonly providers = input<ProviderMeta[]>([]);
  /** Прогон завершился — странице пора перечитать продукты. */
  readonly finished = output<void>();

  protected readonly provider = signal('');
  protected readonly markup = signal('30');
  protected readonly starting = signal(false);
  protected readonly current = signal<ProductImportJob | null>(null);
  protected readonly running = computed(() => this.current()?.status === 'running');

  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    // Провайдеры приезжают асинхронно — как только появились, выбираем первый
    // пригодный и подхватываем незавершённый прогон (оператор мог обновить
    // страницу посреди импорта).
    effect(() => {
      const list = this.importable();
      if (list.length && !list.some((p) => p.code === this.provider())) {
        this.provider.set(list[0].code);
      }
    });
    effect(() => {
      const type = this.productType();
      if (type) this.loadLast(type);
    });
  }

  ngOnDestroy(): void { this.stopPolling(); }

  /** Импортировать можно только у провайдера с настроенным адресом сервиса;
   *  для сервис-продуктов — ещё и умеющего гифткарты (у playbot их нет). */
  protected readonly importable = computed<ProviderMeta[]>(() =>
    this.providers().filter((p) => p.configured
      && (this.productType() !== 'service' || (p.service_kinds ?? []).includes('gift_card'))));

  protected providerTitle(code: string): string {
    return this.providers().find((p) => p.code === code)?.title ?? code;
  }

  protected percent(j: ProductImportJob): number {
    if (!j.total) return 5; // каталог ещё вычитывается — показываем «что-то идёт»
    return Math.min(100, Math.round((j.processed / j.total) * 100));
  }

  protected statusLabel(j: ProductImportJob): string {
    if (j.status === 'running') return 'идёт…';
    return j.status === 'done' ? 'завершён' : 'ошибка';
  }

  private loadLast(productType: string): void {
    this.api.listProductImports(productType).subscribe({
      next: (r) => {
        const job = (r.jobs ?? [])[0] ?? null;
        this.current.set(job);
        if (job?.status === 'running') this.schedulePoll(job.id);
      },
      error: () => { /* панель импорта не критична — молча */ },
    });
  }

  protected start(): void {
    const markup = parseFloat(this.markup());
    if (!(markup >= 0)) { this.toast.error('Укажите наценку в процентах'); return; }
    this.starting.set(true);
    this.api.startProductImport({
      product_type: this.productType(),
      provider: this.provider(),
      markup_pct: markup,
    }).subscribe({
      next: (job) => {
        this.starting.set(false);
        this.current.set(job);
        this.schedulePoll(job.id);
      },
      error: (e: unknown) => {
        this.starting.set(false);
        this.toast.error(errorMessage(e, 'Не удалось запустить импорт'));
      },
    });
  }

  private schedulePoll(id: string): void {
    this.stopPolling();
    this.timer = setTimeout(() => this.poll(id), POLL_MS);
  }

  private poll(id: string): void {
    this.api.getProductImport(id).subscribe({
      next: (job) => {
        this.current.set(job);
        if (job.status === 'running') {
          this.schedulePoll(id);
          return;
        }
        // Прогон закончился: сообщаем странице и подводим итог оператору.
        this.finished.emit();
        if (job.status === 'done') {
          this.toast.success(`Импорт завершён: создано ${job.created}, обновлено ${job.updated}`);
        } else {
          this.toast.error(job.error || 'Импорт завершился с ошибкой');
        }
      },
      // Сеть моргнула — не бросаем поллинг, пробуем ещё раз.
      error: () => this.schedulePoll(id),
    });
  }

  private stopPolling(): void {
    if (this.timer) { clearTimeout(this.timer); this.timer = null; }
  }
}
