import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { AdminApi, AdminUser, ProductBrief, RetentionActionParams, RetentionPlan, RetentionStep, RetentionStepCondition, RetentionSystemParam, RetentionTestState, RetentionTypeMeta } from '../../core/api/admin.api';
import { ButtonComponent } from '../../ui/button.component';
import { InputComponent } from '../../ui/input.component';
import { DialogComponent } from '../../ui/dialog.component';
import { ToggleComponent } from '../../ui/toggle.component';
import { ToastService } from '../../core/notifications/toast.service';
import { errorMessage } from '../../core/errors/api-error';
import { DURATION_UNITS, DurationUnit, fromMinutes, humanizeMinutes, toMinutes } from './retention-duration';

/** Черновик инлайн-условия в диалоге шага (длительность — значение+единица). */
interface CondDraft {
  type: string;
  elapsedValue: string;
  elapsedUnit: DurationUnit;
}

// Редактор retention-плана: настройки плана (имя/интервал/активность),
// последовательность шагов (кондишены + действие с параметрами) и тест-режим
// (прогон шагов по конкретному юзеру без проверки кондишенов, отправки
// реальные). Формы действий строятся по /admin/retention/meta.
@Component({
  selector: 'app-retention-plan-edit',
  standalone: true,
  imports: [ButtonComponent, InputComponent, DialogComponent, ToggleComponent, RouterLink, DatePipe],
  template: `
    <a class="back" routerLink="/admin/retention">‹ к планам</a>
    @if (plan(); as p) {
      <div class="head">
        <h1>{{ p.name }}</h1>
        <app-toggle [checked]="p.active"
          [label]="p.active ? 'Активен' : 'Выключен'"
          (toggled)="setPlanActive($event)" />
      </div>

      <section class="panel">
        <h2>Настройки плана</h2>
        <div class="settings">
          <app-input [(value)]="nameC" label="Название" />
          <label class="field">
            <span>Интервал запуска</span>
            <div class="duration">
              <input type="number" min="1" [value]="intervalValueC()" (input)="intervalValueC.set($any($event.target).value)" />
              <select [value]="intervalUnitC()" (change)="intervalUnitC.set($any($event.target).value)">
                @for (u of units; track u.id) { <option [value]="u.id" [selected]="u.id === intervalUnitC()">{{ u.label }}</option> }
              </select>
            </div>
          </label>
          <label class="field">
            <span>Защита входа от других планов (0 = выключена)</span>
            <div class="duration">
              <input type="number" min="0" [value]="guardValueC()" (input)="guardValueC.set($any($event.target).value)" />
              <select [value]="guardUnitC()" (change)="guardUnitC.set($any($event.target).value)">
                @for (u of units; track u.id) { <option [value]="u.id" [selected]="u.id === guardUnitC()">{{ u.label }}</option> }
              </select>
            </div>
          </label>
        </div>
        <p class="hint">Защита входа: пользователь, получавший уведомление другого плана за указанное время, не войдёт в этот план, пока время с того уведомления не истечёт. На уже вошедших не влияет.</p>
        <div class="settings-actions">
          <app-button variant="primary" (clicked)="saveSettings()">Сохранить</app-button>
          <span class="spacer"></span>
          <app-button variant="secondary" (clicked)="openTest()">🧪 Тестирование</app-button>
        </div>
        @if (p.last_run_at) {
          <p class="hint">Последний запуск: {{ p.last_run_at | date: 'dd.MM.yyyy HH:mm' }}</p>
        }
      </section>

      <section class="panel">
        <h2>Шаги</h2>
        <p class="hint">Пользователь проходит шаги строго по порядку: входит в план через шаг 1 и двигается вниз, когда выполняются кондишены следующего шага. Параметры (например, сгенерированный промокод) перетекают по шагам сверху вниз.</p>
        <div class="steps">
          @for (s of steps(); track s.id; let i = $index) {
            <div class="step" [class.off]="s.active === false">
              <div class="step-num">{{ i + 1 }}</div>
              <div class="step-body">
                <div class="step-title">
                  <strong>{{ actionLabel(s.action_type) }}</strong>
                  @if (s.name) { <span class="step-name">— {{ s.name }}</span> }
                  @if (s.active === false) { <span class="off-note">выключен — пропускается</span> }
                </div>
                <div class="step-summary">{{ actionSummary(s) }}</div>
                <div class="chips">
                  @for (c of s.conditions ?? []; track $index) {
                    <span class="chip">{{ condSummary(c) }}</span>
                  } @empty {
                    <span class="chip none">без кондишенов — все юзеры предыдущего шага</span>
                  }
                </div>
              </div>
              <div class="step-actions">
                <app-toggle [checked]="s.active !== false"
                  (toggled)="setStepActive(s, $event)" />
                <button class="icon" [disabled]="i === 0" (click)="move(i, -1)" title="Выше">↑</button>
                <button class="icon" [disabled]="i === steps().length - 1" (click)="move(i, 1)" title="Ниже">↓</button>
                <button class="icon" (click)="editStep(s, i)" title="Изменить">✎</button>
                <button class="icon" (click)="copyStep(s)" title="Копировать в новый шаг">⧉</button>
                <button class="icon red" (click)="removeStep(s)" title="Удалить">✕</button>
              </div>
            </div>
          } @empty {
            <div class="empty">Шагов пока нет</div>
          }
        </div>
        <app-button variant="primary" (clicked)="addStep()">+ Добавить шаг</app-button>
      </section>
    }

    <!-- ===== Диалог шага ===== -->
    @if (stepDialog(); as sd) {
      <app-dialog [title]="sd.step ? 'Шаг ' + (sd.index + 1) : 'Новый шаг'" (dismissed)="stepDialog.set(null)">
        <app-input [(value)]="stepNameC" label="Название шага (опционально)" placeholder="Например: Напомнить про карту" />

        <div class="group">
          <span class="group-label">Условия отбора (все должны выполняться; пусто = все юзеры предыдущего шага)</span>
          @for (c of condsC(); track $index; let ci = $index) {
            <div class="cond-row">
              <select [value]="c.type" (change)="setCondType(ci, $any($event.target).value)">
                @for (t of conditionTypes(); track t.type) { <option [value]="t.type" [selected]="t.type === c.type">{{ t.label }}</option> }
              </select>
              @if (condNeedsElapsed(c.type)) {
                <input type="number" min="1" [value]="c.elapsedValue" (input)="setCondElapsed(ci, $any($event.target).value)" />
                <select [value]="c.elapsedUnit" (change)="setCondUnit(ci, $any($event.target).value)">
                  @for (u of units; track u.id) { <option [value]="u.id" [selected]="u.id === c.elapsedUnit">{{ u.label }}</option> }
                </select>
              }
              <button type="button" class="icon red" (click)="removeCond(ci)" title="Убрать условие">✕</button>
            </div>
            @if (condDescription(c.type); as d) { <p class="hint cond-hint">{{ d }}</p> }
          }
          <button type="button" class="add-cond" (click)="addCond()">+ Добавить условие</button>
        </div>

        <label class="field">
          <span>Действие</span>
          <select [value]="actionTypeC()" (change)="actionTypeC.set($any($event.target).value)">
            @for (t of actionTypes(); track t.type) { <option [value]="t.type" [selected]="t.type === actionTypeC()">{{ t.label }}</option> }
          </select>
        </label>
        @if (selectedActionMeta(); as meta) { <p class="hint">{{ meta.description }}</p> }

        @switch (actionTypeC()) {
          @case ('notify') {
            <div class="field">
              <span>Текст уведомления (Telegram-разметка, поддерживаются emoji)</span>
              <div class="fmt-bar">
                <button type="button" class="fmt" title="Жирный" (click)="wrapTag(textArea, 'text', 'b')"><b>B</b></button>
                <button type="button" class="fmt" title="Курсив" (click)="wrapTag(textArea, 'text', 'i')"><i>I</i></button>
                <button type="button" class="fmt" title="Подчёркнутый" (click)="wrapTag(textArea, 'text', 'u')"><u>U</u></button>
                <button type="button" class="fmt" title="Зачёркнутый" (click)="wrapTag(textArea, 'text', 's')"><s>S</s></button>
                <button type="button" class="fmt mono" title="Моноширинный (код)" (click)="wrapTag(textArea, 'text', 'code')">&lt;/&gt;</button>
              </div>
              <textarea #textArea rows="5" [value]="textC()" (input)="textC.set($any($event.target).value)"></textarea>
              @if (placeholderParams().length) {
                <div class="chips">
                  <span class="chips-label">Вставить параметр:</span>
                  @for (name of placeholderParams(); track name) {
                    <button type="button" class="chip param" [title]="paramHint(name)" (click)="insertParam(textArea, 'text', name)">{{ '{{' + name + '}}' }}</button>
                  }
                </div>
              }
            </div>
            <app-input [(value)]="subjectC" label="Заголовок письма (только email; пусто = стандартный)" placeholder="Например: Ваш промокод внутри" />
            <app-input [(value)]="buttonTextC" label="Кнопка (опционально)" placeholder="Например: Показать промокод" />
            @if (buttonTextC().trim()) {
              <label class="field">
                <span>Действие кнопки</span>
                <select [value]="buttonKindC()" (change)="buttonKindC.set($any($event.target).value)">
                  <option value="reply" [selected]="buttonKindC() === 'reply'">Ответ в чате</option>
                  <option value="url" [selected]="buttonKindC() === 'url'">Открыть приложение по ссылке</option>
                </select>
              </label>
            }
            @if (buttonTextC().trim() && buttonKindC() === 'url') {
              <app-input [(value)]="buttonUrlC" label="URL приложения (https:// или tg://)" placeholder="https://t.me/bot/app" />
              <p class="hint">В Telegram кнопка откроет приложение (Mini App); в письме станет кнопкой-ссылкой.</p>
            }
            @if (buttonTextC().trim() && buttonKindC() === 'reply') {
              <div class="field">
                <span>Ответ на нажатие кнопки (юзерам без Telegram уходит сразу в письме)</span>
                <div class="fmt-bar">
                  <button type="button" class="fmt" title="Жирный" (click)="wrapTag(replyArea, 'reply', 'b')"><b>B</b></button>
                  <button type="button" class="fmt" title="Курсив" (click)="wrapTag(replyArea, 'reply', 'i')"><i>I</i></button>
                  <button type="button" class="fmt" title="Подчёркнутый" (click)="wrapTag(replyArea, 'reply', 'u')"><u>U</u></button>
                  <button type="button" class="fmt" title="Зачёркнутый" (click)="wrapTag(replyArea, 'reply', 's')"><s>S</s></button>
                  <button type="button" class="fmt mono" title="Моноширинный (код)" (click)="wrapTag(replyArea, 'reply', 'code')">&lt;/&gt;</button>
                </div>
                <textarea #replyArea rows="4" [value]="buttonReplyC()" (input)="buttonReplyC.set($any($event.target).value)"></textarea>
                @if (placeholderParams().length) {
                  <div class="chips">
                    <span class="chips-label">Вставить параметр:</span>
                    @for (name of placeholderParams(); track name) {
                      <button type="button" class="chip param" [title]="paramHint(name)" (click)="insertParam(replyArea, 'reply', name)">{{ '{{' + name + '}}' }}</button>
                    }
                  </div>
                }
              </div>
            }
          }
          @case ('create_promo') {
            <app-input [(value)]="outputParamC" label="Имя выходного параметра (латиница/цифры/_)" placeholder="promo" />
            <app-input [(value)]="promoAmountC" inputmode="decimal" label="Сумма скидки" />
            <app-input [(value)]="promoCurrencyC" label="Валюта скидки" />
            <label class="field">
              <span>Область применения</span>
              <select [value]="promoScopeC()" (change)="promoScopeC.set($any($event.target).value)">
                <option value="issue">issue — выпуск карты</option>
                <option value="topup">topup — пополнение / продление</option>
                <option value="any">any — любая операция</option>
              </select>
            </label>
            @if (promoTypeSupported()) {
              <!-- Тип продукта кода — рендерится только если meta бэка отдаёт
                   параметр product_type у create_promo (динамика, как остальные
                   формы действий). -->
              <label class="field">
                <span>Тип продукта кода</span>
                <select [value]="promoProductTypeC()" (change)="setPromoProductType($any($event.target).value)">
                  <option value="card" [selected]="promoProductTypeC() === 'card'">card — карты</option>
                  <option value="esim" [selected]="promoProductTypeC() === 'esim'">esim — eSIM</option>
                  <option value="service" [selected]="promoProductTypeC() === 'service'">service — сервисы</option>
                  <option value="any" [selected]="promoProductTypeC() === 'any'">any — все типы</option>
                </select>
              </label>
            }
            <app-input [(value)]="promoMaxUsagesC" inputmode="numeric" label="Количество использований (0 = безлимит)" />
            <app-input [(value)]="promoMinAmountC" inputmode="decimal" label="Действует от суммы (0 = любая), в валюте кода" />
            <label class="field">
              <span>Срок жизни кода (0 = бессрочный)</span>
              <div class="duration">
                <input type="number" min="0" [value]="promoExpiresValueC()" (input)="promoExpiresValueC.set($any($event.target).value)" />
                <select [value]="promoExpiresUnitC()" (change)="promoExpiresUnitC.set($any($event.target).value)">
                  @for (u of units; track u.id) { <option [value]="u.id" [selected]="u.id === promoExpiresUnitC()">{{ u.label }}</option> }
                </select>
              </div>
            </label>
            @if (promoProductTypeC() !== 'any') {
              <div class="group">
                <span class="group-label">Для каких продуктов (пусто = все продукты типа)</span>
                @for (prod of promoFormProducts(); track prod.id) {
                  <label class="check">
                    <input type="checkbox" [checked]="productSelected(prod.id)" (change)="toggleProduct(prod.id)" />
                    {{ prod.name }}
                  </label>
                } @empty {
                  <span class="hint">Продуктов этого типа пока нет</span>
                }
              </div>
            } @else {
              <p class="hint">Тип «any»: код действует на все продукты — ограничение по продуктам недоступно.</p>
            }
          }
          @case ('deactivate_promo') {
            <label class="field">
              <span>Входной параметр с промокодом</span>
              @if (availableParams().length) {
                <select [value]="inputParamC()" (change)="inputParamC.set($any($event.target).value)">
                  <option value="">— выберите —</option>
                  @for (name of availableParams(); track name) { <option [value]="name" [selected]="name === inputParamC()">{{ name }}</option> }
                </select>
              } @else {
                <p class="hint warn">Выше нет шага «Создать персональный промокод» — деактивировать будет нечего.</p>
              }
            </label>
          }
        }

        <app-button variant="primary" [full]="true" (clicked)="saveStep()">Сохранить шаг</app-button>
      </app-dialog>
    }

    <!-- ===== Диалог тестирования ===== -->
    @if (testOpen()) {
      <app-dialog title="Тестирование плана" (dismissed)="testOpen.set(false)">
        <p class="hint">Шаги выполняются для выбранного пользователя <b>без проверки кондишенов</b>. Отправки и промокоды — настоящие.</p>
        @if (!testUser()) {
          <app-input [(value)]="testQueryC" label="Пользователь (поиск: email / имя / telegram id)" placeholder="Начните вводить…" />
          <app-button variant="secondary" (clicked)="searchTestUsers()">Найти</app-button>
          <div class="user-list">
            @for (u of testUsers(); track u.id) {
              <button type="button" class="user-row" (click)="pickTestUser(u)">
                <span>{{ userLabel(u) }}</span>
                <span class="muted">{{ u.id }}</span>
              </button>
            }
          </div>
        } @else {
          <div class="picked">
            <span>{{ userLabel(testUser()!) }}</span>
            <button class="link" (click)="resetPickedUser()">сменить</button>
          </div>
          @if (testState(); as st) {
            <div class="test-state">
              @if (st.next_position > 0) {
                <p>Следующий шаг: <b>{{ st.next_position }} из {{ st.steps_total }}</b>
                  @if (stepAt(st.next_position); as s) { — {{ actionLabel(s.action_type) }} }
                </p>
              } @else {
                <p><b>Все {{ st.steps_total }} шагов пройдены.</b></p>
              }
              @if (paramEntries(st).length) {
                <div class="params">
                  <span class="group-label">Накопленные параметры:</span>
                  @for (e of paramEntries(st); track e[0]) {
                    <div class="param-row"><code>{{ e[0] }}</code> = <code>{{ e[1] }}</code></div>
                  }
                </div>
              }
            </div>
            <div class="test-actions">
              <app-button variant="primary" [disabled]="st.next_position === 0" [loading]="testRunning()" (clicked)="runTestStep()">
                ▶ Выполнить шаг {{ st.next_position || '' }}
              </app-button>
              <app-button variant="ghost" (clicked)="resetTest()">Сбросить прогон</app-button>
            </div>
          }
        }
      </app-dialog>
    }`,
  styles: [`
    .back { color: var(--color-muted); text-decoration: none; font-size: 14px; }
    .head { display: flex; align-items: center; gap: 12px; margin: var(--space-sm) 0 var(--space-md); }
    .head h1 { margin: 0; }
    .badge { padding: 3px 10px; border-radius: 999px; font-size: 12px; background: var(--color-surface-card); color: var(--color-muted); border: 1px solid var(--color-hairline); }
    .badge.on { background: var(--color-success-bg, #e7f5ee); color: var(--color-success, #198754); border-color: transparent; }
    .panel { background: var(--color-surface-card); border: 1px solid var(--color-hairline); border-radius: var(--rounded-lg, 12px); padding: var(--space-lg); margin-bottom: var(--space-lg); }
    .panel h2 { margin-top: 0; }
    /* Поля настроек — сетка с выравниванием по верху: обе колонки одинаковой
       структуры (label 13px + gap 6px + контрол 44px), ничего не «пляшет». */
    .settings { display: grid; grid-template-columns: minmax(240px, 400px) auto; gap: 16px; align-items: start; justify-content: start; }
    .settings .field { margin: 0; }
    @media (max-width: 640px) { .settings { grid-template-columns: 1fr; } }
    /* Действия — отдельным рядом под полями, «Тестирование» прижато вправо. */
    .settings-actions {
      display: flex; align-items: center; gap: 8px; flex-wrap: wrap;
      margin-top: var(--space-md); padding-top: var(--space-md);
      border-top: 1px solid var(--color-hairline);
    }
    .settings-actions .spacer { flex: 1; }
    .field { display: flex; flex-direction: column; gap: 6px; margin: var(--space-sm) 0; font-size: 13px; color: var(--color-muted); }
    .field select, .field textarea {
      padding: 10px 12px; border: 1px solid var(--color-hairline); border-radius: var(--rounded-md);
      background: var(--color-canvas); color: var(--color-ink); font: inherit; resize: vertical;
    }
    .field select:focus, .field textarea:focus { outline: none; border-color: var(--color-primary); }
    .duration { display: flex; gap: 8px; }
    .duration input, .duration select {
      padding: 10px 12px; border: 1px solid var(--color-hairline); border-radius: var(--rounded-md);
      background: var(--color-canvas); color: var(--color-ink); font: inherit;
    }
    .duration input { width: 110px; }
    .duration input:focus, .duration select:focus { outline: none; border-color: var(--color-primary); }
    .hint { font-size: 13px; color: var(--color-muted); }
    .hint.warn { color: var(--color-error); }
    .fmt-bar { display: flex; gap: 4px; }
    .fmt {
      min-width: 32px; height: 30px; padding: 0 8px;
      border: 1px solid var(--color-hairline); border-radius: var(--rounded-sm);
      background: var(--color-canvas); color: var(--color-ink);
      cursor: pointer; font-size: 13px;
    }
    .fmt:hover { border-color: var(--color-primary); color: var(--color-primary-ink); }
    .fmt.mono { font-family: monospace; }

    .steps { display: flex; flex-direction: column; gap: 12px; margin: var(--space-md) 0; }
    .step { display: flex; gap: 14px; align-items: flex-start; background: var(--color-canvas); border: 1px solid var(--color-hairline); border-radius: var(--rounded-md); padding: 14px 16px; }
    .step-num {
      flex: 0 0 32px; width: 32px; height: 32px; border-radius: 50%;
      background: var(--color-primary); color: var(--color-on-primary);
      display: flex; align-items: center; justify-content: center; font-weight: 600;
    }
    .step-body { flex: 1; min-width: 0; }
    .step-title { margin-bottom: 4px; }
    .step-name { color: var(--color-muted); }
    .step.off .step-num, .step.off .step-body { opacity: .45; }
    .off-note { margin-left: 8px; font-size: 12px; color: var(--color-error); }
    .step-actions app-toggle { margin-right: 6px; align-self: center; }
    .step-summary { font-size: 13px; color: var(--color-muted); white-space: pre-line; overflow-wrap: anywhere; margin-bottom: 8px; }
    .chips { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; margin-top: 6px; }
    .chips-label { font-size: 12px; color: var(--color-muted); }
    .chip { font-size: 12px; padding: 3px 10px; border-radius: 999px; background: var(--color-surface-card); border: 1px solid var(--color-hairline); }
    .chip.none { color: var(--color-muted); border-style: dashed; }
    .chip.param { cursor: pointer; color: var(--color-primary-ink); font-family: monospace; }
    .step-actions { display: flex; gap: 4px; }
    .icon { background: none; border: 1px solid var(--color-hairline); border-radius: var(--rounded-sm); width: 30px; height: 30px; cursor: pointer; color: var(--color-ink); }
    .icon:disabled { opacity: .35; cursor: default; }
    .icon.red { color: var(--color-error); }
    .empty { text-align: center; color: var(--color-muted); padding: 24px; }

    .group { display: flex; flex-direction: column; gap: 6px; margin: var(--space-sm) 0; }
    .group-label { font-size: 13px; color: var(--color-muted); }
    .check { display: flex; gap: 8px; align-items: center; font-size: 14px; }
    .cond-row { display: flex; gap: 8px; align-items: center; }
    .cond-row select, .cond-row input {
      padding: 10px 12px; border: 1px solid var(--color-hairline); border-radius: var(--rounded-md);
      background: var(--color-canvas); color: var(--color-ink); font: inherit;
    }
    .cond-row input { width: 90px; }
    .cond-row select:focus, .cond-row input:focus { outline: none; border-color: var(--color-primary); }
    .cond-hint { margin: 0 0 4px; }
    .add-cond { align-self: flex-start; color: var(--color-primary-ink); background: none; border: none; cursor: pointer; padding: 4px 0; font: inherit; font-size: 14px; }

    .user-list { display: flex; flex-direction: column; gap: 4px; margin-top: 8px; max-height: 240px; overflow: auto; }
    .user-row {
      display: flex; justify-content: space-between; gap: 12px; text-align: left;
      padding: 8px 10px; border: 1px solid var(--color-hairline); border-radius: var(--rounded-sm);
      background: var(--color-canvas); cursor: pointer; font: inherit;
    }
    .user-row:hover { border-color: var(--color-primary); }
    .muted { color: var(--color-muted); font-size: 12px; }
    .picked { display: flex; gap: 10px; align-items: center; margin-bottom: 8px; font-weight: 600; }
    .link { color: var(--color-primary-ink); background: none; border: none; cursor: pointer; padding: 0; font: inherit; }
    .test-state { background: var(--color-canvas); border: 1px solid var(--color-hairline); border-radius: var(--rounded-md); padding: 12px 14px; margin: 10px 0; }
    .params { margin-top: 8px; }
    .param-row { font-size: 13px; }
    .test-actions { display: flex; gap: 8px; flex-wrap: wrap; }
  `],
})
export class RetentionPlanEditPage implements OnInit {
  private readonly api = inject(AdminApi);
  private readonly toast = inject(ToastService);
  private readonly route = inject(ActivatedRoute);

