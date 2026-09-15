import { Component, inject, input, output, signal } from '@angular/core';
import { AdminApi, ProviderMeta } from '../../core/api/admin.api';
import { ToggleComponent } from '../../ui/toggle.component';
import { ToastService } from '../../core/notifications/toast.service';
import { errorMessage } from '../../core/errors/api-error';

// Блок «Провайдеры» страниц eSIM-/Сервис-продуктов: тумблеры provider_states
// per product_type (PATCH /admin/providers/:productType/:provider). Для card
// бэк отдаёт read_only=true — тумблер не показывается (fail-open секции
// каталога, карточное направление не самовыключается). Провайдер без
// настроенного SERVICE_URL помечается: его каталог-прокси в формах недоступен
// (деньги всё равно ходят через MQ — это только справочный HTTP).
@Component({
  selector: 'app-provider-toggles',
  standalone: true,
  imports: [ToggleComponent],
  template: `<section class="providers">
    <h2>Провайдеры</h2>
    @for (p of providers(); track p.code) {
      <div class="prow" [class.off]="!p.enabled">
        <div class="pinfo">
          <span class="ptitle">{{ p.title }}</span>
          <code class="pcode">{{ p.code }}</code>
          @if (p.configured === false) {
            <span class="badge warn" title="SERVICE_URL провайдер-сервиса не задан на бэке — селекты каталога будут недоступны">каталог не настроен</span>
          }
          @if (p.topup_currencies?.length) {
            <span class="badge">{{ p.topup_currencies!.join(', ') }}</span>
          }
        </div>
        @if (p.read_only) {
          <span class="state">{{ p.enabled ? 'включён' : 'выключен' }}</span>
        } @else {
          <app-toggle [checked]="p.enabled" [disabled]="busy() === p.code"
            (toggled)="toggle(p, $event)" />
        }
      </div>
    } @empty {
      <p class="empty">Провайдеров для этого типа продукта нет</p>
    }
  </section>`,
  styles: [`
    .providers {
      border: 1px solid var(--color-hairline); border-radius: var(--rounded-lg, 12px);
      background: var(--color-surface-card);
      padding: var(--space-md) var(--space-lg); margin-bottom: var(--space-lg);
    }
    .providers h2 { margin: 0 0 var(--space-sm); font-size: 16px; }
    .prow {
      display: flex; align-items: center; justify-content: space-between; gap: 12px;
      padding: 8px 0; border-top: 1px solid color-mix(in srgb, var(--color-hairline) 60%, transparent);
    }
    .prow:first-of-type { border-top: none; }
    .prow.off .pinfo { opacity: .55; }
    .pinfo { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
    .ptitle { font-weight: 600; }
    .pcode { font-family: var(--font-mono, monospace); font-size: 12px; color: var(--color-muted); }
    .badge {
      padding: 2px 8px; border-radius: 999px; font-size: 11px;
      background: var(--color-canvas); border: 1px solid var(--color-hairline); color: var(--color-muted);
    }
    .badge.warn {
      background: color-mix(in srgb, var(--color-warning, #f59e0b) 12%, transparent);
      color: var(--color-warning, #b45309); border-color: transparent;
    }
    .state { font-size: 13px; color: var(--color-muted); }
    .empty { color: var(--color-muted); font-size: 13px; margin: 0; }
  `],
})
export class ProviderTogglesComponent {
  private readonly api = inject(AdminApi);
  private readonly toast = inject(ToastService);

  /** Тип продукта блока (esim | service | card). */
  readonly productType = input.required<string>();
  /** Провайдеры типа из GET /admin/providers/meta (владеет родитель). */
  readonly providers = input<ProviderMeta[]>([]);
  /** Успешное переключение — родитель обновляет свою копию меты. */
  readonly enabledChange = output<{ code: string; enabled: boolean }>();

  /** Код провайдера, по которому летит PATCH ('' — никакой). */
  protected readonly busy = signal('');

  protected toggle(p: ProviderMeta, enabled: boolean): void {
    if (this.busy()) return;
    this.busy.set(p.code);
    this.api.setProviderEnabled(this.productType(), p.code, enabled).subscribe({
      next: (r) => {
        this.busy.set('');
        this.enabledChange.emit({ code: r.provider, enabled: r.enabled });
        this.toast.success(`${p.title}: ${r.enabled ? 'включён' : 'выключен'}`);
      },
      error: (e: unknown) => {
        this.busy.set('');
        // Состояние тумблера придёт из инпута родителя — визуально откатится.
        this.enabledChange.emit({ code: p.code, enabled: p.enabled });
        this.toast.error(errorMessage(e, 'Не удалось переключить провайдера'));
      },
    });
  }
}
