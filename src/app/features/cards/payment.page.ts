import { Component, OnInit, OnDestroy, computed, inject, signal } from '@angular/core';
import { Location } from '@angular/common';
import { ActivatedRoute, Router } from '@angular/router';
import { Observable, map } from 'rxjs';
import { QRCodeComponent } from 'angularx-qrcode';
import { OrdersApi, Order, TopUp, ServiceRenewal, BillStatus, storeIssuingOrderId } from '../../core/api/orders.api';
import { EsimApi, EsimOrder, EsimRecharge } from '../../core/api/esim.api';
import { ServicesApi, ServiceKind, ServiceOrder, orderGross, topupAmountLabel } from '../../core/api/services.api';
import { KycApi } from '../../core/api/kyc.api';
import { BackBarComponent } from '../../ui/back-bar.component';
import { ButtonComponent } from '../../ui/button.component';
import { CopyButtonComponent } from '../../ui/copy-button.component';
import { EsimInstallComponent } from '../esim/esim-install.component';
import { CcRequisitesComponent } from './cc-requisites.component';
import { symbolFor, formatAmount } from '../../core/currency/currency-symbols';
import { isSbpProvider } from '../../core/currency/currency.service';
import { openExternalLink } from '../../core/utils/open-external';
import { formatReferralAmount } from '../../core/referral/referral-format';
import { ToastService } from '../../core/notifications/toast.service';
import { AnalyticsService } from '../../core/analytics/analytics.service';

// PaymentPage — единая страница оплаты payable-заявки любого типа. Тип
// задаётся route data:{orderKind} + уникальным именем param'а — дискриминация
// по наличию param'ов (как раньше) ломалась при добавлении новых типов
// (renewal уходил в orders.reschedule с пустым id).
//
// Дескриптор типа (KindOps) описывает get/reschedule/bill и семантику
// статусов; успех/обработка/провал у типов разные:
//   card:          paid|issuing|issued = успех (карта доделывается в ЛК)
//   topup:         paid|topping_up|topped_up = успех
//   renewal:       paid|completed = успех; reschedule НЕДОСТУПЕН (у бэка нет
//                  POST /renewals/:id/reschedule — прежний код с пустым id
//                  был багом)
//   esim:          paid = «выпускаем» (поллинг до ТЕРМИНАЛЬНОГО); issued =
//                  успех (QR + инструкция)
//   esim_recharge: paid = «продлеваем»; done = успех
//   service:       paid|processing = «обрабатываем»; completed = успех
//                  (gift_card — коды по кнопке; account_topup — «Аккаунт
//                  пополнен»)
// С терминального экрана новых типов — переход на страницу заказа.
//
// Тексты предупреждений cc-оплаты — дословный перенос из coincat-fe.
type OrderKind = 'card' | 'topup' | 'renewal' | 'esim' | 'esim_recharge' | 'service';

type AnyPayable = Order | TopUp | ServiceRenewal | EsimOrder | EsimRecharge | ServiceOrder;

interface KindOps {
  param: string;
  get: (id: string) => Observable<AnyPayable>;
  /** Возобновление истёкшей cc-заявки; отсутствует у renewal. */
  reschedule?: (id: string) => Observable<AnyPayable>;
  uploadBill: (id: string, file: File) => Observable<unknown>;
  billStatus: (id: string) => Observable<{ status: BillStatus }>;
  isSuccess: (o: AnyPayable) => boolean;
  isProcessing: (o: AnyPayable) => boolean;
}