  protected readonly units = DURATION_UNITS;
  protected readonly plan = signal<RetentionPlan | null>(null);
  protected readonly steps = signal<RetentionStep[]>([]);
  protected readonly conditionTypes = signal<RetentionTypeMeta[]>([]);
  protected readonly actionTypes = signal<RetentionTypeMeta[]>([]);
  protected readonly systemParams = signal<RetentionSystemParam[]>([]);
  /** Краткие списки продуктов per тип (brief) — мультиселект create_promo. */
  protected readonly briefs = signal<Record<string, ProductBrief[]>>({});

  // Настройки плана
  protected readonly nameC = signal('');
  protected readonly intervalValueC = signal('1');
  protected readonly intervalUnitC = signal<DurationUnit>('hours');
  // Защита входа от других планов (entry_guard_minutes), 0 = выключена.
  protected readonly guardValueC = signal('0');
  protected readonly guardUnitC = signal<DurationUnit>('days');

  // Диалог шага
  protected readonly stepDialog = signal<{ step: RetentionStep | null; index: number } | null>(null);
  protected readonly stepNameC = signal('');
  // Черновики инлайн-условий шага (длительность — значение+единица).
  protected readonly condsC = signal<CondDraft[]>([]);
  protected readonly actionTypeC = signal('notify');
  protected readonly textC = signal('');
  // Тема email-письма notify-шага (Telegram темы не имеет; пусто = дефолт бэка).
  protected readonly subjectC = signal('');
  protected readonly buttonTextC = signal('');
  // Вид кнопки: reply — текст-ответ на нажатие, url — открытие приложения.
  protected readonly buttonKindC = signal<'reply' | 'url'>('reply');
  protected readonly buttonReplyC = signal('');
  protected readonly buttonUrlC = signal('');
  protected readonly outputParamC = signal('promo');
  protected readonly promoAmountC = signal('');
  protected readonly promoCurrencyC = signal('USDT');
  protected readonly promoScopeC = signal('issue');
  protected readonly promoMaxUsagesC = signal('1');
  protected readonly promoMinAmountC = signal('0');
  protected readonly promoExpiresValueC = signal('0');
  protected readonly promoExpiresUnitC = signal<DurationUnit>('days');
  protected readonly promoProductIdsC = signal<string[]>([]);
  /** Тип продукта кода create_promo (card|esim|service|any; пусто у бэка = card). */
  protected readonly promoProductTypeC = signal('card');
  protected readonly inputParamC = signal('');

