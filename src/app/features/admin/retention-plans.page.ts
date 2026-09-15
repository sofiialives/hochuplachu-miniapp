import { Component, OnInit, inject, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { Router } from '@angular/router';
import { AdminApi, RetentionPlanRow } from '../../core/api/admin.api';
import { ButtonComponent } from '../../ui/button.component';
import { InputComponent } from '../../ui/input.component';
import { DialogComponent } from '../../ui/dialog.component';
import { ToggleComponent } from '../../ui/toggle.component';
import { ToastService } from '../../core/notifications/toast.service';
import { errorMessage } from '../../core/errors/api-error';
import { DURATION_UNITS, DurationUnit, humanizeMinutes, toMinutes } from './retention-duration';

// Список retention-планов. Создание — только имя + интервал (план рождается
// НЕАКТИВНЫМ); шаги настраиваются в редакторе (/admin/retention/plans/:id).
@Component({
  selector: 'app-retention-plans',
  standalone: true,
  imports: [ButtonComponent, InputComponent, DialogComponent, ToggleComponent, DatePipe],
  template: `<h1>Планы вовлечения</h1>
    <div class="toolbar">
      <app-button variant="primary" (clicked)="openCreate()">+ Новый план</app-button>
    </div>

    <table>
      <thead><tr><th>Название</th><th>Статус</th><th>Интервал запуска</th><th>Шагов</th><th>Юзеров в прогоне</th><th>Последний запуск</th><th></th></tr></thead>
      <tbody>
        @for (row of items(); track row.plan.id) {
          <tr class="row" (click)="openPlan(row)">
            <td class="name">{{ row.plan.name }}</td>
            <td (click)="$event.stopPropagation()">
              <app-toggle [checked]="row.plan.active"
                [label]="row.plan.active ? 'Активен' : 'Выключен'"
                (toggled)="setActive(row, $event)" />
            </td>
            <td>{{ humanize(row.plan.interval_minutes) }}</td>
            <td>{{ row.steps_count }}</td>
            <td>{{ row.users_count }}</td>
            <td>{{ row.plan.last_run_at ? (row.plan.last_run_at | date: 'dd.MM.yyyy HH:mm') : '—' }}</td>
            <td (click)="$event.stopPropagation()">
              <button class="link" (click)="openPlan(row)">открыть</button>
              <button class="link red" (click)="remove(row)">удалить</button>
            </td>
          </tr>
        } @empty {
          <tr><td colspan="7" class="empty">Планов пока нет — создайте первый</td></tr>
        }
      </tbody>
    </table>

    @if (creating()) {
      <app-dialog title="Новый план" (dismissed)="creating.set(false)">
        <app-input [(value)]="nameC" label="Название плана" placeholder="Например: Догоняем не купивших" />
        <label class="field">
          <span>Интервал запуска (как часто воркер прогоняет план)</span>
          <div class="duration">
            <input type="number" min="1" [value]="intervalValueC()" (input)="intervalValueC.set($any($event.target).value)" />
            <select [value]="intervalUnitC()" (change)="intervalUnitC.set($any($event.target).value)">
              @for (u of units; track u.id) { <option [value]="u.id" [selected]="u.id === intervalUnitC()">{{ u.label }}</option> }
            </select>
          </div>
        </label>
        <p class="hint">План создаётся выключенным: настройте шаги в редакторе и включите его там же.</p>
        <app-button variant="primary" [full]="true" (clicked)="create()">Создать</app-button>
      </app-dialog>
    }`,
  styles: [`
    .toolbar { display: flex; gap: 12px; margin: var(--space-sm) 0 var(--space-md); }
    table { width: 100%; border-collapse: collapse; margin-top: var(--space-md); }
    th, td { padding: 10px; text-align: left; border-bottom: 1px solid var(--color-hairline); }
    .row { cursor: pointer; }
    .row:hover { background: var(--color-surface-card); }
    .name { font-weight: 600; }
    .badge { padding: 3px 10px; border-radius: 999px; font-size: 12px; background: var(--color-surface-card); color: var(--color-muted); border: 1px solid var(--color-hairline); }
    .badge.on { background: var(--color-success-bg, #e7f5ee); color: var(--color-success, #198754); border-color: transparent; }
    .empty { text-align: center; color: var(--color-muted); padding: 24px; }
    .link { color: var(--color-primary-ink); margin-right: 8px; background: none; border: none; cursor: pointer; padding: 0; font: inherit; }
    .link.red { color: var(--color-error); }
    .field { display: flex; flex-direction: column; gap: 6px; margin: var(--space-sm) 0; font-size: 13px; color: var(--color-muted); }
    .duration { display: flex; gap: 8px; }
    .duration input, .duration select {
      padding: 10px 12px; border: 1px solid var(--color-hairline); border-radius: var(--rounded-md);
      background: var(--color-canvas); color: var(--color-ink); font: inherit;
    }
    .duration input { width: 110px; }
    .duration input:focus, .duration select:focus { outline: none; border-color: var(--color-primary); }
    .hint { font-size: 13px; color: var(--color-muted); }
  `],
})
export class RetentionPlansPage implements OnInit {
  private readonly api = inject(AdminApi);
  private readonly toast = inject(ToastService);
  private readonly router = inject(Router);

  protected readonly units = DURATION_UNITS;
  protected readonly items = signal<RetentionPlanRow[]>([]);
  protected readonly creating = signal(false);
  protected readonly nameC = signal('');
  protected readonly intervalValueC = signal('1');
  protected readonly intervalUnitC = signal<DurationUnit>('hours');

  ngOnInit(): void { this.refresh(); }

  refresh(): void {
    this.api.listRetentionPlans().subscribe({
      next: (r) => this.items.set(r.items ?? []),
      error: (e) => this.toast.error(errorMessage(e, 'Не удалось загрузить планы')),
    });
  }

  protected humanize(minutes: number): string { return humanizeMinutes(minutes); }

  openCreate(): void {
    this.creating.set(true);
    this.nameC.set('');
    this.intervalValueC.set('1');
    this.intervalUnitC.set('hours');
  }

  create(): void {
    const interval = toMinutes(this.intervalValueC(), this.intervalUnitC());
    if (!this.nameC().trim()) { this.toast.error('Укажите название плана'); return; }
    if (interval <= 0) { this.toast.error('Интервал должен быть больше нуля'); return; }
    this.api.createRetentionPlan({ name: this.nameC().trim(), interval_minutes: interval }).subscribe({
      next: (p) => {
        this.creating.set(false);
        this.router.navigate(['/admin/retention/plans', p.id]);
      },
      error: (e) => this.toast.error(errorMessage(e, 'Не удалось создать план')),
    });
  }

  openPlan(row: RetentionPlanRow): void {
    this.router.navigate(['/admin/retention/plans', row.plan.id]);
  }

  setActive(row: RetentionPlanRow, active: boolean): void {
    this.api.updateRetentionPlan(row.plan.id, { active }).subscribe({
      next: () => { this.toast.success(active ? 'План включён' : 'План выключен'); this.refresh(); },
      error: (e) => this.toast.error(errorMessage(e, 'Не удалось переключить план')),
    });
  }

  remove(row: RetentionPlanRow): void {
    if (!confirm(`Удалить план «${row.plan.name}»? Шаги и прогресс юзеров будут удалены.`)) return;
    this.api.deleteRetentionPlan(row.plan.id).subscribe({
      next: () => { this.toast.success('План удалён'); this.refresh(); },
      error: (e) => this.toast.error(errorMessage(e, 'Не удалось удалить план')),
    });
  }
}