@Component({
  selector: 'app-payment',
  standalone: true,
  imports: [BackBarComponent, ButtonComponent, QRCodeComponent, CcRequisitesComponent, CopyButtonComponent, EsimInstallComponent],
  template: `<app-back-bar />
    @if (order(); as o) {
      <section class="wrap">
        <h2>{{ headerTitle() }}</h2>

        @if (isSuccess()) {
          <div class="status-block status-block--success">
            <div class="status-icon success">✓</div>
            <h3 class="success-title">{{ successTitle() }}</h3>
            <p>{{ successMessage() }}</p>

            @if (kind === 'esim') {
              <!-- QR запрашивается САМ, как только заявка стала issued: он и есть
                   товар, прятать его за кнопкой незачем (просмотр аудитится
                   бэком, лимит 10/мин — авто-запрос одноразовый). Кнопка
                   остаётся только на случай отказа. -->
              @if (esimQr(); as q) {
                <app-esim-install [qr]="q.qr" [iccid]="q.iccid" />
              } @else if (secretLoading()) {
                <div class="qr-card qr-card--skel" role="status" aria-label="Загрузка QR-кода"></div>
              } @else {
                <p class="hint">{{ secretError() || 'QR-код ещё не готов.' }}</p>
                <div class="actions">
                  <app-button variant="secondary" (clicked)="loadEsimQr()">Повторить</app-button>
                </div>
              }
            }

            @if (kind === 'service' && serviceKind() === 'gift_card') {
              @if (codes(); as list) {
                <div class="codes">
                  @for (code of list; track $index) {
                    <div class="secret-row">
                      <span class="secret mono">{{ code }}</span>
                      <app-copy-button [value]="code" label="Код" />
                    </div>
                  }
                </div>
              } @else {
                <div class="actions">
                  <app-button variant="secondary" [loading]="secretLoading()" [disabled]="secretLoading()" (clicked)="loadCodes()">Показать коды</app-button>
                </div>
              }
            }

            <div class="actions">
              <app-button variant="primary" (clicked)="goHome()">{{ homeLabel() }}</app-button>
            </div>
          </div>
        } @else if (isProcessing()) {
          <div class="status-block">
            <div class="status-icon info">⏳</div>
            <h3 class="success-title">{{ processingTitle() }}</h3>
            <p>Оплата получена. {{ processingMessage() }}</p>
            <p class="hint">Страница обновится автоматически.</p>
          </div>
        } @else if (isRefunded()) {
          <div class="status-block status-block--warn">
            <div class="status-icon warn">⊘</div>
            <p>Заказ не удалось выполнить — средства будут возвращены.
              Если возврат не поступит в ближайшее время, обратитесь в поддержку.</p>
            <div class="actions">
              <app-button variant="primary" (clicked)="goHome()">Закрыть</app-button>
            </div>
          </div>
        } @else if (isFailed()) {
          <div class="status-block status-block--error">
            <div class="status-icon error">✕</div>
            <p>Что-то пошло не так. При попытке выполнить операцию произошла ошибка.
              Это могут быть лимиты на операции по счёту или недоступность платёжных сервисов.
              Пожалуйста, обратитесь в поддержку — мы поможем решить проблему.</p>
            <div class="actions">
              <app-button variant="primary" (clicked)="goHome()">Закрыть</app-button>
            </div>
          </div>
        } @else if (isCanceled()) {
          <div class="status-block status-block--warn">
            <div class="status-icon warn">⊘</div>
            <p>Если вам что-то не понравилось в обслуживании, то напишите нам.
              Мы будем рады выслушать ваши пожелания и предложения.</p>
            <div class="actions">
              <app-button variant="primary" (clicked)="goHome()">Закрыть</app-button>
            </div>
          </div>
        } @else if (isExpired()) {
          <div class="status-block status-block--warn">
            <div class="status-icon warn">⌛</div>
            <p>К сожалению, время исполнения заявки истекло, так как мы не получили
              по ней платежа. Если вы уверены, что успели сделать платеж в назначенное
              время - нажмите на соответствующую кнопку ниже для возобновления поиска
              вашей транзакции.</p>
            <p class="tip">При возобновлении поиска может быть произведен пересчет курса
              обмена, так как курс фиксируется только на время ожидания транзакции.</p>
            <div class="actions">
              @if (canReschedule()) {
                <app-button variant="primary" [loading]="rescheduling()" [disabled]="rescheduling()" (click)="reschedule()">Возобновить поиск</app-button>
              } @else {
                <app-button variant="primary" (clicked)="goHome()">Закрыть</app-button>
              }
            </div>
          </div>
        } @else if (isPendingKyc()) {
          <!-- pending_kyc — заявка ждёт верификации (требование обменника для
               новых типов: eSIM/сервисы). Ветка стоит ДО isPreparing — иначе
               заявка навечно висела бы в «Получение реквизитов...». Поллинг
               продолжается: после finish статус станет pending_payment и
               реквизиты появятся сами. -->
          <div class="status-block">
            <div class="status-icon warn">⚠</div>
            <h3 class="success-title">Нужна верификация для завершения оплаты</h3>
            @if (kycSessionGone()) {
              <p>Сессия верификации истекла — создайте заявку заново.</p>
              <div class="actions">
                <app-button variant="primary" (clicked)="goTo(kycRetryLink())">{{ kycRetryLabel() }}</app-button>
              </div>
            } @else {
              <p>Заявка ждёт подтверждения личности. После прохождения верификации
                реквизиты для оплаты появятся здесь автоматически.</p>
              <div class="actions">
                <app-button variant="primary" [loading]="kycLoading()" [disabled]="kycLoading()" (clicked)="goToKyc()">Пройти верификацию</app-button>
              </div>
            }
          </div>
        } @else if (isPreparing()) {
          <div class="status-block">
            <div class="status-icon info">⏳</div>
            <h3>Получение реквизитов...</h3>
          </div>
        } @else if (isSbp(o.provider)) {
          <!-- СБП-инвойс (kassaai / platega). Режим задаёт backend
               (payment_details.mode, универсален для эквайров):
               'redirect' — пейформа эквайра открывается в новом окне (первое
               открытие — автоматом со страницы создания заявки), здесь
               ожидание платежа + кнопка отмены (отмена лишь прячет форму,
               backend продолжает ждать оплату); 'qr' (H2H, default) — QR
               рендерим на своей странице, к эквайру юзер не уходит. -->
          <div class="nspk-card">
            @if (invoiceMode(o) === 'redirect') {
              <div class="invoice-wait">
                <span class="wait-dot"></span>
                <span>Ожидание платежа…</span>
              </div>
              <p class="nspk-hint">Страница оплаты открылась в новом окне. Если окно не появилось — нажмите «Перейти к оплате». После оплаты вернитесь сюда — статус обновится автоматически.</p>
            } @else {
              <div class="qr-card nspk-qr">
                <qrcode [qrdata]="o.url || ''" [width]="240" colorLight="#ffffff" errorCorrectionLevel="H"
                        imageSrc="/assets/coins/RUB_SBP.png" [imageWidth]="52" [imageHeight]="52" />
              </div>
              <p class="nspk-hint">Для оплаты отсканируйте QR-код в мобильном приложении банка или штатной камерой телефона</p>
            }
            @if (invoiceExpiresIn(); as left) {
              <div class="invoice-timer" [class.invoice-timer--expired]="invoiceExpired()">
                @if (invoiceExpired()) {
                  <span>Срок действия ссылки истёк</span>
                } @else {
                  <span>Ссылка на оплату действительна ещё</span>
                }
                <span class="timer-chip">{{ left }}</span>
              </div>
            }
            <div class="invoice-warn">
              <span class="invoice-warn__icon">⚠</span>
              <span>Важно: не пересылайте ссылку на оплату третьим лицам, иначе аккаунт будет заблокирован.</span>
            </div>
            <div class="actions invoice-actions">
              <app-button variant="coral-band" [full]="true" (click)="openUrl(o.url)">
                <img class="btn-sbp-logo" src="/assets/coins/RUB_SBP.png" alt="" />Перейти к оплате
              </app-button>
              <button type="button" class="link-btn" (click)="copyInvoiceLink(o.url)">Скопировать ссылку</button>
              @if (invoiceMode(o) === 'redirect') {
                <app-button variant="ghost" [full]="true" (click)="cancelWaiting()">Отмена</app-button>
              }
            </div>
          </div>
        } @else {
          <!-- cc-провайдер: пользователь сам делает перевод по реквизитам -->
          @if (isNspk(o.payment_link_bill)) {
            <div class="nspk-card">
              <div class="nspk-head">
                <img class="sbp-logo" src="/assets/coins/RUB_SBP.png" alt="" />
                <span>Оплата через СБП</span>
              </div>
              <div class="qr-card nspk-qr">
                <qrcode [qrdata]="o.payment_link_bill!" [width]="240" colorLight="#ffffff" errorCorrectionLevel="H" />
              </div>
              <p class="nspk-hint">Для оплаты отсканируйте QR-код в мобильном приложении банка или штатной камерой телефона</p>
              <div class="actions">
                <app-button variant="coral-band" [full]="true" (click)="openUrl(o.payment_link_bill)">Оплатить счет</app-button>
              </div>
            </div>
          } @else {
            <!-- Шаг 1: интро по типу валюты (confirm_payment.do_payment* из coincat-fe) -->
            @if (showCryptoAddress()) {
              <p class="lead">Сделайте перевод по реквизитам.</p>
              <p class="lead-sub" [innerHTML]="'При отправке с ресурсов <b>Grinex</b>, <b>NetEx24</b>, <b>Bitpapa</b> транзакция может быть остановлена по AML для прохождения процедуры KYC.'"></p>
            } @else {
              <p class="lead">{{ leadText() }}</p>
            }

            @if (hasComplexAddress()) {
              <app-cc-requisites
                [requisites]="o.deposit_requisites ?? null"
                [type]="o.deposit_requisites_type || ''"
                [amount]="o.amount_payment"
                [amountSymbol]="symbol(o.currency_short_name)"
                [currencyId]="o.payment_currency"
              />
            } @else if (showCryptoAddress()) {
              <app-cc-requisites
                [requisites]="cryptoReq()"
                [type]="'raw'"
                [amount]="o.amount_payment"
                [amountSymbol]="symbol(o.currency_short_name)"
                [currencyId]="o.payment_currency"
              />
              @if (cryptoQrPayload(); as qr) {
                <div class="qr-card">
                  <qrcode [qrdata]="qr" [width]="200" cssClass="qr-canvas" errorCorrectionLevel="M" />
                </div>
              }
            } @else if (o.payment_link || o.payment_link_bill) {
              <p class="lead">Оплатите счет</p>
              <div class="actions" style="margin-top: var(--space-md);">
                <app-button variant="coral-band" [full]="true" (click)="openUrl(o.payment_link_bill || o.payment_link)">Оплатить счет</app-button>
              </div>
            }

            <!-- KZT/GEL — confirm_payment.card_c2c_warning.kzt_warning -->
            @if (showKztWarning()) {
              <div class="kzt-warning">Не указывайте никакой комментарий к переводу</div>
            }

            <!-- Card-c2c warning: дословный перенос из coincat-fe -->
            <!-- (confirm_payment.card_c2c_warning.* + card_triangle_warning.*) -->
            @if (showCardWarning()) {
              <div class="card-warning">
                <h4>Строго запрещено:</h4>
                <ul>
                  <li>Запрещено оплачивать с банкоматов и терминалов.</li>
                  <li>Запрещено совершать оплату 2-мя или более переводами.</li>
                  @if (showRubComplexExtra()) {
                    <li>Запрещено оплачивать по СБП на банки, отличные от указанных в реквизитах заявки.</li>
                  }
                  <li>Запрещено оплачивать заявку переводом суммы отличной от указанной в заявке.</li>
                  <li>Запрещено оплачивать заявку от имени ЮР лиц и ИП.</li>
                </ul>
                @if (showTriangleWarning()) {
                  <h4>Обязательно:</h4>
                  <ul>
                    <li [innerHTML]="'Оплату заявки необходимо совершить в течение <b>30 минут</b> с момента создания заявки. После этого периода реквизиты будут неактуальны. После оплаты <b>обязательно</b> подтвердите оплату, прикрепив чек по инструкции.'"></li>
                  </ul>
                }
                <p class="resolution">В противном случае заявка будет аннулирована, а оплаченные средства не возвращаются!</p>
              </div>
            }

            <!-- Step 2: send_order_note_crypto / send_order_note_ipayed / send_order_note_bill -->
            @if (showCryptoAddress()) {
              <p class="step2">После получения подтверждений сети система найдет ваш платеж и заявка
                отправится в обработку. В случае, если за время жизни заявки перевод дойти не успел
                вы сможете продлить поиск транзакции нажав на соответствующую появившуюся кнопку.</p>
            } @else if (hasComplexAddress()) {
              <p class="step2" [innerHTML]="'После оплаты <b>обязательно</b> загрузите чек.'"></p>
            } @else {
              <p class="step2">После оплаты система автоматически обнаружит ваш платеж в течение 10 минут.</p>
            }

            @if (showBillUpload()) {
              <div class="bill">
                <!-- Состояния:
                       ACCEPTED (1) — чек подтверждён → disabled «Чек принят»
                       uploading / NONE (0) — на проверке → disabled «Идет проверка чека»
                       REJECTED (2) / not loaded → активная кнопка «Загрузить чек (PDF)» -->
                @if (billStatus() === 1) {
                  <button class="file-btn-inner" disabled type="button">Чек принят</button>
                } @else if (billUploading() || billStatus() === 0) {
                  <button class="file-btn-inner" disabled type="button">Идет проверка чека</button>
                } @else {
                  <label class="file-btn">
                    <input type="file" accept="application/pdf,image/*" (change)="onFile($event)" hidden />
                    <span class="file-btn-inner">Загрузить чек (PDF)</span>
                  </label>
                }
              </div>
            }
          }
        }
      </section>
    }`,
  styles: [`
    .wrap { padding: var(--space-md); max-width: 560px; margin: 0 auto; padding-bottom: var(--space-xl); overflow-x: hidden; }
    h2 { text-align: center; }
    h3 { font-size: 16px; margin: 0 0 8px; }
    h4 { font-size: 14px; margin: var(--space-sm) 0 6px; font-weight: 600; color: var(--color-danger, #c0392b); }
    .lead { color: var(--color-ink); margin: 0 0 var(--space-md); line-height: 1.5; }
    .step2 { margin: var(--space-md) 0 0; line-height: 1.5; }
    .step2 b { font-weight: 600; }
    .qr-card { display: flex; justify-content: center; padding: var(--space-md); background: white; border-radius: var(--rounded-md); margin: var(--space-md) 0; max-width: 100%; }
    .qr-card :is(canvas, img, svg) { max-width: 100%; height: auto; }
    /* Скелет ровно под QR 220×220 + паддинги карточки — блок не «прыгает»,
       когда картинка доедет. */
    .qr-card--skel { height: 220px; background: color-mix(in srgb, var(--color-primary) 6%, #fff); position: relative; overflow: hidden; }
    .qr-card--skel::after {
      content: ""; position: absolute; inset: 0;
      background: linear-gradient(100deg, transparent 32%, color-mix(in srgb, #fff 55%, transparent) 50%, transparent 68%);
      transform: translateX(-100%); animation: pay-skel 1.6s ease-in-out infinite;
    }
    @keyframes pay-skel { to { transform: translateX(100%); } }
    @media (prefers-reduced-motion: reduce) { .qr-card--skel::after { animation: none; } }
    .status-block { text-align: center; padding: var(--space-lg); background: var(--color-surface-card); border-radius: var(--rounded-md); margin: var(--space-md) 0; }
    .status-block p { margin: 0 0 var(--space-md); color: var(--color-ink); line-height: 1.5; }
    .status-block p.tip { color: var(--color-muted); font-size: 13px; }
    /* hint'ы идут пачкой (ICCID + инструкция) — между собой их разделяет
       мелкий шаг, а не полный абзацный; хвостовой не тащит отступ, за него
       отвечает margin-top блока действий (соседние margin'ы схлопываются). */
    .status-block p.hint { color: var(--color-muted); font-size: 13px; margin: 0 0 var(--space-xxs); }
    .status-block p.hint:last-of-type { margin-bottom: 0; }
    .status-block .actions { display: flex; justify-content: center; flex-wrap: wrap; gap: var(--space-sm); margin-top: var(--space-lg); }
    .status-block .actions app-button { min-width: 200px; }
    .status-icon { font-size: 36px; margin-bottom: var(--space-sm); display: inline-block; }
    .status-icon.error { width: 56px; height: 56px; margin: 0 auto var(--space-sm); display: flex; align-items: center; justify-content: center; border-radius: 50%; background: color-mix(in srgb, var(--color-danger, #c0392b) 12%, transparent); color: var(--color-danger, #c0392b); font-size: 28px; font-weight: 600; }
    .status-icon.success { width: 56px; height: 56px; margin: 0 auto var(--space-sm); display: flex; align-items: center; justify-content: center; border-radius: 50%; background: color-mix(in srgb, var(--color-success, #2e7d32) 14%, transparent); color: var(--color-success, #2e7d32); font-size: 28px; font-weight: 700; }
    .success-title { margin: 0 0 8px; font-size: 18px; font-weight: 600; }
    .status-icon.warn { font-size: 40px; }
    .status-icon.info { animation: spin 1.6s linear infinite; transform-origin: 50% 50%; }
    @keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }
    /* Секреты (LPA-строка eSIM / коды гифткарты) — строка + copy-кнопка. */
    .secret-row {
      display: flex; align-items: center; gap: var(--space-sm);
      padding: 10px 12px;
      background: var(--color-canvas);
      border: 1px solid var(--color-hairline);
      border-radius: var(--rounded-md);
      margin: 0 0 var(--space-sm);
      text-align: left;
    }
    .secret { flex: 1; min-width: 0; overflow-wrap: anywhere; font-size: 13px; }
    .secret.mono { font-family: var(--font-mono); }
    .codes { margin-bottom: var(--space-sm); }
    .card-warning {
      margin: var(--space-md) 0;
      padding: var(--space-md);
      border: 1px solid var(--color-warning, #ffc107);
      border-radius: var(--rounded-md);
      background: color-mix(in srgb, var(--color-warning, #ffc107) 6%, transparent);
    }
    .card-warning ul { margin: 0 0 var(--space-sm); padding-left: 22px; line-height: 1.5; font-size: 13px; }
    .card-warning li + li { margin-top: 4px; }
    .card-warning .resolution { margin: var(--space-sm) 0 0; font-weight: 600; font-size: 13px; line-height: 1.45; }
    .kzt-warning { margin: var(--space-md) 0; padding: 10px 14px; background: #fff7e6; color: #663300; border-radius: var(--rounded-md); font-size: 13px; line-height: 1.5; font-weight: 600; }
    .lead-sub { font-size: 13px; color: var(--color-muted); margin: 0 0 var(--space-md); line-height: 1.5; }
    .lead-sub b { color: var(--color-ink); font-weight: 600; }
    .actions { display: flex; flex-direction: column; gap: var(--space-sm); }
    .bill { margin-top: var(--space-lg); padding: var(--space-md); background: var(--color-surface-card); border-radius: var(--rounded-md); }
.bill-row { padding: 8px 12px; border-radius: var(--rounded-md); margin-bottom: 8px; font-size: 13px; }
    .bill-row.pending { background: #fff7e6; color: #663300; }
    .bill-row.ok { background: #e8f9ed; color: #115522; }
    .bill-row.err { background: #fce8e8; color: #771515; }
    .file-btn { display: block; }
    .file-btn-inner { display: inline-flex; align-items: center; justify-content: center; width: 100%; padding: 12px 16px; border-radius: var(--rounded-md); background: var(--color-primary); color: var(--color-on-primary, #fff); border: none; cursor: pointer; font-weight: 600; }
    button.file-btn-inner[disabled] { background: color-mix(in srgb, var(--color-primary) 30%, var(--color-canvas)); color: var(--color-muted); cursor: not-allowed; }

    .nspk-card {
      display: flex; flex-direction: column; align-items: center;
      padding: var(--space-md);
      background: var(--color-surface-card);
      border-radius: var(--rounded-lg);
      margin: 0 0 var(--space-lg);
      text-align: center;
      width: 100%;
      max-width: 100%;
      min-width: 0;
    }
    .nspk-head {
      display: inline-flex; align-items: center; gap: 8px;
      color: var(--color-ink);
      font-size: 15px; font-weight: 600;
      margin-bottom: var(--space-md);
    }
    .nspk-head .sbp-logo { width: 22px; height: 22px; }
    .btn-sbp-logo { width: 20px; height: 20px; vertical-align: -5px; margin-right: 8px; }
    .nspk-qr { padding: 16px; margin: 0; max-width: 100%; }
    .nspk-qr :is(canvas, img, svg) { max-width: 100%; height: auto; }
    .nspk-hint { color: var(--color-muted); font-size: 13px; margin: var(--space-sm) 0 var(--space-md); }
    .nspk-card .actions { width: 100%; }

    /* kassaai-инвойс: таймер жизни ссылки + предупреждение + две кнопки. */
    .invoice-timer {
      display: flex; align-items: center; justify-content: space-between; gap: 12px;
      width: 100%;
      padding: 10px 14px;
      background: var(--color-canvas);
      border: 1px solid var(--color-hairline);
      border-radius: var(--rounded-md);
      font-size: 14px; color: var(--color-body);
      margin-bottom: var(--space-sm);
      text-align: left;
    }
    .timer-chip {
      flex: 0 0 auto;
      padding: 4px 10px;
      border: 1px solid var(--color-primary);
      border-radius: var(--rounded-pill);
      color: var(--color-primary-ink);
      font-weight: 600; font-variant-numeric: tabular-nums;
    }
    .invoice-timer--expired { color: var(--color-muted); }
    .invoice-timer--expired .timer-chip { border-color: var(--color-hairline); color: var(--color-muted); }
    .invoice-warn {
      display: flex; align-items: flex-start; gap: 8px;
      width: 100%;
      padding: 10px 14px;
      background: color-mix(in srgb, var(--color-warning, #FFC107) 14%, var(--color-canvas));
      border-radius: var(--rounded-md);
      font-size: 13px; line-height: 1.4; color: var(--color-body);
      margin-bottom: var(--space-md);
      text-align: left;
    }
    .invoice-warn__icon { flex: 0 0 auto; }
    .invoice-actions { display: flex; flex-direction: column; gap: 10px; }

    /* «Скопировать ссылку» — текстовая ссылка, не кнопка: не отвлекает от
       основного действия (оплаты). */
    .link-btn {
      align-self: center;
      background: none; border: none; padding: 6px 4px;
      color: var(--color-muted);
      font-size: 14px;
      text-decoration: underline;
      text-underline-offset: 3px;
      cursor: pointer;
    }
    .link-btn:hover { color: var(--color-ink); }

    /* redirect-режим: индикатор ожидания платежа (пейформа — в новом окне). */
    .invoice-wait {
      display: flex; align-items: center; justify-content: center; gap: 10px;
      width: 100%;
      padding: 18px 14px 6px;
      font-size: 16px; font-weight: 500;
    }
    .wait-dot {
      width: 10px; height: 10px; border-radius: 50%;
      background: var(--color-primary);
      animation: wait-pulse 1.2s ease-in-out infinite;
    }
    @keyframes wait-pulse {
      0%, 100% { opacity: .25; transform: scale(.8); }
      50% { opacity: 1; transform: scale(1); }
    }
  `],
})
export class PaymentPage implements OnInit, OnDestroy {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly location = inject(Location);
  private readonly orders = inject(OrdersApi);
  private readonly esimApi = inject(EsimApi);
  private readonly servicesApi = inject(ServicesApi);
  private readonly kycApi = inject(KycApi);
  private readonly toast = inject(ToastService);
  private readonly analytics = inject(AnalyticsService);