  /** Селект типа рендерится, только если meta бэка отдаёт параметр
   *  product_type у create_promo (старый бэк его не понимает). */
  protected readonly promoTypeSupported = computed(() =>
    (this.actionTypes().find((t) => t.type === 'create_promo')?.params ?? [])
      .some((p) => p.key === 'product_type'));

  /** Продукты выбранного типа для мультиселекта create_promo. */
  protected readonly promoFormProducts = computed<ProductBrief[]>(() =>
    this.briefs()[this.promoProductTypeC()] ?? []);

  /** Смена типа сбрасывает выбранные продукты — id чужого типа невалидны. */
  protected setPromoProductType(pt: string): void {
    if (pt === this.promoProductTypeC()) return;
    this.promoProductTypeC.set(pt);
    this.promoProductIdsC.set([]);
  }

  // Тест-режим
  protected readonly testOpen = signal(false);
  protected readonly testQueryC = signal('');
  protected readonly testUsers = signal<AdminUser[]>([]);
  protected readonly testUser = signal<AdminUser | null>(null);
  protected readonly testState = signal<RetentionTestState | null>(null);
  protected readonly testRunning = signal(false);

  protected readonly selectedActionMeta = computed(() =>
    this.actionTypes().find((t) => t.type === this.actionTypeC()));

