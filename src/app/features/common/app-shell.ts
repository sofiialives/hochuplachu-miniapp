import { Component, DestroyRef, OnInit, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { NavigationEnd, Router, RouterOutlet } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { filter } from 'rxjs/operators';
import { BottomNavComponent } from '../../ui/bottom-nav.component';
import { CardsApi } from '../../core/api/cards.api';
import { KycApi } from '../../core/api/kyc.api';
import { ReferralApi, ReferralInfo } from '../../core/api/referral.api';
import { AuthService } from '../../core/auth/auth.service';
import { RuntimeConfigService } from '../../core/config/runtime-config.service';
import { VerificationService } from '../../core/verification/verification.service';
import { EmailLinkDialog } from '../auth/email-link.dialog';
import { WelcomeBonusDialog } from '../auth/welcome-bonus.dialog';
import { BotPermissionDialog } from '../tg/bot-permission.dialog';

// routePath — путь без query и фрагмента. Telegram Mini App стартует с URL
// вида `/#tgWebAppData=...` (initData во фрагменте) — строгое сравнение
// router-URL с '/' без среза `#` в Mini App не совпадало бы никогда.
function routePath(url: string): string {
  return url.split('#')[0].split('?')[0];
}

@Component({
  selector: 'app-app-shell',
  standalone: true,
  imports: [RouterOutlet, BottomNavComponent, EmailLinkDialog, WelcomeBonusDialog, BotPermissionDialog],
  template: `<div class="shell has-nav">
    <main><router-outlet /></main>
    <app-bottom-nav />

    @if (needsEmailLink()) { <app-email-link-dialog (linked)="onLinked()" /> }
    @if (needsBotPerm()) { <app-bot-permission-dialog (dismissed)="onBotPermDismiss()" /> }
    @if (welcomeBonus(); as wb) {
      <app-welcome-bonus-dialog
        [amount]="wb.amount"
        [currency]="wb.currency"
        (dismissed)="onWelcomeDismissed()" />
    }
  </div>`,
  styles: [`
    .shell {
      display: flex; flex-direction: column; min-height: 100vh;
      /* Единая высота pill bottom-nav — резерв места под fixed-меню. */
      --bottom-nav-h: 76px;
    }
    main { flex: 1; }
    /* bottom-nav в fixed-режиме перекрывает низ страницы. Резервируем место
       под pill + нижний инсет. has-nav теперь БЕЗУСЛОВНЫЙ: меню видит и
       гость (Профиль ведёт его на /login); /login и /r/:refCode живут вне
       шелла и паддинг не получают. Инсет — максимум Telegram fullscreen
       (--tg-safe-area-inset-bottom из WebApp API) и системной env(). */
  `],
})
export class AppShell implements OnInit {
  private readonly cardsApi = inject(CardsApi);
  private readonly auth = inject(AuthService);
  private readonly refApi = inject(ReferralApi);
  private readonly kycApi = inject(KycApi);
  private readonly verification = inject(VerificationService);
  private readonly cfg = inject(RuntimeConfigService);
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);

  // Меню и отступ под него — для любого авторизованного: ЛК теперь главный
  // экран даже без выпущенных карт. bootstrap() отрабатывает в
  // provideAppInitializer до первого рендера, сигнал стабилен к моменту показа.
  protected readonly isAuthed = this.auth.isAuthenticated;
  protected readonly needsEmailLink = signal(false);
  protected readonly needsBotPerm = signal(false);
  // welcomeBonus = объект с суммой/валютой если надо показать диалог;
  // null — не показывать. Сначала null, потом подтягивается из /referral/config
  // если пользователь подходит под условия.
  protected readonly welcomeBonus = signal<{ amount: number; currency: string } | null>(null);

  ngOnInit(): void {
    if (!this.auth.isAuthenticated()) return;
    this.refreshCards();
    if (this.auth.isTelegram() && !this.auth.user()?.bot_can_write) {
      this.needsBotPerm.set(true);
    }
    // maybeShowWelcomeBonus вызывается из refreshCards — welcome-диалог
    // показывается только когда у юзера уже есть купленная карта.

    // AppShell живёт всё время сессии, ngOnInit отрабатывает один раз.
    // Без этого слушателя после первой оплаты юзер возвращается на /, карта
    // уже появилась (push из payment.page), но email-link диалог показался бы
    // только при следующем перезаходе. Ловим NavigationEnd на корневой роут и
    // перезапрашиваем список карт. Дёшево (один GET /cards) и снимает
    // рассинхрон.
    this.router.events.pipe(
      filter((e): e is NavigationEnd => e instanceof NavigationEnd),
      // routePath — Mini App живёт на '/#tgWebAppData=...', web-заход может
      // нести query (?utm_*): строгое сравнение с '/' там не совпадёт никогда.
      // '/cards' — бывший авторизованный режим главной: возврат после оплаты
      // карты теперь ведёт туда, триггеры email-link/welcome-бонуса должны
      // срабатывать и там.
      filter((e) => ['/', '/cards'].includes(routePath(e.urlAfterRedirects || e.url))),
      takeUntilDestroyed(this.destroyRef),
    ).subscribe(() => this.refreshCards());

    // Авто-резюм KYC. Telegram убивает Mini App (блокировка экрана, свёртка)
    // прямо посреди верификации — после рестарта юзер оказывался на каталоге
    // без пути назад к своему шагу. Если приложение открылось на корне
    // (Mini App всегда стартует с '/'), проверяем оба KYC-флоу и возвращаем
    // юзера на его шаг; глубокие web-ссылки не перехватываем.
    //
    // ВАЖНО: НЕ подписка на NavigationEnd. AppShell — роутед-компонент, его
    // ngOnInit запускается change detection'ом ПОСЛЕ того, как создавшая его
    // навигация уже отэмитила NavigationEnd — take(1)-подписка отсюда первое
    // событие не увидит никогда. router.url к этому моменту финален — читаем
    // его напрямую. Вызов один на жизнь шелла (живёт всю сессию), поэтому
    // возврат «Назад» из KYC на каталог редирект повторно не взводит.
    if (routePath(this.router.url) === '/') void this.resumePendingKyc();
  }

  // resumePendingKyc — возвращает юзера на незавершённый KYC-шаг. Два флоу:
  //
  //   1) Order-flow (`/kyc/:sessionId`): coincat потребовал KYC уже при
  //      создании заявки (simple-режим; в strict — например, крупный topup
  //      сверх суммы, покрытой sentinel-сессией). /kyc/active отдаёт sessionId
  //      pending_kyc-заявки (24ч окно — см. backend), статус перепроверяем у
  //      coincat: протухшие (Expired/Abandoned) не резюмим — иначе юзер,
  //      бросивший покупку, вечно попадал бы в мёртвый KYC-экран. Approved
  //      тоже резюмим: на /kyc/:id его ждёт «Завершить» → оплата.
  //
  //   2) Strict-визард (`/verification`): верификация проходит ДО создания
  //      заявок, заявок в pending_kyc нет вообще — прогресс лежит на юзере
  //      (users.kyc_status). Резюмим только если юзер реально дошёл до
  //      KYC-шага: email и phone закрыты (phone делится ТОЛЬКО внутри
  //      визарда — это маркер «визард начат»), а provider ещё нет (pending /
  //      declined). Визард сам вычислит шаг и покажет iframe / retry.
  private async resumePendingKyc(): Promise<void> {
    try {
      const active = await firstValueFrom(this.kycApi.active());
      const id = active?.session_id;
      if (id) {
        const s = await firstValueFrom(this.kycApi.getStatus(id)).catch(() => null);
        if (s && s.status !== 'Expired' && s.status !== 'Abandoned') {
          // Пока летали запросы, юзер мог уже уйти с каталога — не дёргаем.
          if (routePath(this.router.url) !== '/') return;
          void this.router.navigate(['/kyc', id]);
          return;
        }
      }
    } catch { /* best-effort: каталог остаётся рабочим, попробуем strict-ветку */ }
    await this.resumeStrictVerification();
  }

  private async resumeStrictVerification(): Promise<void> {
    if (this.cfg.verificationMode !== 'strict') return;
    // VerificationService сам делает refresh при появлении user (effect в
    // конструкторе) — переиспользуем снапшот, если он уже успел прийти.
    let s = this.verification.status();
    if (!s) {
      await this.verification.refresh();
      s = this.verification.status();
    }
    if (!s || s.mode !== 'strict' || s.all_ok) return;
    if (!s.checks['email']?.ok || !s.checks['phone']?.ok) return;
    if (routePath(this.router.url) !== '/') return;
    void this.router.navigate(['/verification']);
  }

  private refreshCards(): void {
    this.cardsApi.myCards().subscribe({
      next: (res) => {
        const cards = res?.cards ?? [];
        const u = this.auth.user();
        if (u && cards.length > 0 && !u.email_linked) this.needsEmailLink.set(true);
        // Welcome-бонус — только ПОСЛЕ покупки карты: бонус зачисляется при
        // первом пополнении первой карты, поздравление до покупки вводило в
        // заблуждение. refreshCards перезапускается на каждом возврате на '/',
        // поэтому диалог всплывает сразу, как только выпущенная карта
        // появилась в списке.
        if (cards.length > 0) this.maybeShowWelcomeBonus();
      },
      error: (err) => console.error('myCards failed', err),
    });
  }

  // maybeShowWelcomeBonus — условия для показа:
  //   0) у юзера есть купленная карта (вызов только из refreshCards при
  //      непустом списке) — бонус тратится на пополнении, до карты он
  //      неприменим
  //   1) пользователь зарегистрирован по реф-ссылке (referred_by_id != null)
  //   2) бонус ещё не показывали (referral_welcome_seen_at == null)
  //   3) бонус ещё не потрачен (referral_bonus_applied == false)
  //   4) бэк подтвердил персональный бонус (bonus_available > 0)
  // Сумму даёт /referral/info (bonus_available), а НЕ публичный /referral/config:
  // приглашённым партнёром и приглашённым заблокированного рефовода бонус не
  // полагается — это знает только бэк. Запрос идёт только если первые три
  // локальных условия выполнены, чтобы не дёргать endpoint на каждом старте.
  private maybeShowWelcomeBonus(): void {
    // Диалог уже на экране — не дёргаем /referral/info повторно (refreshCards
    // вызывает нас на каждом возврате на '/').
    if (this.welcomeBonus()) return;
    const u = this.auth.user();
    if (!u) return;
    if (!u.referred_by_id) return;
    if (u.referral_welcome_seen_at) return;
    if (u.referral_bonus_applied) return;
    this.refApi.info().subscribe({
      next: (info: ReferralInfo) => {
        if (info.bonus_available > 0) {
          this.welcomeBonus.set({ amount: info.bonus_available, currency: info.referee_bonus.currency });
          return;
        }
        // Структурный ноль: бонус не положен именно ЭТОМУ юзеру (приглашён
        // настоящим партнёром или заблокированным рефоводом) — помечаем welcome
        // отработанным, иначе три локальных условия выше остаются истинными
        // вечно (referral_bonus_applied тоже не выставится: markBonusUsed
        // срабатывает только при bonus>0) и /referral/info дёргался бы на
        // каждом старте у всей когорты бессрочно.
        // Гейт referee_bonus.amount > 0 отличает структурный ноль от глобально
        // выключенной программы (админ мог временно обнулить RefereeBonus —
        // после включения юзер ещё должен увидеть диалог) и заодно защищает от
        // старого бэка без поля bonus_available (=== 0 не сработает на undefined).
        // Исключение — сам вызывающий настоящий партнёр: ему бэк обнуляет
        // referee_bonus из-за его СОБСТВЕННОГО партнёрства (прячем «$5 другу»),
        // так что этот признак для него ничего не говорит о глобальной
        // программе — нулевой bonus_available считаем структурным, иначе гейт
        // не сработал бы никогда и info() дёргался бы на каждом старте вечно.
        const structuralZero = info.bonus_available === 0 &&
          (info.referee_bonus.amount > 0 || u.referral_type === 'partner');
        if (structuralZero) {
          this.refApi.dismissWelcome().subscribe({ error: () => { /* повторим на следующем старте */ } });
          const cur = this.auth.user();
          if (cur) {
            this.auth.user.set({ ...cur, referral_welcome_seen_at: new Date().toISOString() });
          }
        }
      },
      error: () => {
        // Если бэк недоступен — не блокируем приложение, диалог не покажется.
      },
    });
  }

  onLinked(): void { this.needsEmailLink.set(false); }
  onBotPermDismiss(): void { this.needsBotPerm.set(false); }
  onWelcomeDismissed(): void {
    this.welcomeBonus.set(null);
    // Обновим локально дату «увидел», чтобы при последующих рендерах не
    // триггерить запрос конфига зря (бэк уже выставил поле, но локальный
    // signal обновляется только при refreshMe).
    const u = this.auth.user();
    if (u) {
      this.auth.user.set({ ...u, referral_welcome_seen_at: new Date().toISOString() });
    }
  }
}