  // order — единый источник правды: любой payable-тип (все имеют совпадающий
  // shape UI-полей оплаты — enrichPaymentInfo backend'а).
  protected readonly order = signal<AnyPayable | null>(null);

  protected readonly billUploading = signal(false);
  protected readonly billSent = signal(false);
  protected readonly billStatus = signal<number>(-1);
  protected readonly rescheduling = signal(false);
  // Секреты успеха: LPA-QR eSIM (запрашивается сам) / коды гифткарты (по кнопке).
  protected readonly esimQr = signal<{ qr: string; iccid: string } | null>(null);
  protected readonly codes = signal<string[] | null>(null);
  protected readonly secretLoading = signal(false);
  protected readonly secretError = signal('');
  /** QR уже запрашивали автоматически — поллинг не должен звать эндпоинт снова. */
  private esimQrRequested = false;
  // pending_kyc: запрос активной KYC-сессии / признак «сессия истекла».
  protected readonly kycLoading = signal(false);
  protected readonly kycSessionGone = signal(false);

  protected kind: OrderKind = 'card';
  private ops!: KindOps;
  private id = '';

  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private billPollTimer: ReturnType<typeof setInterval> | null = null;
  private countdownTimer: ReturnType<typeof setInterval> | null = null;

  ngOnInit(): void {
    this.kind = (this.route.snapshot.data['orderKind'] as OrderKind) ?? 'card';
    this.ops = this.buildOps(this.kind);
    this.id = this.route.snapshot.paramMap.get(this.ops.param) ?? '';
    if (this.id) {
      this.refresh();
      this.pollTimer = setInterval(() => this.refresh(), 5000);
      this.fetchBillStatus();
    }
    // Секундный тик для таймера жизни СБП-инвойса. Сигнал пишем только
    // когда таймер реально виден (СБП-провайдер + expires_at) — иначе в zoneless
    // каждая запись впустую дёргала бы change detection.
    this.countdownTimer = setInterval(() => {
      const o = this.order();
      if (isSbpProvider(o?.provider) && o?.expires_at) this.nowTick.set(Date.now());
    }, 1000);
  }