  // Доступные параметры для редактируемого шага: выходные параметры
  // create_promo-шагов ВЫШЕ по порядку (параметры текут сверху вниз).
  protected readonly availableParams = computed(() => {
    const dialog = this.stepDialog();
    if (!dialog) return [];
    const upTo = dialog.step ? dialog.index : this.steps().length;
    const names: string[] = [];
    this.steps().slice(0, upTo).forEach((s) => {
      const out = s.action_params?.output_param;
      if (s.action_type === 'create_promo' && out && !names.includes(out)) names.push(out);
    });
    return names;
  });

  // Чипы плейсхолдеров текста: системные параметры (доступны в любом плане
  // без настройки, значение подставляется из юзера при отправке) + параметры
  // шагов выше. В выпадашку deactivate_promo системные НЕ попадают — там
  // нужен именно параметр с промокодом (availableParams).
  protected readonly placeholderParams = computed(() => {
    const names = this.systemParams().map((p) => p.name);
    for (const n of this.availableParams()) {
      if (!names.includes(n)) names.push(n);
    }
    return names;
  });

  // Тултип чипа: для системного параметра — его описание с бэка, для
  // параметра шага — откуда он взялся.
  paramHint(name: string): string {
    const sys = this.systemParams().find((p) => p.name === name);
    return sys ? `${sys.label}. ${sys.description}` : 'Параметр из шага «Создать персональный промокод» выше';
  }

