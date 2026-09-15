import { Routes } from '@angular/router';
import { authGuard } from './core/auth/auth.guard';
import { adminGuard, adminOnlyGuard } from './core/auth/admin.guard';

export const routes: Routes = [
  {
    path: 'login',
    loadComponent: () => import('./features/auth/email-verify.page').then((m) => m.EmailVerifyPage),
  },
  // /r/:refCode — web-ветка реферального захода. Реф-ссылка рефовода ведёт на
  // ЛЕНДИНГ ({landing_base_url}/r/{code}); там попап выпуска карты
  // (LoginChannelDialog) даёт выбор: Telegram (startapp=ref-{code}, HMAC-путь)
  // или «В браузере» — тогда лендинг строит {web_base_url}/r/{code}?utm_* и
  // юзер приходит сюда: код запоминается в localStorage для email-flow.
  {
    path: 'r/:refCode',
    loadComponent: () => import('./features/auth/referral-entry.page').then((m) => m.ReferralEntryPage),
  },
  { path: 'tg', redirectTo: '', pathMatch: 'full' },
  {
    path: '',
    loadComponent: () => import('./features/common/app-shell').then((m) => m.AppShell),
    children: [
      // '/' — главная-агрегатор (hero карт + секции eSIM/Сервисы). Редиректов
      // с '/' НЕТ: авто-резюм KYC в app-shell сравнивает путь с '/'.
      { path: '', loadComponent: () => import('./features/home/main.page').then((m) => m.MainPage), data: { preload: true } },
      // '/cards' — бывший авторизованный режим главной: карусель карт,
      // детали, Пополнить/Выпустить; гостю — каталог карт.
      { path: 'cards', loadComponent: () => import('./features/cards/home.page').then((m) => m.HomePage), data: { preload: true } },
      // Литеральный `cards/new` — ВЫШЕ динамического `cards/:id`, иначе
      // ":id" поглотит "new" и откроется product-detail с пустым продуктом.
      {
        path: 'cards/new',
        canMatch: [authGuard],
        loadComponent: () => import('./features/cards/home.page').then((m) => m.HomePage),
        data: { catalog: true },
      },
      { path: 'cards/:id', loadComponent: () => import('./features/cards/product-detail.page').then((m) => m.ProductDetailPage) },
      // Чекаут — БЕЗ authGuard: с лендинга сюда приходит гость по кнопке
      // «Выпустить карту». Email он подтверждает прямо на странице (диалог
      // кода), после чего оплата продолжается тем же кликом. Гейт никуда не
      // делся — он внутри страницы и на backend (/orders/issue под auth).
      { path: 'cards/:id/checkout', loadComponent: () => import('./features/cards/checkout.page').then((m) => m.CheckoutPage) },
      { path: 'orders/:id/payment', canMatch: [authGuard], loadComponent: () => import('./features/cards/payment.page').then((m) => m.PaymentPage), data: { orderKind: 'card' } },
      { path: 'topup/:cardId', canMatch: [authGuard], loadComponent: () => import('./features/cards/topup.page').then((m) => m.TopUpPage) },
      { path: 'topup/:cardId/payment/:topupId', canMatch: [authGuard], loadComponent: () => import('./features/cards/payment.page').then((m) => m.PaymentPage), data: { orderKind: 'topup' } },
      { path: 'cards/:cardId/extend-service', canMatch: [authGuard], loadComponent: () => import('./features/cards/extend-service.page').then((m) => m.ExtendServicePage) },
      { path: 'cards/:cardId/extend-service/payment/:renewalId', canMatch: [authGuard], loadComponent: () => import('./features/cards/payment.page').then((m) => m.PaymentPage), data: { orderKind: 'renewal' } },

      // ===== eSIM =====
      // Литеральные esim/my и esim/orders/... — ВЫШЕ динамического esim/:id.
      { path: 'esim', loadComponent: () => import('./features/esim/esim.page').then((m) => m.EsimPage), data: { preload: true } },
      // Страница заказа (view-режим): deep-link из истории/писем; payment.page
      // редиректит сюда с терминального экрана.
      { path: 'esim/orders/:id', pathMatch: 'full', canMatch: [authGuard], loadComponent: () => import('./features/esim/esim-order.page').then((m) => m.EsimOrderPage) },
      { path: 'esim/orders/:esimOrderId/payment', canMatch: [authGuard], loadComponent: () => import('./features/cards/payment.page').then((m) => m.PaymentPage), data: { orderKind: 'esim' } },
      { path: 'esim/recharges/:esimRechargeId/payment', canMatch: [authGuard], loadComponent: () => import('./features/cards/payment.page').then((m) => m.PaymentPage), data: { orderKind: 'esim_recharge' } },
      // Чекауты eSIM — БЕЗ authGuard (гейт внутри: гостевой email-flow;
      // authGuard терял бы query в returnUrl — паттерн cards/:id/checkout).
      // Страница направления (страна или регион) — объявлена ВЫШЕ чекаута:
      // оба начинаются с 'esim/', и порядок здесь читается легче, чем
      // рассуждение о том, почему 'direction' не съест :id.
      { path: 'esim/direction/:code', loadComponent: () => import('./features/esim/esim-direction.page').then((m) => m.EsimDirectionPage) },
      { path: 'esim/my', pathMatch: 'full', canMatch: [authGuard], loadComponent: () => import('./features/esim/my-esims.page').then((m) => m.MyEsimsPage) },
      { path: 'esim/my/:esimId/recharge', loadComponent: () => import('./features/esim/esim-recharge.page').then((m) => m.EsimRechargePage) },
      { path: 'esim/:id/checkout', loadComponent: () => import('./features/esim/esim-checkout.page').then((m) => m.EsimCheckoutPage) },

      // ===== Сервисы (Steam / гифткарты) =====
      { path: 'services', loadComponent: () => import('./features/services/services.page').then((m) => m.ServicesPage), data: { preload: true } },
      { path: 'services/orders/:id', pathMatch: 'full', canMatch: [authGuard], loadComponent: () => import('./features/services/service-order.page').then((m) => m.ServiceOrderPage) },
      { path: 'services/orders/:serviceOrderId/payment', canMatch: [authGuard], loadComponent: () => import('./features/cards/payment.page').then((m) => m.PaymentPage), data: { orderKind: 'service' } },
      // Чекаут — БЕЗ authGuard: deep-link с лендинга несёт query
      // (?login=&amount= | ?denomination=), returnUrl authGuard'а его терял бы.
      { path: 'services/:slug/checkout', loadComponent: () => import('./features/services/service-checkout.page').then((m) => m.ServiceCheckoutPage) },
      { path: 'services/:slug', loadComponent: () => import('./features/services/service-detail.page').then((m) => m.ServiceDetailPage) },

      { path: 'history', canMatch: [authGuard], loadComponent: () => import('./features/history/history.page').then((m) => m.HistoryPage) },
      { path: 'profile/orders', canMatch: [authGuard], loadComponent: () => import('./features/profile/orders.page').then((m) => m.ProfileOrdersPage) },
      { path: 'profile', canMatch: [authGuard], loadComponent: () => import('./features/profile/profile.page').then((m) => m.ProfilePage), data: { preload: true } },
      { path: 'kyc/:sessionId', canMatch: [authGuard], loadComponent: () => import('./features/kyc/kyc-verification.page').then((m) => m.KycVerificationPage) },
      { path: 'verification', canMatch: [authGuard], loadComponent: () => import('./features/verification/verification.page').then((m) => m.VerificationPage) },
    ],
  },
  {
    path: 'admin',
    canMatch: [authGuard, adminGuard],
    loadComponent: () => import('./features/admin/admin-shell').then((m) => m.AdminShell),
    children: [
      // Разделы products/promo/partners/referral — только для role=admin
      // (adminOnlyGuard уводит модератора на cards); дефолтный redirect на
      // products для модератора завершится там же.
      { path: '', redirectTo: 'products', pathMatch: 'full' },
      { path: 'products', canMatch: [adminOnlyGuard], loadComponent: () => import('./features/admin/products-admin.page').then((m) => m.ProductsAdminPage) },
      // eSIM-тарифы и сервис-продукты (Steam/гифткарты) — admin-only, как и
      // их endpoints (RequireAdmin + registerProductProviders).
      { path: 'esim-products', canMatch: [adminOnlyGuard], loadComponent: () => import('./features/admin/esim-products-admin.page').then((m) => m.EsimProductsAdminPage) },
      { path: 'service-products', canMatch: [adminOnlyGuard], loadComponent: () => import('./features/admin/service-products-admin.page').then((m) => m.ServiceProductsAdminPage) },
      { path: 'cards', loadComponent: () => import('./features/admin/cards-admin.page').then((m) => m.CardsAdminPage) },
      { path: 'orders', loadComponent: () => import('./features/admin/orders-admin.page').then((m) => m.OrdersAdminPage) },
      { path: 'promo', canMatch: [adminOnlyGuard], loadComponent: () => import('./features/admin/promo-admin.page').then((m) => m.PromoAdminPage) },
      // Методы оплаты (валюты, провайдеры, условия доступности) — admin-only.
      { path: 'payment-methods', canMatch: [adminOnlyGuard], loadComponent: () => import('./features/admin/payment-methods-admin.page').then((m) => m.PaymentMethodsAdminPage) },
      // Партнёры: список (CRUD) + лидерборд (топ-партнёры) + details. Shell
      // переключает табы, дочерние loadComponent'ы — содержание.
      {
        path: 'partners',
        canMatch: [adminOnlyGuard],
        loadComponent: () => import('./features/admin/partners-admin-shell').then((m) => m.PartnersAdminShell),
        children: [
          { path: '', redirectTo: 'list', pathMatch: 'full' },
          { path: 'list', loadComponent: () => import('./features/admin/partners-admin.page').then((m) => m.PartnersAdminPage) },
          { path: 'leaders', loadComponent: () => import('./features/admin/leaders.page').then((m) => m.LeadersPage), data: { mode: 'partner' } },
          // Заявки партнёров на вывод реальных денег (решение оператора).
          { path: 'withdrawals', loadComponent: () => import('./features/admin/partner-withdrawals-admin.page').then((m) => m.PartnerWithdrawalsAdminPage) },
        ],
      },
      // Детали партнёра — отдельно от shell (полноэкранный профиль, без табов).
      { path: 'partners/users/:userId', canMatch: [adminOnlyGuard], loadComponent: () => import('./features/admin/leader-details.page').then((m) => m.LeaderDetailsPage), data: { mode: 'partner' } },

      // Рефералы: конфиг (singleton) + лидерборд + details.
      {
        path: 'referral',
        canMatch: [adminOnlyGuard],
        loadComponent: () => import('./features/admin/referral-admin-shell').then((m) => m.ReferralAdminShell),
        children: [
          { path: '', redirectTo: 'config', pathMatch: 'full' },
          { path: 'config', loadComponent: () => import('./features/admin/referral-config-admin.page').then((m) => m.ReferralConfigAdminPage) },
          { path: 'leaders', loadComponent: () => import('./features/admin/leaders.page').then((m) => m.LeadersPage), data: { mode: 'referral' } },
        ],
      },
      { path: 'referral/users/:userId', canMatch: [adminOnlyGuard], loadComponent: () => import('./features/admin/leader-details.page').then((m) => m.LeaderDetailsPage), data: { mode: 'referral' } },

      { path: 'users', loadComponent: () => import('./features/admin/users-admin.page').then((m) => m.UsersAdminPage) },
      // Общий список транзакций (пункт меню «Транзакции») — только admin:
      // модератору backend не отдаёт список без привязки к пользователю.
      // pathMatch:'full' обязателен: без него prefix-матч ловит и
      // `transactions/:userId`, и adminOnlyGuard уводит модератора на /cards,
      // не давая deep-link «Транзакции» из «Пользователей» дойти до роута ниже.
      { path: 'transactions', pathMatch: 'full', canMatch: [adminOnlyGuard], loadComponent: () => import('./features/admin/transactions-admin.page').then((m) => m.TransactionsAdminPage) },
      // Транзакции конкретного пользователя (deep-link из «Пользователей»).
      // Доступно и модератору — backend сам отбивает транзакции админов (404).
      // Тот же компонент: для админа route-параметр — предзаполненный фильтр.
      { path: 'transactions/:userId', loadComponent: () => import('./features/admin/transactions-admin.page').then((m) => m.TransactionsAdminPage) },

      // Ретеншен-планы (admin-only): список планов + полноэкранный редактор.
      // Кондишены задаются инлайн в шагах — отдельной страницы нет.
      { path: 'retention/plans/:id', canMatch: [adminOnlyGuard], loadComponent: () => import('./features/admin/retention-plan-edit.page').then((m) => m.RetentionPlanEditPage) },
      { path: 'retention', pathMatch: 'full', canMatch: [adminOnlyGuard], loadComponent: () => import('./features/admin/retention-plans.page').then((m) => m.RetentionPlansPage) },
      // Журнал отправленных уведомлений (admin-only, пункт «Логирование»).
      { path: 'notifications', canMatch: [adminOnlyGuard], loadComponent: () => import('./features/admin/notifications-admin.page').then((m) => m.NotificationsAdminPage) },
    ],
  },
  { path: '**', redirectTo: '' },
];