  ngOnDestroy(): void {
    if (this.pollTimer) clearInterval(this.pollTimer);
    if (this.billPollTimer) clearInterval(this.billPollTimer);
    if (this.countdownTimer) clearInterval(this.countdownTimer);
  }

  // buildOps — дескриптор типа: {get, reschedule?, bill, семантика статусов}.
  private buildOps(kind: OrderKind): KindOps {
    const has = (o: AnyPayable, list: string[]): boolean => list.includes(o.status ?? '');
    switch (kind) {
      case 'topup':
        return {
          param: 'topupId',
          get: (id) => this.orders.getTopUp(id).pipe(map((r) => r.topup)),
          reschedule: (id) => this.orders.rescheduleTopUp(id).pipe(map((r) => r.topup)),
          uploadBill: (id, f) => this.orders.uploadTopUpBill(id, f),
          billStatus: (id) => this.orders.getTopUpBillStatus(id),
          isSuccess: (o) => has(o, ['paid', 'topping_up', 'topped_up']),
          isProcessing: () => false,
        };
      case 'renewal':
        return {
          param: 'renewalId',
          get: (id) => this.orders.getRenewal(id).pipe(map((r) => r.renewal)),
          // reschedule НЕДОСТУПЕН: у бэка нет POST /renewals/:id/reschedule.
          uploadBill: (id, f) => this.orders.uploadRenewalBill(id, f),
          billStatus: (id) => this.orders.getRenewalBillStatus(id),
          isSuccess: (o) => has(o, ['paid', 'completed']),
          isProcessing: () => false,
        };
      case 'esim':
        return {
          param: 'esimOrderId',
          get: (id) => this.esimApi.getOrder(id).pipe(map((r) => r.order)),
          reschedule: (id) => this.esimApi.rescheduleOrder(id).pipe(map((r) => r.order)),
          uploadBill: (id, f) => this.esimApi.uploadOrderBill(id, f),
          billStatus: (id) => this.esimApi.orderBillStatus(id),
          isSuccess: (o) => has(o, ['issued']),
          isProcessing: (o) => has(o, ['paid']),
        };
      case 'esim_recharge':
        return {
          param: 'esimRechargeId',
          get: (id) => this.esimApi.getRecharge(id).pipe(map((r) => r.recharge)),
          reschedule: (id) => this.esimApi.rescheduleRecharge(id).pipe(map((r) => r.recharge)),
          uploadBill: (id, f) => this.esimApi.uploadRechargeBill(id, f),
          billStatus: (id) => this.esimApi.rechargeBillStatus(id),
          isSuccess: (o) => has(o, ['done']),
          isProcessing: (o) => has(o, ['paid']),
        };
      case 'service':
        return {
          param: 'serviceOrderId',
          get: (id) => this.servicesApi.getOrder(id).pipe(map((r) => r.order)),
          reschedule: (id) => this.servicesApi.rescheduleOrder(id).pipe(map((r) => r.order)),
          uploadBill: (id, f) => this.servicesApi.uploadOrderBill(id, f),
          billStatus: (id) => this.servicesApi.orderBillStatus(id),
          isSuccess: (o) => has(o, ['completed']),
          isProcessing: (o) => has(o, ['paid', 'processing']),
        };
      case 'card':
      default:
        return {
          param: 'id',
          get: (id) => this.orders.get(id).pipe(map((r) => r.order)),
          reschedule: (id) => this.orders.reschedule(id).pipe(map((r) => r.order)),
          uploadBill: (id, f) => this.orders.uploadOrderBill(id, f),
          billStatus: (id) => this.orders.getOrderBillStatus(id),
          isSuccess: (o) => has(o, ['paid', 'issuing', 'issued']),
          isProcessing: () => false,
        };
    }
  }