  private planId = '';

  ngOnInit(): void {
    this.planId = this.route.snapshot.paramMap.get('id') ?? '';
    this.api.retentionMeta().subscribe({
      next: (m) => {
        this.actionTypes.set(m.action_types ?? []);
        this.conditionTypes.set(m.condition_types ?? []);
        this.systemParams.set(m.system_params ?? []);
      },
      error: (e) => this.toast.error(errorMessage(e, 'Не удалось загрузить типы кондишенов/действий')),
    });
    for (const pt of ['card', 'esim', 'service']) {
      this.api.productsBrief(pt).subscribe({
        next: (r) => this.briefs.update((m) => ({ ...m, [pt]: r.items ?? [] })),
        error: () => undefined,
      });
    }
    this.refresh();
  }

  refresh(): void {
    this.api.getRetentionPlan(this.planId).subscribe({
      next: (r) => {
        this.plan.set(r.plan);
        this.steps.set(r.steps ?? []);
        this.nameC.set(r.plan.name);
        const { value, unit } = fromMinutes(r.plan.interval_minutes);
        this.intervalValueC.set(String(value));
        this.intervalUnitC.set(unit);
        const guard = fromMinutes(r.plan.entry_guard_minutes ?? 0);
        this.guardValueC.set(String(guard.value));
        this.guardUnitC.set(r.plan.entry_guard_minutes ? guard.unit : 'days');
      },
      error: (e) => this.toast.error(errorMessage(e, 'Не удалось загрузить план')),
    });
  }