  // ── Таймер жизни СБП-инвойса ──────────────────────────────────────────

  private readonly nowTick = signal(Date.now());

  /** Остаток жизни счёта «MM:SS» (по expires_at инвойса); null — не СБП-инвойс
   *  или срок неизвестен. На нуле останавливается — invoiceExpired. */
  protected readonly invoiceExpiresIn = computed<string | null>(() => {
    const o = this.order();
    if (!o || !isSbpProvider(o.provider) || !o.expires_at) return null;
    const end = Date.parse(o.expires_at);
    if (isNaN(end)) return null;
    const left = Math.max(0, Math.floor((end - this.nowTick()) / 1000));
    const m = Math.floor(left / 60);
    const s = left % 60;
    return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  });

  protected readonly invoiceExpired = computed(() => this.invoiceExpiresIn() === '00:00');

  protected copyInvoiceLink(url: string | undefined): void {
    if (!url) return;
    if (typeof navigator !== 'undefined' && navigator.clipboard) {
      navigator.clipboard.writeText(url).then(() => this.toast.success('Ссылка скопирована'));
    }
  }

  /** Режим показа СБП-инвойса (payment_details.mode backend'а);
   *  legacy-ответ без поля = QR. */
  protected invoiceMode(o: { mode?: string } | null | undefined): 'qr' | 'redirect' {
    return o?.mode === 'redirect' ? 'redirect' : 'qr';
  }

  // Отмена ожидания оплаты (redirect-режим): только убирает форму ожидания —
  // уходим назад в интерфейс (изменить сумму и т.п.). Заявку НЕ отменяем:
  // backend (webhook + поллер) продолжает ждать оплату, и если юзер всё же
  // заплатит по открытой пейформе, заявка станет paid.
  protected cancelWaiting(): void {
    this.location.back();
  }

  // headerTitle — порт `*_title_short` ключей из confirm_payment.* (coincat-fe).
  protected headerTitle = computed(() => {
    const o = this.order();
    if (!o) return 'Оплата заявки';
    if (this.isFailed()) return 'Ошибка заявки';
    if (this.isRefunded()) return 'Заказ не выполнен';
    if (this.isCanceled()) return 'Заявка отменена';
    if (this.isExpired()) return 'Заявка просрочена';
    if (this.isPreparing()) return 'Получение реквизитов...';
    return 'Оплата заявки';
  });

  // leadText — порт confirm_payment.do_payment_direct_{type}[_complex] из
  // coincat-fe. type = banking|digital|crypto, complex — если deposit-реквизиты
  // multi-tab. Для crypto показ обработан отдельно (do_payment + commex).
  protected leadText = computed(() => {
    const o = this.order();
    if (!o) return '';
    const t = (o.payment_currency_type || '').toLowerCase();
    const isComplex = (o.deposit_requisites_type || '').toLowerCase() === 'complex';
    if (t === 'banking') {
      return isComplex
        ? 'Оплатите счет одним из способов ниже. Для оплаты счета зайдите в ваше банковское приложение и сделайте перевод по реквизитам карты/счета, указанным в рамке.'
        : 'Оплатите счет. Для оплаты счета зайдите в ваше банковское приложение и сделайте перевод по реквизитам карты/счета, указанным в рамке ниже.';
    }
    if (t === 'digital') {
      return isComplex
        ? 'Оплатите счет одним из способов ниже. Для оплаты счета зайдите в приложение вашего кошелька и сделайте перевод по реквизитам карты/счета, указанным в рамке.'
        : 'Оплатите счет. Для оплаты счета зайдите в приложение вашего кошелька и сделайте перевод по реквизитам счета, указанным в рамке ниже.';
    }
    return '';
  });

  // ── Семантика статусов (через дескриптор типа) ────────────────────────

  /** Терминальный успех типа — success-view, поллинг остановлен. */
  protected isSuccess(): boolean {
    const o = this.order();
    return !!o && this.ops.isSuccess(o);
  }

  /** Оплата получена, товар в работе (только новые типы) — поллинг живёт. */
  protected isProcessing(): boolean {
    const o = this.order();
    return !!o && this.ops.isProcessing(o);
  }

  protected isFailed(): boolean {
    return (this.order()?.status ?? '') === 'failed';
  }
  /** refunded — новые типы: провайдер отменил списание, деньги вернутся. */
  protected isRefunded(): boolean {
    return (this.order()?.status ?? '') === 'refunded';
  }
  protected isCanceled(): boolean {
    const s = this.order()?.status ?? '';
    return s === 'cancelled' || s === 'canceled';
  }
  // isExpired — coincat помечает заявку 'expired'. Это НЕ конечное состояние:
  // через reschedule (если тип его поддерживает) её можно продлить.
  protected isExpired(): boolean {
    return (this.order()?.coincat_status ?? '').toLowerCase() === 'expired';
  }
  protected canReschedule(): boolean {
    return !!this.ops.reschedule;
  }
  // isPreparing — coincat ещё в precondition или реквизиты ещё не приехали.
  // pending_kyc сюда НЕ попадает (иначе перехватывал бы KYC-ветку и в
  // headerTitle, и при другом порядке веток шаблона): у такой заявки
  // реквизитов не будет, пока юзер не пройдёт верификацию.
  protected isPreparing(): boolean {
    const o = this.order();
    if (!o) return true;
    if (this.isPendingKyc()) return false;
    if ((o.coincat_status ?? '').toLowerCase() === 'precondition') return true;
    if (o.provider !== 'cc') return false;
    const hasDeposit = !!o.deposit_requisites && Object.keys(o.deposit_requisites).length > 0;
    return !hasDeposit && !o.payment_link && !o.payment_link_bill && !o.address;
  }

  // ── pending_kyc: верификация до выдачи реквизитов ─────────────────────

  /** Заявка ждёт KYC (новые типы: обменник требует верификацию до оплаты). */
  protected isPendingKyc(): boolean {
    return (this.order()?.status ?? '') === 'pending_kyc';
  }

  /** «Пройти верификацию»: GET /kyc/active → /kyc/:sessionId. Пустой
   *  session_id = сессия истекла (бэк отдаёт только свежие pending_kyc) —
   *  показываем подсказку с кнопкой на страницу продукта. */
  protected goToKyc(): void {
    if (this.kycLoading()) return;
    this.kycLoading.set(true);
    this.kycApi.active().subscribe({
      next: (r) => {
        this.kycLoading.set(false);
        if (r.session_id) {
          void this.router.navigate(['/kyc', r.session_id]);
        } else {
          this.kycSessionGone.set(true);
        }
      },
      error: (e: { error?: { error?: { message?: string } } }) => {
        this.kycLoading.set(false);
        this.toast.error(e?.error?.error?.message ?? 'Не удалось получить сессию верификации');
      },
    });
  }

  /** Куда идти за новой заявкой, когда KYC-сессия истекла: страница
   *  продукта (eSIM — чекаут тарифа/продление, сервисы — каталог). */
  protected kycRetryLink(): string[] {
    const o = this.order();
    switch (this.kind) {
      case 'esim': {
        const pid = (o as EsimOrder | null)?.esim_product_id;
        return pid ? ['/esim', pid, 'checkout'] : ['/esim'];
      }
      case 'esim_recharge': {
        const esimId = (o as EsimRecharge | null)?.esim_id;
        return esimId ? ['/esim/my', esimId, 'recharge'] : ['/esim'];
      }
      case 'service': return ['/services'];
      default: return ['/cards'];
    }
  }

  protected kycRetryLabel(): string {
    switch (this.kind) {
      case 'esim': return 'К тарифу';
      case 'esim_recharge': return 'К продлению';
      case 'service': return 'К сервисам';
      default: return 'К картам';
    }
  }

  // ── Success-view по типу ──────────────────────────────────────────────

  protected serviceKind(): ServiceKind | '' {
    const o = this.order();
    return this.kind === 'service' && o ? (o as ServiceOrder).kind : '';
  }