  // ----- Настройки плана -----

  saveSettings(): void {
    const interval = toMinutes(this.intervalValueC(), this.intervalUnitC());
    if (!this.nameC().trim() || interval <= 0) {
      this.toast.error('Проверьте название и интервал');
      return;
    }
    this.api.updateRetentionPlan(this.planId, {
      name: this.nameC().trim(),
      interval_minutes: interval,
      entry_guard_minutes: toMinutes(this.guardValueC(), this.guardUnitC()) || 0,
    }).subscribe({
      next: () => { this.toast.success('Сохранено'); this.refresh(); },
      error: (e) => this.toast.error(errorMessage(e, 'Не удалось сохранить')),
    });
  }

  setPlanActive(active: boolean): void {
    this.api.updateRetentionPlan(this.planId, { active }).subscribe({
      next: () => { this.toast.success(active ? 'План включён' : 'План выключен'); this.refresh(); },
      error: (e) => this.toast.error(errorMessage(e, 'Не удалось переключить план')),
    });
  }

  setStepActive(s: RetentionStep, active: boolean): void {
    this.api.updateRetentionStep(s.id!, { active }).subscribe({
      next: () => { this.toast.success(active ? 'Шаг включён' : 'Шаг выключен — будет пропускаться'); this.refresh(); },
      error: (e) => this.toast.error(errorMessage(e, 'Не удалось переключить шаг')),
    });
  }

  // ----- Шаги -----

  // condSummary — человекочитаемое описание инлайн-условия для чипа шага.
  condSummary(c: RetentionStepCondition): string {
    const label = this.conditionTypes().find((t) => t.type === c.type)?.label ?? c.type;
    const elapsed = c.params?.elapsed_minutes ?? 0;
    return elapsed ? `${label} ≥ ${humanizeMinutes(elapsed)}` : label;
  }

  condNeedsElapsed(type: string): boolean {
    return (this.conditionTypes().find((t) => t.type === type)?.params ?? [])
      .some((p) => p.key === 'elapsed_minutes');
  }

  condDescription(type: string): string {
    return this.conditionTypes().find((t) => t.type === type)?.description ?? '';
  }

  addCond(): void {
    const first = this.conditionTypes()[0]?.type ?? '';
    this.condsC.update((list) => [...list, { type: first, elapsedValue: '3', elapsedUnit: 'days' }]);
  }
  removeCond(i: number): void {
    this.condsC.update((list) => list.filter((_, idx) => idx !== i));
  }
  setCondType(i: number, type: string): void {
    this.condsC.update((list) => list.map((c, idx) => idx === i ? { ...c, type } : c));
  }
  setCondElapsed(i: number, value: string): void {
    this.condsC.update((list) => list.map((c, idx) => idx === i ? { ...c, elapsedValue: value } : c));
  }
  setCondUnit(i: number, unit: DurationUnit): void {
    this.condsC.update((list) => list.map((c, idx) => idx === i ? { ...c, elapsedUnit: unit } : c));
  }

  actionLabel(type: string): string {
    return this.actionTypes().find((t) => t.type === type)?.label ?? type;
  }

  actionSummary(s: RetentionStep): string {
    const p = s.action_params ?? {};
    switch (s.action_type) {
      case 'notify': {
        let out = this.truncate(p.text ?? '', 160);
        if (p.button_text) out += `\nКнопка: «${p.button_text}»${p.button_url ? ` → ${p.button_url}` : ''}`;
        return out;
      }
      case 'create_promo': {
        const parts = [
          `{{${p.output_param}}} = код на ${p.discount_amount} ${p.discount_currency}`,
          `scope: ${p.scope}`,
          `использований: ${p.max_usages || '∞'}`,
        ];
        if (p.min_amount) parts.push(`от суммы ${p.min_amount} ${p.discount_currency}`);
        if (p.expires_minutes) parts.push(`срок: ${humanizeMinutes(p.expires_minutes)}`);
        parts.push(p.product_ids?.length ? `продуктов: ${p.product_ids.length}` : 'все продукты');
        return parts.join(' · ');
      }
      case 'deactivate_promo':
        return `деактивирует код из {{${p.input_param}}} (код остаётся в базе для статистики)`;
    }
    return '';
  }