  protected successTitle(): string {
    switch (this.kind) {
      case 'esim': return 'eSIM готова';
      case 'esim_recharge': return 'eSIM продлена';
      case 'service':
        switch (this.serviceKind()) {
          case 'gift_card': return 'Заказ выполнен';
          case 'subscription': return 'Подписка оформлена';
          default: return 'Аккаунт пополнен';
        }
      default: return 'Оплата получена';
    }
  }

  protected successMessage(): string {
    const o = this.order();
    switch (this.kind) {
      case 'renewal':
        return 'Спасибо! Обслуживание карты успешно продлено на 1 год.';
      case 'topup':
        return 'Пополнение в обработке. Баланс карты обновится сразу, как только провайдер зачислит средства.';
      case 'esim':
        // Про email не пишем: у аккаунта без подтверждённого адреса письма нет
        // вовсе, а QR теперь и так на странице.
        return 'Активируйте eSIM по QR-коду ниже — он всегда доступен в разделе «Мои eSIM».';
      case 'esim_recharge':
        return 'Пакет продлён по текущему тарифу. Остаток трафика обновится в разделе eSIM в течение пары минут.';
      case 'service': {
        if (this.serviceKind() === 'gift_card') {
          return 'Коды активации отправлены на email — их можно открыть и здесь.';
        }
        const so = o as ServiceOrder | null;
        const login = so?.login ? ` «${so.login}»` : '';
        if (this.serviceKind() === 'subscription') {
          // Подписка включается на аккаунт у провайдера и кода не выдаёт;
          // «обычно за несколько минут» — та же асинхронность, что у пополнения.
          const plan = so?.denom_label ? ` (${so.denom_label})` : '';
          return `Подписка для${login}${plan} оформлена. Провайдер включит её на аккаунт в течение нескольких минут, подтверждение отправлено на email.`;
        }
        // «50 ⭐» у штучного пополнения, у денежного — СУММА ЗАЯВКИ (то, что
        // ввёл покупатель). Расчётную сумму зачисления интерфейс не показывает
        // нигде: она посчитана по нашим курсам, а провайдер зачисляет свою
        // валюту по своему курсу.
        const amt = so?.amount_unit
          ? ` на ${topupAmountLabel(so.amount ?? 0, { amount_unit: so.amount_unit, amount_currency: so.amount_currency ?? '' }, formatAmount)}`
          : so && orderGross(so) > 0
            ? ` на ${formatAmount(orderGross(so), so.price_currency)}`
            : '';
        return `Аккаунт${login} пополнен${amt}. Подтверждение отправлено на email.`;
      }
      default:
        return 'Выпускаем карту. Реквизиты появятся на главной, как только карта будет готова — обычно это занимает несколько минут.';
    }
  }

  protected processingTitle(): string {
    switch (this.kind) {
      case 'esim': return 'Выпускаем eSIM…';
      case 'esim_recharge': return 'Продлеваем eSIM…';
      default: return 'Обрабатываем заказ…';
    }
  }

  protected processingMessage(): string {
    switch (this.kind) {
      case 'esim': return 'Обычно выпуск занимает не больше пары минут.';
      case 'esim_recharge': return 'Продление занимает не больше пары минут.';
      default: return 'Обычно обработка занимает не больше пары минут.';
    }
  }

  protected homeLabel(): string {
    switch (this.kind) {
      case 'esim':
      case 'esim_recharge': return 'К моим eSIM';
      case 'service': return 'К сервисам';
      default: return 'К моим картам';
    }
  }

  protected goTo(link: string[]): void { void this.router.navigate(link); }

  protected goHome(): void {
    switch (this.kind) {
      case 'esim':
      case 'esim_recharge': void this.router.navigate(['/esim']); break;
      case 'service': void this.router.navigate(['/services']); break;
      // Возврат после карточной оплаты — на /cards (бывший авторизованный
      // режим главной), а не на агрегатор «/».
      default: void this.router.navigate(['/cards']);
    }
  }

  /** POST /esim/my/:id/qr — LPA-строка активации выпущенной eSIM. */
  protected loadEsimQr(): void {
    const o = this.order() as EsimOrder | null;
    const esimId = o?.issued_esim_id;
    if (!esimId || this.secretLoading()) return;
    this.secretLoading.set(true);
    this.secretError.set('');
    this.esimApi.qr(esimId).subscribe({
      next: (r) => { this.secretLoading.set(false); this.esimQr.set(r); },
      error: (e) => {
        this.secretLoading.set(false);
        // Ошибку показываем В БЛОКЕ QR, а не тостом: запрос автоматический,
        // тост при заходе на страницу выглядел бы как сбой оплаты.
        this.secretError.set(e?.error?.error?.message ?? 'QR-код ещё не готов.');
      },
    });
  }

  /** POST /services/orders/:id/codes — коды активации гифткарты. */
  protected loadCodes(): void {
    if (this.secretLoading()) return;
    this.secretLoading.set(true);
    this.servicesApi.codes(this.id).subscribe({
      next: (r) => { this.secretLoading.set(false); this.codes.set(r.codes ?? []); },
      error: (e) => {
        this.secretLoading.set(false);
        this.toast.error(e?.error?.error?.message ?? 'Коды ещё не получены');
      },
    });
  }

  // ── cc-провайдер: реквизиты (без изменений) ───────────────────────────

  // hasComplexAddress — у заявки есть депозит-реквизиты с адресом (карта/телефон/иные).
  // Используется для решения «показывать ли card-c2c-warning + блок чека».
  protected hasComplexAddress(): boolean {
    const o = this.order();
    if (!o) return false;
    const t = (o.payment_currency_type || '').toLowerCase();
    if (t === 'crypto') return false;
    const dr = o.deposit_requisites;
    if (!dr) return false;
    const addr = typeof dr['address'] === 'string' ? (dr['address'] as string) : '';
    const phone = typeof dr['phone'] === 'string' ? (dr['phone'] as string) : '';
    return !!(addr || phone);
  }

  protected showCryptoAddress(): boolean {
    return (this.order()?.payment_currency_type || '').toLowerCase() === 'crypto';
  }

  protected cryptoReq(): Record<string, unknown> | null {
    const o = this.order();
    if (!o) return null;
    if (o.deposit_requisites && Object.keys(o.deposit_requisites).length) return o.deposit_requisites;
    if (o.address) return { address: o.address };
    return null;
  }

  protected cryptoQrPayload(): string {
    const dr = this.cryptoReq();
    if (dr && typeof dr['address'] === 'string') return dr['address'] as string;
    return this.order()?.address ?? '';
  }

  // showCardWarning — для не-крипты, не-NSPK, не-qr/email-bill: показываем
  // полный список правил c2c-перевода (как coincat-fe card_c2c_warning).
  protected showCardWarning(): boolean {
    const o = this.order();
    if (!o) return false;
    if ((o.payment_currency_type || '').toLowerCase() === 'crypto') return false;
    if (this.isNspk(o.payment_link_bill)) return false;
    if (o.bill_type === 'qr' || o.bill_type === 'email') return false;
    return this.hasComplexAddress();
  }