  private truncate(s: string, n: number): string {
    return s.length > n ? s.slice(0, n) + '…' : s;
  }

  addStep(): void {
    this.stepDialog.set({ step: null, index: this.steps().length });
    this.stepNameC.set('');
    this.condsC.set([]);
    this.actionTypeC.set('notify');
    this.textC.set('');
    this.subjectC.set('');
    this.buttonTextC.set('');
    this.buttonKindC.set('reply');
    this.buttonReplyC.set('');
    this.buttonUrlC.set('');
    this.outputParamC.set('promo');
    this.promoAmountC.set('');
    this.promoCurrencyC.set('USDT');
    this.promoScopeC.set('issue');
    this.promoMaxUsagesC.set('1');
    this.promoMinAmountC.set('0');
    this.promoExpiresValueC.set('0');
    this.promoExpiresUnitC.set('days');
    this.promoProductIdsC.set([]);
    this.promoProductTypeC.set('card');
    this.inputParamC.set('');
  }

  editStep(s: RetentionStep, index: number): void {
    this.stepDialog.set({ step: s, index });
    this.fillFormFromStep(s);
  }

  // Копия шага: открывает диалог создания нового шага (в конец плана),
  // форма предзаполнена данными шага-донора.
  copyStep(s: RetentionStep): void {
    this.stepDialog.set({ step: null, index: this.steps().length });
    this.fillFormFromStep(s);
  }

  private fillFormFromStep(s: RetentionStep): void {
    const p = s.action_params ?? {};
    this.stepNameC.set(s.name ?? '');
    this.condsC.set((s.conditions ?? []).map((c) => {
      const { value, unit } = fromMinutes(c.params?.elapsed_minutes ?? 0);
      return { type: c.type, elapsedValue: String(value || 3), elapsedUnit: value ? unit : 'days' };
    }));
    this.actionTypeC.set(s.action_type);
    this.textC.set(p.text ?? '');
    this.subjectC.set(p.subject ?? '');
    this.buttonTextC.set(p.button_text ?? '');
    this.buttonKindC.set(p.button_url ? 'url' : 'reply');
    this.buttonReplyC.set(p.button_reply ?? '');
    this.buttonUrlC.set(p.button_url ?? '');
    this.outputParamC.set(p.output_param ?? 'promo');
    this.promoAmountC.set(p.discount_amount != null ? String(p.discount_amount) : '');
    this.promoCurrencyC.set(p.discount_currency ?? 'USDT');
    this.promoScopeC.set(p.scope ?? 'issue');
    this.promoMaxUsagesC.set(String(p.max_usages ?? 1));
    this.promoMinAmountC.set(String(p.min_amount ?? 0));
    const { value, unit } = fromMinutes(p.expires_minutes ?? 0);
    this.promoExpiresValueC.set(String(value));
    this.promoExpiresUnitC.set(p.expires_minutes ? unit : 'days');
    this.promoProductIdsC.set([...(p.product_ids ?? [])]);
    // Пустой тип у старых шагов = card (дефолт бэка).
    this.promoProductTypeC.set(p.product_type || 'card');
    this.inputParamC.set(p.input_param ?? '');
  }