  // showRubComplexExtra — extra-пункт для RUB_*-complex/phone (card_c2c_warning.option21).
  protected showRubComplexExtra(): boolean {
    const o = this.order();
    if (!o) return false;
    const cur = o.payment_currency || '';
    if (!cur.startsWith('RUB_')) return false;
    const t = (o.deposit_requisites_type || '').toLowerCase();
    return t === 'complex' || t === 'phone';
  }

  protected showTriangleWarning(): boolean {
    const o = this.order();
    return o?.bill_type === 'qr' || o?.bill_type === 'email';
  }

  protected showKztWarning(): boolean {
    const cur = this.order()?.payment_currency || '';
    return cur.startsWith('KZT_') || cur.startsWith('GEL_');
  }

  // showBillUpload — кнопка «Загрузить чек (PDF)». Аналог coincat-fe правила
  // currenciesService.currencies()[order.currencyFrom]?.type != 'crypto'
  // && order.depositRequisites.address && billType !== 'qr' && billType !== 'email'
  protected showBillUpload(): boolean {
    const o = this.order();
    if (!o) return false;
    if (o.provider !== 'cc') return false;
    if ((o.payment_currency_type || '').toLowerCase() === 'crypto') return false;
    if (o.bill_type === 'qr' || o.bill_type === 'email') return false;
    if (this.isNspk(o.payment_link_bill)) return false;
    return this.hasComplexAddress();
  }

  protected reschedule(): void {
    if (this.rescheduling() || !this.ops.reschedule) return;
    this.rescheduling.set(true);
    this.ops.reschedule(this.id).subscribe({
      next: (o) => {
        this.order.set(o);
        this.rescheduling.set(false);
        // Без тоста — UI и так обновится: reschedule вернул новые реквизиты.
      },
      error: (e: { error?: { error?: { message?: string } } }) => {
        this.rescheduling.set(false);
        this.toast.error(e?.error?.error?.message ?? 'Не удалось продлить заявку');
      },
    });
  }

  // refresh — единый поллинг заявки: для новых типов до ТЕРМИНАЛЬНОГО
  // статуса (paid/processing — товар ещё в работе), для карточных — прежняя
  // семантика (success-блок остаётся на странице, пользователь уходит сам).
  private refresh(): void {
    if (!this.id) return;
    this.ops.get(this.id).subscribe({
      next: (o) => {
        this.order.set(o);
        this.applySideEffects(o);
        if (this.isSuccess() || this.isFailed() || this.isRefunded() || this.isCanceled()) {
          this.stopPolling();
        }
      },
      // Тихий poll: таймаут/сбой не показываем, следующий тик повторит.
      error: () => {},
    });
  }

  // applySideEffects — карточные типы: флаг «выпускается», Яндекс-цели,
  // тост реф-бонуса. Для новых типов клиентские цели НЕ добавляем
  // (только серверные Matomo-goals — решение дизайна).
  private applySideEffects(o: AnyPayable): void {
    if (this.kind === 'card') {
      // Оплачено, но карта ещё не выпущена (card-строка появится только на
      // card.issued) — помечаем для ЛК «Карта выпускается…». Пишем здесь,
      // а не в goHome(): со страницы можно уйти и по bottom-nav.
      if (o.status === 'paid' || o.status === 'issuing') {
        storeIssuingOrderId(this.id);
      }
      if (this.isSuccess()) this.analytics.reachGoalCardPurchase(this.id);
    }
    if (this.kind === 'topup' && this.isSuccess()) {
      this.maybeToastReferralBonus(o as TopUp);
      this.analytics.reachGoalTopUp(this.id);
    }
    // eSIM выпущена — сразу тянем QR: он и есть купленный товар. Один раз на
    // инстанс страницы (issued_esim_id появляется вместе с issued, а поллинг
    // на этом статусе останавливается — но флаг страхует от гонки тиков).
    if (this.kind === 'esim' && this.isSuccess() && !this.esimQrRequested) {
      const esimID = (o as EsimOrder).issued_esim_id;
      if (esimID) {
        this.esimQrRequested = true;
        this.loadEsimQr();
      }
    }
  }

  // Всплывашка о пригласительном бонусе: backend при переходе первого топапа
  // в paid зачисляет бонус отдельным пополнением — сообщаем сумму. Один раз
  // на инстанс страницы.
  private bonusToastShown = false;
  private maybeToastReferralBonus(topup: TopUp): void {
    if (this.bonusToastShown) return;
    const bonus = topup.referral_bonus ?? 0;
    if (bonus <= 0) return;
    this.bonusToastShown = true;
    this.toast.success(`На карту также зачислен пригласительный бонус ${formatReferralAmount(bonus, topup.currency)}`);
  }

  private stopPolling(): void {
    if (this.pollTimer) { clearInterval(this.pollTimer); this.pollTimer = null; }
    if (this.billPollTimer) { clearInterval(this.billPollTimer); this.billPollTimer = null; }
  }

  onFile(ev: Event): void {
    const input = ev.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    this.uploadBill(file);
    input.value = '';
  }

  private uploadBill(file: File): void {
    this.billUploading.set(true);
    this.ops.uploadBill(this.id, file).subscribe({
      next: () => {
        this.billUploading.set(false);
        this.billSent.set(true);
        this.billStatus.set(0);
        // статус — «Идет проверка чека» отрисуется из шаблона, тост не нужен.
        this.startBillPolling();
      },
      error: (e: { error?: { error?: { message?: string } } }) => {
        this.billUploading.set(false);
        this.toast.error(e?.error?.error?.message ?? 'Не удалось отправить чек');
      },
    });
  }

  private fetchBillStatus(): void {
    this.ops.billStatus(this.id).subscribe({
      next: (r) => {
        this.billStatus.set(r.status);
        if (r.status > 0) this.billSent.set(true);
      },
      error: () => {},
    });
  }

  private startBillPolling(): void {
    if (this.billPollTimer) clearInterval(this.billPollTimer);
    this.billPollTimer = setInterval(() => {
      this.fetchBillStatus();
      const s = this.billStatus();
      if (s === 1 || s === 2) {
        if (this.billPollTimer) clearInterval(this.billPollTimer);
        this.billPollTimer = null;
      }
    }, 7000);
  }

  openUrl(url?: string): void {
    openExternalLink(url);
  }

  protected isNspk(url?: string): boolean {
    if (!url) return false;
    try {
      const u = new URL(url);
      return u.hostname === 'qr.nspk.ru' || u.hostname.endsWith('.nspk.ru');
    } catch {
      return false;
    }
  }

  symbol(c?: string): string { return c ? symbolFor(c) : ''; }

  // СБП-инвойс (kassaai / platega) — общая карточка QR в шаблоне.
  protected readonly isSbp = isSbpProvider;
}