  productSelected(id: string): boolean { return this.promoProductIdsC().includes(id); }
  toggleProduct(id: string): void {
    this.promoProductIdsC.update((ids) => ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]);
  }

  // Оборачивает выделенный в textarea текст в Telegram-HTML тег (кнопки
  // B/I/U/S/код). Без выделения вставляет пару тегов и ставит курсор между
  // ними. field указывает, какой сигнал синхронизировать.
  wrapTag(area: HTMLTextAreaElement, field: 'text' | 'reply', tag: string): void {
    const open = `<${tag}>`;
    const close = `</${tag}>`;
    const start = area.selectionStart ?? area.value.length;
    const end = area.selectionEnd ?? area.value.length;
    const selected = area.value.slice(start, end);
    const next = area.value.slice(0, start) + open + selected + close + area.value.slice(end);
    if (field === 'text') this.textC.set(next); else this.buttonReplyC.set(next);
    setTimeout(() => {
      area.focus();
      if (selected) {
        area.selectionStart = start;
        area.selectionEnd = end + open.length + close.length;
      } else {
        area.selectionStart = area.selectionEnd = start + open.length;
      }
    });
  }

  // Вставка {{param}} в позицию курсора textarea. field указывает, какой
  // сигнал синхронизировать (value textarea управляется сигналом).
  insertParam(area: HTMLTextAreaElement, field: 'text' | 'reply', name: string): void {
    const token = `{{${name}}}`;
    const start = area.selectionStart ?? area.value.length;
    const end = area.selectionEnd ?? area.value.length;
    const next = area.value.slice(0, start) + token + area.value.slice(end);
    if (field === 'text') this.textC.set(next); else this.buttonReplyC.set(next);
    // Возвращаем фокус и курсор за вставленный токен.
    setTimeout(() => {
      area.focus();
      area.selectionStart = area.selectionEnd = start + token.length;
    });
  }

  saveStep(): void {
    const dialog = this.stepDialog();
    if (!dialog) return;
    const actionType = this.actionTypeC();
    let params: RetentionActionParams;
    switch (actionType) {
      case 'notify': {
        if (!this.textC().trim()) { this.toast.error('Текст уведомления обязателен'); return; }
        const btnText = this.buttonTextC().trim();
        const isUrlKind = btnText !== '' && this.buttonKindC() === 'url';
        const btnUrl = this.buttonUrlC().trim();
        if (isUrlKind && !btnUrl) { this.toast.error('Укажите URL приложения для кнопки'); return; }
        if (isUrlKind && !/^(https:\/\/|tg:\/\/)/.test(btnUrl)) { this.toast.error('URL кнопки должен начинаться с https:// или tg://'); return; }
        params = {
          text: this.textC().trim(),
          subject: this.subjectC().trim(),
          button_text: btnText,
          button_reply: btnText && !isUrlKind ? this.buttonReplyC().trim() : '',
          button_url: isUrlKind ? btnUrl : '',
        };
        break;
      }
      case 'create_promo': {
        const amount = parseFloat(this.promoAmountC());
        if (!(amount > 0)) { this.toast.error('Сумма скидки должна быть больше нуля'); return; }
        params = {
          output_param: this.outputParamC().trim(),
          discount_amount: amount,
          discount_currency: this.promoCurrencyC().trim(),
          scope: this.promoScopeC(),
          max_usages: parseInt(this.promoMaxUsagesC(), 10) || 0,
          min_amount: parseFloat(this.promoMinAmountC()) || 0,
          expires_minutes: toMinutes(this.promoExpiresValueC(), this.promoExpiresUnitC()),
          // Для 'any' ограничение по продуктам не имеет смысла.
          product_ids: this.promoProductTypeC() === 'any' ? [] : this.promoProductIdsC(),
        };
        // product_type шлём только когда meta бэка его знает (старый бэк
        // отверг бы шаг валидацией параметров).
        if (this.promoTypeSupported()) params.product_type = this.promoProductTypeC();
        break;
      }
      case 'deactivate_promo':
        if (!this.inputParamC().trim()) { this.toast.error('Выберите входной параметр'); return; }
        params = { input_param: this.inputParamC().trim() };
        break;
      default:
        return;
    }
    const conditions: RetentionStepCondition[] = [];
    for (const c of this.condsC()) {
      if (this.condNeedsElapsed(c.type)) {
        const minutes = toMinutes(c.elapsedValue, c.elapsedUnit);
        if (minutes <= 0) { this.toast.error('Укажите время в условии больше нуля'); return; }
        conditions.push({ type: c.type, params: { elapsed_minutes: minutes } });
      } else {
        conditions.push({ type: c.type, params: {} });
      }
    }
    const body: Partial<RetentionStep> = {
      name: this.stepNameC().trim(),
      conditions,
      action_type: actionType,
      action_params: params,
    };
    const obs = dialog.step
      ? this.api.updateRetentionStep(dialog.step.id!, body)
      : this.api.createRetentionStep(this.planId, body);
    obs.subscribe({
      next: () => { this.toast.success('Шаг сохранён'); this.stepDialog.set(null); this.refresh(); },
      error: (e) => this.toast.error(errorMessage(e, 'Не удалось сохранить шаг')),
    });
  }

  move(index: number, delta: number): void {
    const ids = this.steps().map((s) => s.id!);
    const target = index + delta;
    if (target < 0 || target >= ids.length) return;
    [ids[index], ids[target]] = [ids[target], ids[index]];
    this.api.reorderRetentionSteps(this.planId, ids).subscribe({
      next: (r) => this.steps.set(r.steps ?? []),
      error: (e) => this.toast.error(errorMessage(e, 'Не удалось изменить порядок')),
    });
  }

  removeStep(s: RetentionStep): void {
    if (!confirm('Удалить шаг?')) return;
    this.api.deleteRetentionStep(s.id!).subscribe({
      next: () => { this.toast.success('Шаг удалён'); this.refresh(); },
      error: (e) => this.toast.error(errorMessage(e, 'Не удалось удалить шаг')),
    });
  }

  // ----- Тест-режим -----

  openTest(): void {
    this.testOpen.set(true);
    this.testQueryC.set('');
    this.testUsers.set([]);
    this.testUser.set(null);
    this.testState.set(null);
  }

  searchTestUsers(): void {
    this.api.listUsers({ q: this.testQueryC(), page: 1, page_size: 10 }).subscribe({
      next: (r) => this.testUsers.set(r.items ?? []),
      error: (e) => this.toast.error(errorMessage(e, 'Не удалось найти пользователей')),
    });
  }

  userLabel(u: AdminUser): string {
    const name = [u.first_name, u.last_name].filter(Boolean).join(' ');
    return u.email || name || (u.telegram_id ? `tg:${u.telegram_id}` : u.id);
  }

  pickTestUser(u: AdminUser): void {
    this.testUser.set(u);
    this.loadTestState();
  }

  resetPickedUser(): void {
    this.testUser.set(null);
    this.testState.set(null);
  }

  loadTestState(): void {
    const u = this.testUser();
    if (!u) return;
    this.api.retentionTestState(this.planId, u.id).subscribe({
      next: (st) => this.testState.set(st),
      error: (e) => this.toast.error(errorMessage(e, 'Не удалось загрузить состояние теста')),
    });
  }

  stepAt(position: number): RetentionStep | undefined {
    return this.steps()[position - 1];
  }

  paramEntries(st: RetentionTestState): [string, string][] {
    return Object.entries(st.progress?.params ?? {});
  }

  runTestStep(): void {
    const u = this.testUser();
    if (!u) return;
    this.testRunning.set(true);
    this.api.retentionTestStep(this.planId, u.id).subscribe({
      next: (st) => {
        this.testRunning.set(false);
        this.testState.set(st);
        this.toast.success('Шаг выполнен');
      },
      error: (e) => {
        this.testRunning.set(false);
        this.toast.error(errorMessage(e, 'Не удалось выполнить шаг'));
      },
    });
  }

  resetTest(): void {
    const u = this.testUser();
    if (!u) return;
    if (!confirm('Сбросить тест-прогон для этого пользователя?')) return;
    this.api.retentionTestReset(this.planId, u.id).subscribe({
      next: () => { this.toast.success('Тест сброшен'); this.loadTestState(); },
      error: (e) => this.toast.error(errorMessage(e, 'Не удалось сбросить тест')),
    });
  }
}
