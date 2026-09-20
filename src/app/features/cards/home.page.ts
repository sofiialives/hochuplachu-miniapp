import {
  AfterViewInit,
  Component,
  ElementRef,
  OnDestroy,
  OnInit,
  PLATFORM_ID,
  ViewChild,
  computed,
  effect,
  inject,
  input,
  signal,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import { isPlatformBrowser } from '@angular/common';
import { CardsApi, CardProduct, UserCard, CardDetails, productBins } from '../../core/api/cards.api';
import { OrdersApi, clearIssuingOrderId, readIssuingOrderId } from '../../core/api/orders.api';
import { TransactionsApi, CardTransaction } from '../../core/api/transactions.api';
import { PayButtonComponent } from '../../ui/pay-button.component';
import { ButtonComponent } from '../../ui/button.component';
import { CopyButtonComponent } from '../../ui/copy-button.component';
import { BackBarComponent } from '../../ui/back-bar.component';
import { CardTileComponent } from '../../ui/card-tile.component';
import { BrandLogoComponent } from '../../ui/brand-logo.component';
import { RateQuoteComponent } from '../../ui/rate-quote.component';
import { PullToRefreshComponent } from '../../ui/pull-to-refresh.component';
import { CachedBgDirective } from '../../core/utils/cached-bg.directive';
import { BillingAddressDialog } from './billing-address.dialog';
import { ReferralBanner } from '../profile/referral-banner';
import { ReferralDialog } from '../profile/referral.dialog';
import { VerificationBanner } from '../verification/verification-banner';
import { VerificationService } from '../../core/verification/verification.service';
import { Router } from '@angular/router';
import { ToastService } from '../../core/notifications/toast.service';
import { AuthService } from '../../core/auth/auth.service';
import { RuntimeConfigService } from '../../core/config/runtime-config.service';
import { formatAmount, isPrefixSymbolCurrency, symbolFor } from '../../core/currency/currency-symbols';
@Component({
  selector: 'app-home',
  standalone: true,
  imports: [
    PayButtonComponent, ButtonComponent, CopyButtonComponent,
    BillingAddressDialog, ReferralBanner, ReferralDialog, RouterLink,
    BackBarComponent, CardTileComponent, RateQuoteComponent, CachedBgDirective,
    PullToRefreshComponent, VerificationBanner, BrandLogoComponent,
  ],
  template: `<app-pull-to-refresh #ptr (refresh)="onPullRefresh(ptr)">
    <app-back-bar [showBack]="catalog()" />
    <section class="wrap" [class.wrap--catalog]="isCatalogView()">
      @if (loading() && !catalog()) {
        <!-- Список карт ещё грузится (на мобильной сети — секунды): держим
             место карты-визуала skeleton'ом той же геометрии с брендовым
             шиммером, чтобы экран не выглядел пустым. В режиме каталога
             (/cards/new) карты для рендера не нужны — не блокируем. -->
        <div class="skel-card" role="status" aria-label="Загрузка карт">
          <div class="skel-top">
            <span class="skel skel-logo"></span>
            <span class="skel skel-chip"></span>
          </div>
          <div class="skel-body">
            <div>
              <span class="skel skel-line skel-line--sm"></span>
              <span class="skel skel-line skel-line--lg"></span>
            </div>
            <span class="skel skel-line skel-line--md"></span>
          </div>
        </div>
      } @else if (isAuthed() && !catalog()) {
        @if (cards().length === 0) {
          <!-- ЛК без выпущенных карт: вместо карты-визуала — плейсхолдер той же
               геометрии. Каталог авторизованному на «/» больше не показываем —
               выбор карты живёт на /cards/new. Три состояния: оплаченная заявка
               в выпуске / сбой загрузки списка / карт действительно нет. -->
          @if (issuingOrderId()) {
            <div class="no-card">
                <svg class="no-card-ico spin" xmlns="http://www.w3.org/2000/svg" width="202" height="202" viewBox="0 0 202 202" fill="none">
<path d="M195.923 93.0511C192.876 19.9944 111.891 -22.3751 50.1462 16.7961C36.0687 25.7296 24.5894 38.2099 16.8613 52.9836C9.13324 67.7572 5.42831 84.3042 6.1186 100.963V105.23C6.02807 122.98 10.9153 140.4 20.2255 155.512C29.5358 170.624 42.8961 182.824 58.7901 190.727C59.8735 191.251 61.0624 191.522 62.2662 191.518C63.7327 191.535 65.1752 191.144 66.4326 190.389C67.69 189.634 68.7128 188.545 69.3867 187.242C70.2736 185.39 70.406 183.266 69.7558 181.319C69.1055 179.371 67.7237 177.753 65.9022 176.805C56.9105 172.199 48.8625 165.946 42.1756 158.373C41.9773 158.053 41.8722 157.684 41.8722 157.308C41.8722 156.932 41.9773 156.563 42.1756 156.243C42.3286 155.904 42.5722 155.614 42.8796 155.405C43.1871 155.195 43.5463 155.075 43.9179 155.057H64.404C65.1868 155.057 65.9022 155.52 66.222 156.235C67.6472 159.506 69.1482 162.752 70.7249 165.973C71.3876 167.25 72.3858 168.322 73.6123 169.074C74.8387 169.826 76.247 170.229 77.6855 170.24C78.9943 170.204 80.2736 169.843 81.4086 169.19C82.5436 168.537 83.4988 167.613 84.1887 166.5C84.8786 165.388 85.2815 164.121 85.3613 162.814C85.4412 161.507 85.1954 160.201 84.6461 159.013C83.3836 156.403 82.1211 153.794 81.0101 151.101C80.9152 150.874 80.8663 150.631 80.8663 150.385C80.8663 150.14 80.9152 149.897 81.0101 149.67C81.1287 148.861 81.1287 148.038 81.0101 147.229C81.0026 145.848 80.6335 144.492 79.9395 143.298C79.2455 142.103 78.2508 141.111 77.0543 140.42C76.6058 140.19 76.2646 139.795 76.1032 139.318C73.0502 130.319 71.0092 121.009 70.0179 111.559C69.9915 111.283 70.0277 111.004 70.1239 110.743C70.22 110.482 70.3737 110.246 70.5734 110.053C70.734 109.827 70.9479 109.644 71.196 109.521C71.4441 109.398 71.7189 109.337 71.9959 109.346H77.2983C78.3373 109.346 79.3661 109.141 80.326 108.744C81.2859 108.346 82.1581 107.763 82.8927 107.029C83.6274 106.294 84.2102 105.422 84.6078 104.462C85.0054 103.502 85.21 102.473 85.21 101.434C85.21 100.395 85.0054 99.3663 84.6078 98.4064C84.2102 97.4466 83.6274 96.5744 82.8927 95.8397C82.1581 95.105 81.2859 94.5223 80.326 94.1247C79.3661 93.7271 78.3373 93.5224 77.2983 93.5224H72.08C71.8039 93.5188 71.5321 93.4533 71.2845 93.331C71.037 93.2087 70.8199 93.0325 70.6492 92.8154C70.4535 92.622 70.3081 92.3835 70.226 92.1208C70.1438 91.8582 70.1273 91.5794 70.1779 91.3089C70.969 82.5134 72.8543 73.8527 75.7918 65.5286C75.9304 65.1365 76.1867 64.7967 76.5256 64.5557C76.8645 64.3147 77.2696 64.1841 77.6855 64.1819H125.139C125.543 64.1935 125.934 64.3289 126.259 64.5697C126.584 64.8105 126.828 65.1452 126.957 65.5286C128.719 70.4608 130.09 75.4967 131.072 80.6365C131.444 82.4489 132.439 84.0738 133.885 85.2286C135.33 86.3834 137.134 86.9951 138.984 86.9574C139.483 87.0416 139.983 87.0416 140.482 86.9574C142.474 86.5194 144.219 85.3295 145.354 83.6359C146.49 81.9424 146.927 79.8759 146.576 77.8674C145.86 74.1685 144.99 70.5012 143.967 66.8753C143.837 66.6033 143.769 66.3056 143.769 66.0042C143.769 65.7027 143.837 65.405 143.967 65.133C144.153 64.8897 144.393 64.6921 144.667 64.555C144.941 64.4179 145.243 64.345 145.549 64.3419H168.24C168.947 64.3503 169.587 64.7459 169.907 65.3687C175.274 74.466 178.744 84.5553 180.108 95.029C180.238 96.068 180.571 97.0712 181.089 97.9814C181.606 98.8916 182.298 99.6909 183.125 100.334C183.951 100.977 184.896 101.45 185.906 101.728C186.915 102.006 187.97 102.082 189.009 101.952C190.048 101.822 191.051 101.489 191.961 100.971C192.871 100.453 193.67 99.7617 194.313 98.9352C194.956 98.1087 195.43 97.1636 195.707 96.1541C195.985 95.1445 196.053 94.0901 195.923 93.0511ZM70.8091 31.8367C71.2037 31.6549 71.6471 31.608 72.071 31.7034C72.4948 31.7988 72.8755 32.031 73.1542 32.3643C73.4328 32.6976 73.594 33.1133 73.6129 33.5473C73.6317 33.9814 73.5071 34.4095 73.2584 34.7657C70.7334 38.772 68.4412 42.9102 66.3819 47.1803C66.2184 47.5051 65.9703 47.7799 65.6636 47.9754C65.357 48.171 65.0032 48.2801 64.6397 48.2913H51.1141C50.6982 48.2891 50.2931 48.1585 49.9542 47.9175C49.6153 47.6765 49.359 47.3367 49.2204 46.9446C49.078 46.5635 49.0541 46.1482 49.1517 45.7532C49.2493 45.3583 49.4639 45.002 49.7674 44.731C56.1024 39.4123 63.1941 35.0666 70.8091 31.8367ZM59.3372 136.708C59.4661 136.966 59.5331 137.25 59.5331 137.537C59.5331 137.825 59.4661 138.109 59.3372 138.366C59.1604 138.62 58.923 138.825 58.6466 138.963C58.3702 139.101 58.0637 139.168 57.7549 139.158H30.4764C30.1107 139.156 29.753 139.051 29.4447 138.854C29.1363 138.657 28.89 138.377 28.7342 138.047C24.947 129.679 22.6458 120.716 21.9335 111.559C21.9069 111.289 21.9349 111.017 22.0159 110.758C22.0969 110.499 22.2292 110.259 22.4049 110.053C22.6012 109.852 22.8357 109.693 23.0944 109.585C23.3531 109.477 23.6309 109.421 23.9114 109.422H52.5281C53.5634 109.422 54.4219 110.213 54.506 111.24C55.3477 119.858 56.9721 128.376 59.3372 136.708ZM54.3461 92.0159C54.3079 92.5137 54.0827 92.9787 53.7158 93.3175C53.349 93.6563 52.8675 93.8437 52.3682 93.8423H24.8457C24.5651 93.852 24.2858 93.8005 24.0271 93.6915C23.7684 93.5825 23.5365 93.4186 23.3475 93.211C23.1552 92.9826 23.0137 92.7159 22.9324 92.4285C22.8512 92.1412 22.832 91.8398 22.8762 91.5445C24.5508 82.1039 27.9274 73.0462 32.8415 64.8132C33.0154 64.5052 33.267 64.2483 33.5713 64.0681C33.8755 63.8879 34.2218 63.7908 34.5754 63.7864H56.9637C57.5781 63.7864 58.1673 64.0809 58.5376 64.5775C58.6805 64.8456 58.7553 65.1448 58.7553 65.4486C58.7553 65.7525 58.6805 66.0517 58.5376 66.3198C56.2062 74.7028 54.8006 83.3214 54.3461 92.0243M86.8513 48.2913C86.5107 48.274 86.18 48.1708 85.8901 47.9912C85.6002 47.8117 85.3604 47.5616 85.1932 47.2644C85.0379 46.9579 84.957 46.6191 84.957 46.2755C84.957 45.9319 85.0379 45.5931 85.1932 45.2865C89.2035 38.6302 93.7824 32.3335 98.8787 26.4669C99.2789 26.1405 99.7852 25.9728 100.301 25.9955H102.355C102.919 25.9955 103.466 26.2144 103.861 26.6268C108.972 32.4802 113.549 38.7784 117.538 45.4464C117.725 45.7424 117.825 46.0853 117.825 46.4354C117.825 46.7855 117.725 47.1284 117.538 47.4244C117.385 47.7328 117.148 47.9924 116.856 48.1738C116.563 48.3552 116.225 48.4512 115.88 48.4512L86.8513 48.2913ZM129.322 34.7741C129.083 34.4244 128.955 34.0108 128.955 33.5874C128.955 33.1639 129.083 32.7503 129.322 32.4006C129.588 32.0907 129.944 31.8709 130.34 31.7714C130.737 31.6719 131.154 31.6977 131.535 31.8451C139.195 35.035 146.315 39.378 152.661 44.7394C152.969 45.0082 153.191 45.3606 153.302 45.7536C153.412 46.1467 153.406 46.5634 153.284 46.953C153.145 47.3451 152.889 47.6849 152.55 47.9259C152.211 48.1669 151.806 48.2975 151.39 48.2997H138.025C137.64 48.2955 137.265 48.1815 136.943 47.9713C136.621 47.7611 136.365 47.4633 136.207 47.1129C134.161 42.866 131.861 38.7456 129.322 34.7741Z" fill="#CDCDCD"/>
<path d="M98.3979 138.601H110.265C110.265 138.601 112.243 138.601 112.243 140.579V176.173C112.243 176.173 112.243 178.151 110.265 178.151H98.3979C98.3979 178.151 96.42 178.151 96.42 176.173V140.579C96.42 140.579 96.42 138.601 98.3979 138.601ZM130.036 138.601H141.904C141.904 138.601 143.873 138.601 143.873 140.579V176.173C143.873 176.173 143.873 178.151 141.895 178.151H130.028C130.028 178.151 128.058 178.151 128.058 176.173V140.579C128.058 140.579 128.058 138.601 130.036 138.601ZM161.666 138.601H173.533C173.533 138.601 175.511 138.601 175.511 140.579V176.173C175.511 176.173 175.511 178.151 173.533 178.151H161.666C161.666 178.151 159.696 178.151 159.696 176.173V140.579C159.696 140.579 159.696 138.601 161.666 138.601ZM180.098 188.032H93.1038C91.5589 188.09 90.0965 188.744 89.024 189.858C87.9514 190.972 87.3522 192.457 87.3522 194.004C87.3522 195.55 87.9514 197.035 89.024 198.149C90.0965 199.263 91.5589 199.917 93.1038 199.975H180.098C181.672 199.975 183.181 199.35 184.294 198.237C185.407 197.124 186.032 195.615 186.032 194.041C186.032 192.468 185.407 190.958 184.294 189.846C183.181 188.733 181.672 188.108 180.098 188.108V188.032ZM185.241 122.786L139.522 99.9262C138.419 99.3711 137.201 99.082 135.966 99.082C134.731 99.082 133.513 99.3711 132.41 99.9262L86.7745 122.794C85.9652 123.172 85.3153 123.823 84.9396 124.633C84.5638 125.443 84.4863 126.36 84.7208 127.221C84.9175 128.078 85.3997 128.842 86.0879 129.388C86.7762 129.934 87.6298 130.229 88.5083 130.226H183.415C184.288 130.211 185.132 129.907 185.815 129.361C186.498 128.816 186.98 128.06 187.188 127.211C187.396 126.362 187.316 125.469 186.963 124.67C186.609 123.871 186.001 123.211 185.233 122.794" fill="#CDCDCD"/>
</svg>
              <div class="no-card-title">Карта выпускается…</div>
              <div class="no-card-sub">Обычно это занимает несколько минут</div>
            </div>
          } @else if (loadFailed()) {
            <div class="no-card">
              <div class="no-card-title">Не удалось загрузить карты</div>
              <app-button variant="secondary" (clicked)="loadCards()">Повторить</app-button>
            </div>
          } @else {
            <div class="no-card">
                <svg class="no-card-ico" xmlns="http://www.w3.org/2000/svg" width="202" height="202" viewBox="0 0 202 202" fill="none">
<path d="M195.923 93.0511C192.876 19.9944 111.891 -22.3751 50.1462 16.7961C36.0687 25.7296 24.5894 38.2099 16.8613 52.9836C9.13324 67.7572 5.42831 84.3042 6.1186 100.963V105.23C6.02807 122.98 10.9153 140.4 20.2255 155.512C29.5358 170.624 42.8961 182.824 58.7901 190.727C59.8735 191.251 61.0624 191.522 62.2662 191.518C63.7327 191.535 65.1752 191.144 66.4326 190.389C67.69 189.634 68.7128 188.545 69.3867 187.242C70.2736 185.39 70.406 183.266 69.7558 181.319C69.1055 179.371 67.7237 177.753 65.9022 176.805C56.9105 172.199 48.8625 165.946 42.1756 158.373C41.9773 158.053 41.8722 157.684 41.8722 157.308C41.8722 156.932 41.9773 156.563 42.1756 156.243C42.3286 155.904 42.5722 155.614 42.8796 155.405C43.1871 155.195 43.5463 155.075 43.9179 155.057H64.404C65.1868 155.057 65.9022 155.52 66.222 156.235C67.6472 159.506 69.1482 162.752 70.7249 165.973C71.3876 167.25 72.3858 168.322 73.6123 169.074C74.8387 169.826 76.247 170.229 77.6855 170.24C78.9943 170.204 80.2736 169.843 81.4086 169.19C82.5436 168.537 83.4988 167.613 84.1887 166.5C84.8786 165.388 85.2815 164.121 85.3613 162.814C85.4412 161.507 85.1954 160.201 84.6461 159.013C83.3836 156.403 82.1211 153.794 81.0101 151.101C80.9152 150.874 80.8663 150.631 80.8663 150.385C80.8663 150.14 80.9152 149.897 81.0101 149.67C81.1287 148.861 81.1287 148.038 81.0101 147.229C81.0026 145.848 80.6335 144.492 79.9395 143.298C79.2455 142.103 78.2508 141.111 77.0543 140.42C76.6058 140.19 76.2646 139.795 76.1032 139.318C73.0502 130.319 71.0092 121.009 70.0179 111.559C69.9915 111.283 70.0277 111.004 70.1239 110.743C70.22 110.482 70.3737 110.246 70.5734 110.053C70.734 109.827 70.9479 109.644 71.196 109.521C71.4441 109.398 71.7189 109.337 71.9959 109.346H77.2983C78.3373 109.346 79.3661 109.141 80.326 108.744C81.2859 108.346 82.1581 107.763 82.8927 107.029C83.6274 106.294 84.2102 105.422 84.6078 104.462C85.0054 103.502 85.21 102.473 85.21 101.434C85.21 100.395 85.0054 99.3663 84.6078 98.4064C84.2102 97.4466 83.6274 96.5744 82.8927 95.8397C82.1581 95.105 81.2859 94.5223 80.326 94.1247C79.3661 93.7271 78.3373 93.5224 77.2983 93.5224H72.08C71.8039 93.5188 71.5321 93.4533 71.2845 93.331C71.037 93.2087 70.8199 93.0325 70.6492 92.8154C70.4535 92.622 70.3081 92.3835 70.226 92.1208C70.1438 91.8582 70.1273 91.5794 70.1779 91.3089C70.969 82.5134 72.8543 73.8527 75.7918 65.5286C75.9304 65.1365 76.1867 64.7967 76.5256 64.5557C76.8645 64.3147 77.2696 64.1841 77.6855 64.1819H125.139C125.543 64.1935 125.934 64.3289 126.259 64.5697C126.584 64.8105 126.828 65.1452 126.957 65.5286C128.719 70.4608 130.09 75.4967 131.072 80.6365C131.444 82.4489 132.439 84.0738 133.885 85.2286C135.33 86.3834 137.134 86.9951 138.984 86.9574C139.483 87.0416 139.983 87.0416 140.482 86.9574C142.474 86.5194 144.219 85.3295 145.354 83.6359C146.49 81.9424 146.927 79.8759 146.576 77.8674C145.86 74.1685 144.99 70.5012 143.967 66.8753C143.837 66.6033 143.769 66.3056 143.769 66.0042C143.769 65.7027 143.837 65.405 143.967 65.133C144.153 64.8897 144.393 64.6921 144.667 64.555C144.941 64.4179 145.243 64.345 145.549 64.3419H168.24C168.947 64.3503 169.587 64.7459 169.907 65.3687C175.274 74.466 178.744 84.5553 180.108 95.029C180.238 96.068 180.571 97.0712 181.089 97.9814C181.606 98.8916 182.298 99.6909 183.125 100.334C183.951 100.977 184.896 101.45 185.906 101.728C186.915 102.006 187.97 102.082 189.009 101.952C190.048 101.822 191.051 101.489 191.961 100.971C192.871 100.453 193.67 99.7617 194.313 98.9352C194.956 98.1087 195.43 97.1636 195.707 96.1541C195.985 95.1445 196.053 94.0901 195.923 93.0511ZM70.8091 31.8367C71.2037 31.6549 71.6471 31.608 72.071 31.7034C72.4948 31.7988 72.8755 32.031 73.1542 32.3643C73.4328 32.6976 73.594 33.1133 73.6129 33.5473C73.6317 33.9814 73.5071 34.4095 73.2584 34.7657C70.7334 38.772 68.4412 42.9102 66.3819 47.1803C66.2184 47.5051 65.9703 47.7799 65.6636 47.9754C65.357 48.171 65.0032 48.2801 64.6397 48.2913H51.1141C50.6982 48.2891 50.2931 48.1585 49.9542 47.9175C49.6153 47.6765 49.359 47.3367 49.2204 46.9446C49.078 46.5635 49.0541 46.1482 49.1517 45.7532C49.2493 45.3583 49.4639 45.002 49.7674 44.731C56.1024 39.4123 63.1941 35.0666 70.8091 31.8367ZM59.3372 136.708C59.4661 136.966 59.5331 137.25 59.5331 137.537C59.5331 137.825 59.4661 138.109 59.3372 138.366C59.1604 138.62 58.923 138.825 58.6466 138.963C58.3702 139.101 58.0637 139.168 57.7549 139.158H30.4764C30.1107 139.156 29.753 139.051 29.4447 138.854C29.1363 138.657 28.89 138.377 28.7342 138.047C24.947 129.679 22.6458 120.716 21.9335 111.559C21.9069 111.289 21.9349 111.017 22.0159 110.758C22.0969 110.499 22.2292 110.259 22.4049 110.053C22.6012 109.852 22.8357 109.693 23.0944 109.585C23.3531 109.477 23.6309 109.421 23.9114 109.422H52.5281C53.5634 109.422 54.4219 110.213 54.506 111.24C55.3477 119.858 56.9721 128.376 59.3372 136.708ZM54.3461 92.0159C54.3079 92.5137 54.0827 92.9787 53.7158 93.3175C53.349 93.6563 52.8675 93.8437 52.3682 93.8423H24.8457C24.5651 93.852 24.2858 93.8005 24.0271 93.6915C23.7684 93.5825 23.5365 93.4186 23.3475 93.211C23.1552 92.9826 23.0137 92.7159 22.9324 92.4285C22.8512 92.1412 22.832 91.8398 22.8762 91.5445C24.5508 82.1039 27.9274 73.0462 32.8415 64.8132C33.0154 64.5052 33.267 64.2483 33.5713 64.0681C33.8755 63.8879 34.2218 63.7908 34.5754 63.7864H56.9637C57.5781 63.7864 58.1673 64.0809 58.5376 64.5775C58.6805 64.8456 58.7553 65.1448 58.7553 65.4486C58.7553 65.7525 58.6805 66.0517 58.5376 66.3198C56.2062 74.7028 54.8006 83.3214 54.3461 92.0243M86.8513 48.2913C86.5107 48.274 86.18 48.1708 85.8901 47.9912C85.6002 47.8117 85.3604 47.5616 85.1932 47.2644C85.0379 46.9579 84.957 46.6191 84.957 46.2755C84.957 45.9319 85.0379 45.5931 85.1932 45.2865C89.2035 38.6302 93.7824 32.3335 98.8787 26.4669C99.2789 26.1405 99.7852 25.9728 100.301 25.9955H102.355C102.919 25.9955 103.466 26.2144 103.861 26.6268C108.972 32.4802 113.549 38.7784 117.538 45.4464C117.725 45.7424 117.825 46.0853 117.825 46.4354C117.825 46.7855 117.725 47.1284 117.538 47.4244C117.385 47.7328 117.148 47.9924 116.856 48.1738C116.563 48.3552 116.225 48.4512 115.88 48.4512L86.8513 48.2913ZM129.322 34.7741C129.083 34.4244 128.955 34.0108 128.955 33.5874C128.955 33.1639 129.083 32.7503 129.322 32.4006C129.588 32.0907 129.944 31.8709 130.34 31.7714C130.737 31.6719 131.154 31.6977 131.535 31.8451C139.195 35.035 146.315 39.378 152.661 44.7394C152.969 45.0082 153.191 45.3606 153.302 45.7536C153.412 46.1467 153.406 46.5634 153.284 46.953C153.145 47.3451 152.889 47.6849 152.55 47.9259C152.211 48.1669 151.806 48.2975 151.39 48.2997H138.025C137.64 48.2955 137.265 48.1815 136.943 47.9713C136.621 47.7611 136.365 47.4633 136.207 47.1129C134.161 42.866 131.861 38.7456 129.322 34.7741Z" fill="#CDCDCD"/>
<path d="M98.3979 138.601H110.265C110.265 138.601 112.243 138.601 112.243 140.579V176.173C112.243 176.173 112.243 178.151 110.265 178.151H98.3979C98.3979 178.151 96.42 178.151 96.42 176.173V140.579C96.42 140.579 96.42 138.601 98.3979 138.601ZM130.036 138.601H141.904C141.904 138.601 143.873 138.601 143.873 140.579V176.173C143.873 176.173 143.873 178.151 141.895 178.151H130.028C130.028 178.151 128.058 178.151 128.058 176.173V140.579C128.058 140.579 128.058 138.601 130.036 138.601ZM161.666 138.601H173.533C173.533 138.601 175.511 138.601 175.511 140.579V176.173C175.511 176.173 175.511 178.151 173.533 178.151H161.666C161.666 178.151 159.696 178.151 159.696 176.173V140.579C159.696 140.579 159.696 138.601 161.666 138.601ZM180.098 188.032H93.1038C91.5589 188.09 90.0965 188.744 89.024 189.858C87.9514 190.972 87.3522 192.457 87.3522 194.004C87.3522 195.55 87.9514 197.035 89.024 198.149C90.0965 199.263 91.5589 199.917 93.1038 199.975H180.098C181.672 199.975 183.181 199.35 184.294 198.237C185.407 197.124 186.032 195.615 186.032 194.041C186.032 192.468 185.407 190.958 184.294 189.846C183.181 188.733 181.672 188.108 180.098 188.108V188.032ZM185.241 122.786L139.522 99.9262C138.419 99.3711 137.201 99.082 135.966 99.082C134.731 99.082 133.513 99.3711 132.41 99.9262L86.7745 122.794C85.9652 123.172 85.3153 123.823 84.9396 124.633C84.5638 125.443 84.4863 126.36 84.7208 127.221C84.9175 128.078 85.3997 128.842 86.0879 129.388C86.7762 129.934 87.6298 130.229 88.5083 130.226H183.415C184.288 130.211 185.132 129.907 185.815 129.361C186.498 128.816 186.98 128.06 187.188 127.211C187.396 126.362 187.316 125.469 186.963 124.67C186.609 123.871 186.001 123.211 185.233 122.794" fill="#CDCDCD"/>
</svg>
<p class="email email-dash" aria-hidden="true"></p>
              <div class="no-card-title">У вас ещё нет виртуальных карт</div>
              <a class="primary-link" routerLink="/cards/new">
                <app-button variant="primary">Выпустить карту</app-button>
              </a>
            </div>
          }
        } @else if (cards().length > 1) {
          <!-- Карусель выпущенных карт (≥2 карт): повторяет механики
               product-detail — нативный scroll-snap + IntersectionObserver,
               mouse drag-to-scroll на десктопе, dots-индикатор для тапа. -->
          <div class="hero-strip" #strip
               (pointerdown)="onStripPointerDown($event)"
               (pointermove)="onStripPointerMove($event)"
               (pointerup)="onStripPointerUp($event)"
               (pointercancel)="onStripPointerCancel($event)">
            @for (c of cards(); track c.id) {
              <div class="slide"
                   [class.slide--current]="c.id === currentId()"
                   [attr.data-cid]="c.id"
                   (click)="onSlideClick(c.id, $event)">
                <div class="bank" [attr.data-gradient]="bankGradient(c)" [appCachedBg]="bankImage(c)" [appCachedBgGradient]="bankGradient(c)">
                  <div class="bank-top">
                    <app-brand-logo class="brand-logo" [label]="serviceName" [ink]="inkColor" />
                    <button class="reveal" [class.loading]="isLoadingDetails(c)" (click)="toggleDetails(c, $event)" type="button" [attr.aria-busy]="isLoadingDetails(c) || null">
                      <span>{{ isLoadingDetails(c) ? 'Загрузка…' : (detailsFor(c) ? 'Скрыть детали' : 'Показать детали') }}</span>
                      @if (isLoadingDetails(c)) {
                        <svg class="spin" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true">
                          <path d="M21 12a9 9 0 1 1-6.219-8.56" />
                        </svg>
                      } @else {
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                          @if (detailsFor(c)) {
                            <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" />
                            <line x1="1" y1="1" x2="23" y2="23" />
                          } @else {
                            <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8S1 12 1 12z" />
                            <circle cx="12" cy="12" r="3" />
                          }
                        </svg>
                      }
                    </button>
                  </div>

                  <div class="bank-body">
                    <div class="field">
                      <div class="k">Баланс</div>
                      <div class="v balance">{{ money(formatBalance(c.balance), cardCurrency(c)) }}</div>
                    </div>

                    <div class="field">
                      <div class="k">Номер карты</div>
                      <div class="v mono pan">
                        @if (detailsFor(c); as d) {
                          {{ formatPan(d.pan) }}
                        } @else {
                          •••• •••• •••• {{ c.last4 }}
                        }
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            }
          </div>

          <!-- Dots — визуальный индикатор текущей карты и точечный таб-навигатор.
               Активная точка — pill, неактивные — кружки (паттерн iOS). -->
          <div class="dots" role="tablist" aria-label="Выбор карты">
            @for (c of cards(); track c.id) {
              <button type="button"
                      class="dot"
                      [class.active]="c.id === currentId()"
                      role="tab"
                      [attr.aria-selected]="c.id === currentId()"
                      [attr.aria-label]="'Карта •• ' + c.last4"
                      (click)="pickCard(c.id, $event)"></button>
            }
          </div>
        } @else if (current(); as c) {
          <!-- Одиночная карта (1 шт): рендерим карту-визуал во всю ширину,
               без карусели и dots — карусель и слайдер тут визуально лишние. -->
          <div class="bank single" [attr.data-gradient]="bankGradient(c)" [appCachedBg]="bankImage(c)" [appCachedBgGradient]="bankGradient(c)">
            <div class="bank-top">
              <app-brand-logo class="brand-logo" [label]="serviceName" [ink]="inkColor" />
              <button class="reveal" [class.loading]="isLoadingDetails(c)" (click)="toggleDetails(c, $event)" type="button" [attr.aria-busy]="isLoadingDetails(c) || null">
                <span>{{ isLoadingDetails(c) ? 'Загрузка…' : (detailsFor(c) ? 'Скрыть детали' : 'Показать детали') }}</span>
                @if (isLoadingDetails(c)) {
                  <svg class="spin" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true">
                    <path d="M21 12a9 9 0 1 1-6.219-8.56" />
                  </svg>
                } @else {
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                    @if (detailsFor(c)) {
                      <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" />
                      <line x1="1" y1="1" x2="23" y2="23" />
                    } @else {
                      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8S1 12 1 12z" />
                      <circle cx="12" cy="12" r="3" />
                    }
                  </svg>
                }
              </button>
            </div>

            <div class="bank-body">
              <div class="field">
                <div class="k">Баланс</div>
                <div class="v balance">{{ money(formatBalance(c.balance), cardCurrency(c)) }}</div>
              </div>

              <div class="field">
                <div class="k">Номер карты</div>
                <div class="v mono pan">
                  @if (detailsFor(c); as d) {
                    {{ formatPan(d.pan) }}
                  } @else {
                    •••• •••• •••• {{ c.last4 }}
                  }
                </div>
              </div>
            </div>
          </div>
        }

        @if (current(); as c) {
          <div class="product-label">{{ productName(c.card_product_id) }}</div>

          <!-- Плашка «Ограниченное использование» — показываем, когда у
               CardProduct.DisableTopup=true. Карта остаётся рабочей в пределах
               текущего баланса, но пополнения временно недоступны (повторяем
               суть на странице /topup и режим backend POST /cards/:id/topup). -->
          @if (isTopUpDisabled(c)) {
            <div class="limited-banner" role="status">
              <div class="limited-banner__title">Ограниченное использование</div>
              <div class="limited-banner__sub">Пополнение этой карты временно недоступно. Тратьте оставшийся баланс — карта продолжает работать.</div>
            </div>
          }

          <!-- CTA продления годового обслуживания. Показываем за 7 дней до
               окончания и пока карта frozen из-за истёкшего обслуживания. -->
          @if (serviceCtaFor(c); as cta) {
            <a class="renew-cta"
               [routerLink]="['/cards', c.id, 'extend-service']"
               [class.renew-cta--expired]="cta.expired">
              <div class="renew-cta__head">
                @if (cta.expired) {
                  <span class="renew-cta__title">Обслуживание истекло</span>
                  <span class="renew-cta__sub">Карта заблокирована</span>
                } @else {
                  <span class="renew-cta__title">Скоро истекает обслуживание</span>
                  <span class="renew-cta__sub">
                    @if (cta.daysLeft === 0) {
                      Сегодня последний день
                    } @else if (cta.daysLeft === 1) {
                      Остался 1 день
                    } @else {
                      Осталось {{ cta.daysLeft }} {{ daysWord(cta.daysLeft) }}
                    }
                  </span>
                }
              </div>
              <div class="renew-cta__btn">Продлить обслуживание на год</div>
              <div class="renew-cta__note">Для продолжения обслуживания карты необходимо внести оплату.</div>
            </a>
          }

          <!-- Доп. инфо — отдельной панелью под каруcелью. Показывается, когда
               пользователь нажал «Показать детали» на текущей карте. -->
          @if (detailsFor(c); as d) {
            <div class="extra">
              <div class="ex-row">
                <div class="ex-col">
                  <div class="ex-lbl">Номер карты</div>
                  <div class="ex-val mono">{{ formatPan(d.pan) }}</div>
                </div>
                <app-copy-button [value]="d.pan" label="Номер карты" />
              </div>
              <div class="ex-row two">
                <div class="ex-cell">
                  <div class="ex-col">
                    <div class="ex-lbl">Срок действия</div>
                    <div class="ex-val mono">{{ pad(c.expiry_month) }}/{{ pad(c.expiry_year % 100) }}</div>
                  </div>
                  <app-copy-button [value]="pad(c.expiry_month) + '/' + pad(c.expiry_year % 100)" label="Срок действия" />
                </div>
                <div class="ex-cell">
                  <div class="ex-col">
                    <div class="ex-lbl">CVV</div>
                    <div class="ex-val mono">{{ d.cvv }}</div>
                  </div>
                  <app-copy-button [value]="d.cvv" label="CVV" />
                </div>
              </div>
              <button class="ex-link" (click)="showBilling.set(c)" type="button">
                <span>Биллинговый адрес</span>
                <span class="chev">›</span>
              </button>
            </div>
          }
        }

        @if (verification.needed()) {
          <app-verification-banner (clicked)="goVerification()" />
        }
        <app-referral-banner (clicked)="showReferral.set(true)" />

        @if (current(); as c) {
          @if (isTopUpDisabled(c)) {
            <app-pay-button label="Пополнение недоступно" [disabled]="true" />
          } @else {
            <a class="primary-link" [routerLink]="['/topup', c.id]">
              <app-pay-button label="Пополнить" />
            </a>
          }
        }

        @if (cards().length > 0) {
          <a class="link-btn add-card" routerLink="/cards/new">+ Выпустить ещё карту</a>
        }

        <!-- Последние 3 операции — клиентский срез /transactions; полная
             история осталась на /history (ушла из bottom-nav). -->
        @if (cards().length > 0) {
          @if (recentTx(); as txs) {
            @if (txs.length > 0) {
              <div class="recent">
                <h3 class="recent-title">Последние операции</h3>
                @for (t of txs; track t.id) {
                  <div class="rtx">
                    <div class="rtx-info">
                      <div class="rtx-name">{{ t.description || t.kind }}</div>
                      <div class="rtx-date">{{ txWhen(t.happened_at) }}</div>
                    </div>
                    <div class="rtx-amount" [class.plus]="t.amount > 0" [class.minus]="t.amount < 0">
                      {{ t.amount > 0 ? '+' : '' }}{{ money(t.amount, t.currency) }}
                    </div>
                  </div>
                }
                <a class="link-btn recent-more" routerLink="/history">Показать всю историю</a>
              </div>
            }
          } @else {
            <div class="recent" role="status" aria-label="Загрузка операций">
              <h3 class="recent-title">Последние операции</h3>
              <span class="skel rtx-skel"></span>
              <span class="skel rtx-skel"></span>
              <span class="skel rtx-skel"></span>
            </div>
          }
        }
      } @else {
        <!-- Шапка каталога — прямой ребёнок .wrap (сестра нижней кнопки входа),
             чтобы заголовок и кнопка выравнивались ровно по тем же краям
             контейнера, что и полноширинная кнопка внизу. -->
        <div class="catalog-head">
          <h1>Выбор карты</h1>
          @if (!isAuthed()) {
            <!-- Дубль футерной кнопки входа для гостей: сразу видна без
                 скролла каталога. Без [full] — авто-ширина по содержимому. -->
            <a class="primary-link catalog-login" routerLink="/login">
              <!-- .cta-br виден только на узких экранах (см. стили) — там текст
                   переносится в 2 строки, чтобы кнопка влезла справа от h1;
                   на широких br display:none → одна строка. Пробел перед br
                   сохраняет разделение слов, когда перенос выключен. -->
              <app-button variant="primary">Войти или создать <br class="cta-br" />аккаунт</app-button>
            </a>
          }
        </div>
        <section class="catalog">
          <div class="grid stagger-in">
            @for (p of availableProducts(); track p.id) {
              <a class="catalog-row"
                 [class.catalog-row--highlighted]="!!badgeOf(p.id)"
                 [routerLink]="['/cards', p.id]"
                 [appCachedBg]="catalogBgImage(p)"
                 [appCachedBgGradient]="catalogBgGradient(p)"
                 appCachedBgMode="page"
                 [style.--page-h]="p.heading_color || null"
                 [style.--page-body]="p.body_color || null"
                 [style.--color-primary]="p.cta_color || null">
                @if (badgeOf(p.id); as b) {
                  <span class="popular-badge">{{ badgeText(b) }}</span>
                }
                <div class="cat-visual">
                <app-card-tile class="cat-tile" [product]="p" />
                <div class="cat-info-head">
                  <h3 class="cat-name">
                    @for (word of nameWords(p.name); track $index) {
                      @if (isLatinWord(word)) {
                        <span class="name-accent">{{ word }}</span>
                      } @else {
                        {{ word }}
                      }
                      {{ ' ' }}
                    }
                  </h3>
                  <p class="cat-desc">{{ p.description }}</p>
                </div>
                </div>
                <div class="cat-info cat-info--band">
                  <div class="cat-metrics">
                    <div class="metrics-left">
                      <div class="metric metric--price">
                        <div class="metric-lbl">Стоимость</div>
                        <div class="metric-val">
                          @if (symBefore(p.issue_currency)) {
                            <span class="metric-cur">{{ symbol(p.issue_currency) }}</span>{{ p.issue_price }}
                          } @else {
                            {{ p.issue_price }}<span class="metric-cur">{{ symbol(p.issue_currency) }}</span>
                          }
                        </div>
                      </div>
                      <div class="metric metric--rate">
                        <div class="metric-lbl">Курс пополнения</div>
                        <app-rate-quote class="metric-quote" [base]="p.issue_currency" [markupPct]="p.deposit_fee_pct" />
                      </div>
                    </div>
                    <div class="metric metric--currency">
                      <div class="metric-lbl">Валюта карты</div>
                      <div class="metric-val">{{ p.card_currency }}</div>
                    </div>
                  </div>
                </div>
              </a>
            }
          </div>
        </section>

        @if (!isAuthed()) {
          <a class="primary-link" routerLink="/login">
            <app-button variant="primary" [full]="true">Войти или создать аккаунт</app-button>
          </a>
        }
      }

      @if (showBilling()) {
        <app-billing-address-dialog
          [binCountry]="binCountryOf(showBilling()!)"
          (closed)="showBilling.set(null)" />
      }
      @if (showReferral()) {
        <app-referral-dialog (closed)="showReferral.set(false)" />
      }
    </section>
  </app-pull-to-refresh>`,
  styles: [`
    
    .wrap {
      padding: 0 16px;
      padding-bottom: 110px;
      max-width: 1200px; margin: 0 auto;
      display: flex; flex-direction: column;
      gap: 20px
    }
    .email {  color: rgba(228, 228, 228, 1); }
    .email-dash::before {
      content: '';
      display: block;
      width: 164px;
      height: 2px;
      border-radius: 999px;
      background: var(--color-hairline);
      margin: 16px 0 14px;
    }

    
    .hero-strip {
      --slide-w: clamp(220px, 75vw, 320px);
      display: flex;
      gap: 16px;
      overflow-x: auto;
      overflow-y: hidden;
      scroll-snap-type: x mandatory;
      scroll-behavior: smooth;
      scrollbar-width: none;
      -webkit-overflow-scrolling: touch;
      padding: var(--space-sm) calc((100% - var(--slide-w)) / 2);
      margin: 0 calc(-1 * var(--space-md));
    }
    .hero-strip::-webkit-scrollbar { display: none; }
    
    @media (hover: hover) and (pointer: fine) {
      .hero-strip { cursor: grab; }
      .hero-strip.dragging { cursor: grabbing; scroll-snap-type: none; scroll-behavior: auto; }
      .hero-strip.dragging .slide { cursor: grabbing; }
    }
    .slide {
      flex: 0 0 var(--slide-w);
      scroll-snap-align: center;
      scroll-snap-stop: always;
      cursor: pointer;
      transition: transform .25s ease, opacity .25s ease;
      opacity: .55;
      transform: scale(.94);
      display: flex;
      justify-content: center;
      align-items: center;
      user-select: none;
    }
    .slide .bank { width: 100%; pointer-events: none; }
    .slide--current { opacity: 1; transform: scale(1); cursor: default; }
    
    .slide--current .bank { pointer-events: auto; }

    
    .dots {
      display: flex; gap: 8px; justify-content: center; align-items: center;
      margin: 0 0 var(--space-md);
    }
    .dot {
      width: 8px; height: 8px;
      border-radius: var(--rounded-pill, 999px);
      background: color-mix(in srgb, var(--color-ink) 22%, transparent);
      border: none; padding: 0; cursor: pointer;
      transition: width .25s ease, background-color .2s ease;
    }
    .dot:hover { background: color-mix(in srgb, var(--color-ink) 42%, transparent); }
    .dot.active {
      width: 22px;
      background: var(--color-primary);
      cursor: default;
    }

    
    .bank {
      position: relative;
      aspect-ratio: 1.65 / 1;
      width: 100%;
      border-radius: 18px;
      padding: clamp(16px, 4.5cqi, 24px);
      color: var(--color-on-dark, #fff);
      background: linear-gradient(135deg, #2563eb 0%, #1e40af 60%, #0c1e5d 100%);
      box-shadow: 0 8px 24px rgba(20, 20, 19, .14);
      overflow: hidden;
      display: flex; flex-direction: column;
      container-type: inline-size;
    }
    
    .bank::after {
      content: ""; position: absolute; inset: 0;
      background:
        linear-gradient(180deg, rgba(0,0,0,.28) 0%, transparent 30%, transparent 58%, rgba(0,0,0,.55) 100%),
        radial-gradient(circle at top right, rgba(255,255,255,.14), transparent 55%);
      pointer-events: none;
    }
    .bank[data-gradient="dark"] { background: linear-gradient(135deg, #181715 0%, #2d2a25 100%); }
    .bank[data-gradient="gold"] { background: linear-gradient(135deg, #d4a017 0%, #8c6a0b 100%); }

    .bank-top {
      position: relative; z-index: 1;
      display: flex; align-items: center; justify-content: space-between;
      gap: var(--space-sm);
    }
    
    .brand-logo {
      height: clamp(22px, 8cqi, 34px); width: clamp(62px, 22.4cqi, 95px);
    }

    .reveal {
      display: inline-flex; align-items: center; gap: 6px;
      background: rgba(0,0,0,.30); border: none;
      padding: 6px 12px; border-radius: 999px;
      color: var(--color-on-dark, #fff); opacity: .95;
      font-size: clamp(13px, 3.6cqi, 16px); cursor: pointer; white-space: nowrap;
      backdrop-filter: blur(6px);
      -webkit-backdrop-filter: blur(6px);
    }
    .reveal:hover { opacity: 1; }
    .reveal.loading { cursor: progress; opacity: .7; }
    .reveal svg { width: clamp(16px, 4.2cqi, 20px); height: clamp(16px, 4.2cqi, 20px); }
    
    .reveal svg.spin { animation: home-reveal-spin .9s linear infinite; transform-origin: 50% 50%; }
    @keyframes home-reveal-spin { to { transform: rotate(360deg); } }

    
    .bank-body {
      position: relative; z-index: 1;
      flex: 1;
      display: flex; flex-direction: column; justify-content: space-between;
      margin-top: clamp(10px, 3.5cqi, 16px);
    }
    .field .k {
      font-size: clamp(11px, 3.2cqi, 14px); text-transform: none; letter-spacing: .01em;
      opacity: .85; margin-bottom: 4px;
      text-shadow: 0 1px 2px rgba(0,0,0,.4);
    }
    .field .v {
      font-weight: 600; font-size: clamp(18px, 5.2cqi, 22px); overflow-wrap: anywhere;
      text-shadow: 0 1px 3px rgba(0,0,0,.5);
    }
    .field .v.balance { font-size: clamp(24px, 7cqi, 32px); letter-spacing: .01em; }
    .field .v.mono { font-family: var(--font-mono); letter-spacing: .06em; }
    .field .v.pan { font-size: clamp(20px, 6cqi, 26px); }

    
    .skel-card {
      aspect-ratio: 1.65 / 1;
      width: 100%;
      border-radius: 18px;
      border: 1px solid color-mix(in srgb, var(--color-primary) 18%, var(--color-hairline-soft));
      background: color-mix(in srgb, var(--color-primary) 6%, var(--color-surface));
      padding: clamp(16px, 4.5cqi, 24px);
      display: flex; flex-direction: column;
      position: relative;
      overflow: hidden;
      container-type: inline-size;
    }
    .skel-card::after {
      content: "";
      position: absolute; inset: 0;
      background: linear-gradient(100deg,
        transparent 32%,
        color-mix(in srgb, var(--color-primary) 12%, transparent) 45%,
        color-mix(in srgb, #fff 60%, transparent) 50%,
        color-mix(in srgb, var(--color-primary) 12%, transparent) 55%,
        transparent 68%);
      transform: translateX(-100%);
      animation: skel-sweep 1.6s ease-in-out infinite;
      pointer-events: none;
    }
    @keyframes skel-sweep { to { transform: translateX(100%); } }
    @media (prefers-reduced-motion: reduce) {
      .skel-card::after { animation: none; }
    }
    .skel {
      display: block;
      border-radius: 999px;
      background: color-mix(in srgb, var(--color-primary) 14%, var(--color-surface));
    }
    .skel-top { display: flex; align-items: center; justify-content: space-between; gap: var(--space-sm); }
    .skel-logo { width: clamp(62px, 22.4cqi, 95px); height: clamp(22px, 8cqi, 34px); }
    .skel-chip { width: clamp(96px, 32cqi, 150px); height: clamp(24px, 7cqi, 32px); }
    .skel-body {
      flex: 1;
      display: flex; flex-direction: column; justify-content: space-between;
      margin-top: clamp(10px, 3.5cqi, 16px);
    }
    .skel-line { height: clamp(12px, 3.5cqi, 16px); }
    .skel-line--sm { width: clamp(52px, 18cqi, 78px); margin-bottom: 8px; }
    .skel-line--lg { width: clamp(120px, 44cqi, 190px); height: clamp(24px, 7cqi, 32px); }
    .skel-line--md { width: clamp(150px, 60cqi, 250px); height: clamp(18px, 6cqi, 26px); }

    
    .no-card {
      border-radius: 20px;
      border: 2px solid rgba(205, 205, 205, 1); 
      display: flex; flex-direction: column; align-items: center; justify-content: center;
      padding: var(--space-md);
      text-align: center;
      padding: 24px 16px;
      margin-bottom: 18px;
    }
    .no-card-ico {
      width: 84px; height: 84px;  }
    .no-card-title { font-size: 20px; font-weight: 600; color: rgba(0, 0, 0, 1); margin-bottom: 20px;}
    .no-card-sub { font-size: 13px; color: var(--color-muted); }
    .no-card .primary-link { margin-top: 6px; }

    
    /*
     * Размеры продублированы 1:1 с .catalog-head h1 (тот же паттерн
     * заголовка страницы: 24px по умолчанию → 19px на узких мобильных
     * (≤560px, см. ниже) → 36px на десктопе (≥1024px, см. media-запрос).
     */
    .product-label {
      text-align: center;
      text-transform: uppercase;
      font-family: 'Syncopate Cyr';
      font-size: 24px; font-weight: 600;
      color: var(--color-ink);
    }
    @media (max-width: 560px) {
      .product-label { font-size: 19px; }
    }

    /*
     * Единый вертикальный ритм для стопки блоков на "карте с топапом":
     * product-label → limited-banner/renew-cta/extra (margin-bottom уже
     * выше) → verification-banner → referral-banner → "Пополнить" →
     * "+ Выпустить ещё карту" → история. Раньше .wrap не задавал gap и
     * часть этих блоков шла впритык друг к другу без отступа.
     */
    app-verification-banner,
    app-referral-banner {
      display: block;
      margin-bottom: var(--space-md);
    }
    .link-btn.add-card {
      margin-bottom: var(--space-md);
    }

    
    .extra {
      display: flex; flex-direction: column;
      background: var(--color-surface);
      border: 1px solid var(--color-hairline-soft);
      border-radius: var(--rounded-md);
      padding: 4px var(--space-md);
      margin-bottom: var(--space-md);
    }
    .ex-row {
      display: flex; align-items: center; gap: var(--space-sm);
      padding: 12px 0;
      border-bottom: 1px solid var(--color-hairline-soft);
    }
    .ex-row:last-of-type { border-bottom: none; }
    .ex-row.two { gap: var(--space-md); }
    .ex-cell {
      flex: 1; min-width: 0;
      display: flex; align-items: center; gap: var(--space-sm);
    }
    .ex-col { flex: 1; min-width: 0; }
    .ex-lbl { font-size: 12px; color: var(--color-muted); margin-bottom: 2px; }
    .ex-val { font-weight: 600; font-size: 15px; overflow-wrap: anywhere; }
    .ex-val.mono { font-family: var(--font-mono); letter-spacing: .04em; }

    .ex-link {
      display: flex; align-items: center; justify-content: space-between;
      width: calc(100% + var(--space-md) * 2); margin: 0 calc(-1 * var(--space-md));
      padding: 12px var(--space-md);
      background: transparent; border: none; border-top: 1px solid var(--color-hairline-soft);
      color: var(--color-primary-ink); font-size: 14px; font-weight: 500;
      cursor: pointer;
    }
    .ex-link:hover { background: var(--color-surface-card); }
    .ex-link .chev { font-size: 20px; line-height: 1; opacity: .7; }

    
    .limited-banner {
      display: flex; flex-direction: column; gap: 4px;
      padding: var(--space-md);
      background: color-mix(in srgb, var(--color-danger, #c0392b) 9%, var(--color-canvas));
      border: 1px solid var(--color-danger, #c0392b);
      border-radius: var(--rounded-md);
      color: var(--color-ink);
      margin-bottom: var(--space-md);
    }
    .limited-banner__title { font-weight: 600; font-size: 15px; }
    .limited-banner__sub { font-size: 13px; color: var(--color-muted); }

    
    .renew-cta {
      display: flex; flex-direction: column; gap: 6px;
      padding: var(--space-md);
      background: color-mix(in srgb, var(--color-primary) 10%, var(--color-canvas));
      border: 1px solid var(--color-primary);
      border-radius: var(--rounded-md);
      text-decoration: none;
      color: var(--color-ink);
      transition: transform .12s ease, box-shadow .12s ease;
      margin-bottom: var(--space-md);
    }
    .renew-cta:hover { transform: translateY(-1px); box-shadow: var(--shadow-primary-hover); }
    .renew-cta--expired {
      background: color-mix(in srgb, var(--color-danger, #c0392b) 9%, var(--color-canvas));
      border-color: var(--color-danger, #c0392b);
    }
    .renew-cta__head { display: flex; flex-direction: column; gap: 2px; }
    .renew-cta__title { font-weight: 600; font-size: 15px; }
    .renew-cta__sub { font-size: 13px; color: var(--color-muted); }
    .renew-cta__btn {
      margin-top: 8px;
      padding: 12px 16px;
      background: var(--color-primary);
      color: var(--color-on-primary, #fff);
      border-radius: var(--rounded-md);
      text-align: center;
      font-weight: 600;
      font-size: 15px;
    }
    .renew-cta--expired .renew-cta__btn { background: var(--color-danger, #c0392b); color: #fff; }
    .renew-cta__note { font-size: 12px; color: var(--color-muted); text-align: center; margin-top: 4px; }

    
    .catalog {width: 100%; }
    
    .catalog-head { display: flex; align-items: center; justify-content: center; margin-bottom: 28px; }
    .catalog-head h1 { padding: 0; margin: 0; font-size: 24px;  }
    .catalog-login { flex: 0 0 auto; }
    
    .cta-br { display: none; }
    
    @media (max-width: 560px) {
      .catalog-head { flex-wrap: nowrap; gap: var(--space-sm); }
      .catalog-head h1 { font-size: 19px; }
      .cta-br { display: inline; }
      .catalog-login ::ng-deep button {
        height: auto;
        min-height: 40px;
        padding: 7px 14px;
        line-height: 1.15;
        white-space: normal;
        text-align: center;
      }
    }
    @media (max-width: 360px) {
      .catalog-head h1 { font-size: 21px; }
      .catalog-login ::ng-deep button { padding: 7px 12px; }
    }
    
    .grid { display: flex; flex-direction: column; gap: 40px; padding-top: 14px; }

      
    .catalog-row {
      position: relative;
      display: grid;
      grid-template-columns: 1fr;
      grid-template-rows: auto auto;
      padding: var(--space-md);
      background: var(--color-surface);
      background-size: cover;
      background-position: center;
      background-repeat: no-repeat;
      border: 1px solid var(--color-hairline-soft, var(--color-hairline));
      border-radius: 20px;
      text-decoration: none;
      color: var(--page-body, var(--color-ink));
      transition: transform .15s ease, box-shadow .15s ease, border-color .15s ease;
    }
    .catalog-row--highlighted {
      border: 2px solid var(--color-primary);
      box-shadow: 0 14px 32px color-mix(in srgb, var(--color-primary) 18%, transparent);
    }
    .popular-badge {
      position: absolute;
      top: -14px; left: 50%;
      transform: translateX(-50%);
      padding: 6px 16px;
      background: var(--color-primary);
      color: var(--color-on-primary);
      border-radius: var(--rounded-pill, 999px);
      font-family: "Syncopate Cyr";
      font-size: 11px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: .08em;
      white-space: nowrap;
      box-shadow: 0 6px 14px color-mix(in srgb, var(--color-primary) 35%, transparent);
      z-index: 2;
    }
    .catalog-row:hover {
      transform: translateY(-2px);
      box-shadow: 0 16px 32px rgba(20, 20, 19, .10);
      border-color: var(--color-primary);
    }
    .cat-tile {
      filter: drop-shadow(0 8px 18px color-mix(in srgb, var(--page-h, var(--color-ink)) 22%, transparent));
      transition: filter .15s ease;
    }
    .catalog-row:hover .cat-tile {
      filter: drop-shadow(0 12px 24px color-mix(in srgb, var(--page-h, var(--color-ink)) 30%, transparent));
    }

    
    .cat-visual {
      grid-column: 1; grid-row: 1;
      display: flex; flex-direction: column; align-items: center; gap: var(--space-md); margin: 46px 0 32px 0;
    }
    .cat-tile { max-width: 270px; width: 100%;  }

    .cat-info {
      grid-column: 1; grid-row: 2;
      min-width: 0;
      display: flex; flex-direction: column; gap: var(--space-md);
    }
    .cat-info--band {
      background: var(--color-primary);
      padding: var(--space-md);
      border-radius: 0 0 18px 18px;
      margin: 0 calc(-1 * var(--space-md)) calc(-1 * var(--space-md));
    }
    .cat-info--band .metric-lbl,
    .cat-info--band .metric-val,
    .cat-info--band .metric-cur {
      color: rgba(0, 0, 0, 1);
    }
    .cat-info-head { display: flex; align-items: center; text-align: center; flex-direction: column; gap: 12px; margin-top: 26px; }
    
    .cat-name {
      font-size: clamp(26px, 2vw, 32px);
      color: var(--page-h, var(--color-ink));
    }
    /*
     * Латинские слова в названии карты (например "PREMIUM") подсвечены
     * акцентным цветом — как на странице самой карточки
     * (product-detail.page.ts, .name-accent). --color-primary тут уже
     * выставлен per-card через [style.--color-primary]="p.cta_color".
     */
    .name-accent {
      color: var(--color-primary);
    }
    .cat-desc {
      font-size: 15px; line-height: 1.45;
      color: var(--page-h, var(--color-ink));
      margin: 0;
      display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden;
    }

    
    .cat-metrics {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
    }
    .metrics-left { display: flex; flex-direction: column; }
    .metric--price { margin-bottom: 12px; }
    .metric { display: block; }
    .metric-lbl {
      font-weight: 500;
      font-size: 12px; text-transform: uppercase;
      color: rgba(0, 0, 0, 1);
      white-space: nowrap;
      margin-bottom: 4px;
    }
    .metric-val {
      font-family: "Syncopate Cyr";
      font-size: 17px;
      color: rgba(0, 0, 0, 1);
      line-height: 1.1;
      white-space: nowrap;
    }
    .metric-cur:first-child { margin-left: 0; margin-right: 1px; }

    .metric--currency { text-align: right; }
    .metric--rate .metric-val { font-size: 14px; color: var(--page-body, var(--color-muted)); font-weight: 500; }
    /*
     * В каталоге карт курс должен быть обычным чёрным, а не цветом темы
     * конкретной карты (--page-h/--page-body задаются выше на .catalog-row
     * под heading_color/body_color товара). Переопределяем эти переменные
     * прямо на host app-rate-quote — внутренние стили компонента через
     * var(--page-body, ...) подхватят этот чёрный вместо унаследованного.
     */
    .metric-quote {
      --page-h: rgba(0, 0, 0, 1);
      --page-body: rgba(0, 0, 0, 1);
    }
    .metric--rate app-rate-quote {
      display: block;
      line-height: 1.3;
    }
    .metric--rate ::ng-deep .rate-quote {
      flex-direction: column;
      align-items: flex-start;
      gap: 2px;
      justify-content: flex-start;
    }

    
    @media (min-width: 1024px) {
      .catalog-head h1 { font-size: 36px; }
      .product-label { font-size: 36px; }
      .catalog-row { grid-template-columns: 344px 1fr; }
      .cat-visual {padding: 36px 60px;  grid-column: 1 / -1; flex-direction: row; align-items: center; text-align: left; gap: 60px; }
      .cat-tile { width: 240px; max-width: 240px; flex-shrink: 0; }
      .cat-info-head { align-items: flex-start; text-align: left; margin-top: 0; }
      .cat-name, .cat-desc { text-align: left; }
      .cat-info { grid-column: 1 / -1; }
      
      .cat-info--band { padding: 24px 120px; }

      

    }

    
    .recent {
      display: flex; flex-direction: column;
      background: var(--color-surface);
      border: 1px solid var(--color-hairline-soft);
      border-radius: var(--rounded-md);
      padding: var(--space-sm) var(--space-md);
    }
    .recent-title { margin: 4px 0 6px; font-size: 16px; font-weight: 600; color: var(--color-ink); }
    .rtx {
      display: flex; align-items: center; justify-content: space-between; gap: var(--space-sm);
      padding: 10px 0;
      border-bottom: 1px solid var(--color-hairline-soft);
    }
    .rtx:last-of-type { border-bottom: none; }
    .rtx-info { min-width: 0; }
    .rtx-name { font-weight: 500; font-size: 14px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .rtx-date { color: var(--color-muted); font-size: 12px; margin-top: 2px; }
    .rtx-amount { font-weight: 500; white-space: nowrap; }
    .rtx-amount.plus { color: var(--color-success); }
    .rtx-amount.minus { color: var(--color-error); }
    .rtx-skel { height: 40px; margin: 6px 0; border-radius: var(--rounded-sm); }
    .recent-more { align-self: center; }

    
    .link-btn {
      align-self: center;
      color: var(--color-primary-ink);
      font-size: 14px;
      background: none; border: none; padding: var(--space-sm) var(--space-md); cursor: pointer;
      font-weight: 500;
    }
    .link-btn:hover { text-decoration: underline; }
    /* add-card — наш фирменный жёлтый, как везде по приложению (не общий
     * var(--color-primary-ink) остальных .link-btn вроде "Показать всю
     * историю"). */
    .link-btn.add-card { color: rgba(255, 186, 38, 1); }
    .primary-link ::ng-deep button { padding: 14px 28px; height: auto; font-size: 15px; border-radius: 16px; }

           @media (min-width: 1024px) {
      .primary-link ::ng-deep button { padding: 18px 42px; font-size: 20px; }
      .wrap { padding-left: 120px; padding-right: 120px; }  
      .email-dash::before {
          width: 216px; margin: 36px 0 12px;}
      .no-card-ico { width: 160px; height: 160px;}
      .no-card {
        border-radius: 30px;
      border: 2px solid rgba(205, 205, 205, 1); 
      display: flex; flex-direction: column; align-items: center; justify-content: center;
      padding: var(--space-md);
      text-align: center;
      padding: 36px 0;
      margin-bottom: 28px;
      }

      
      .catalog-row { grid-template-rows: auto auto; }
      .cat-visual { grid-column: 1 / -1; grid-row: 1; display: flex; align-items: center; gap: var(--space-lg); }
      .cat-info { grid-column: 1 / -1; grid-row: 2; }
    }
  `],
})
export class HomePage implements OnInit, AfterViewInit, OnDestroy {
  private readonly cardsApi = inject(CardsApi);
  private readonly ordersApi = inject(OrdersApi);
  private readonly txApi = inject(TransactionsApi);
  private readonly toast = inject(ToastService);
  private readonly auth = inject(AuthService);
  private readonly cfg = inject(RuntimeConfigService);
  private readonly router = inject(Router);
  protected readonly verification = inject(VerificationService);

  goVerification(): void { void this.router.navigate(['/verification']); }
  private readonly platformId = inject(PLATFORM_ID);
  protected readonly serviceName = this.cfg.brand.service_name;
  
  protected readonly inkColor = 'var(--color-on-dark, #fff)';

  readonly catalog = input<boolean>(false);

  protected readonly products = signal<CardProduct[]>([]);
  protected readonly availableProducts = computed<CardProduct[]>(() =>
    this.products().filter((p) => !p.disable_purchase),
  );
  protected readonly badges = computed<Record<string, 'best-price' | 'best-rate' | 'most-popular'>>(() => {
    const list = this.availableProducts();
    if (list.length === 0) return {};
    const cheapest = [...list].sort((a, b) => a.issue_price - b.issue_price)[0];
    const restAfterCheapest = list.filter((p) => p.id !== cheapest.id);
    const bestRate = restAfterCheapest.length > 0
      ? [...restAfterCheapest].sort((a, b) => (a.deposit_fee_pct ?? 0) - (b.deposit_fee_pct ?? 0))[0]
      : null;
    const popular = restAfterCheapest.find((p) => p.id !== bestRate?.id) ?? null;
    const map: Record<string, 'best-price' | 'best-rate' | 'most-popular'> = {};
    if (cheapest) map[cheapest.id] = 'best-price';
    if (bestRate) map[bestRate.id] = 'best-rate';
    if (popular) map[popular.id] = 'most-popular';
    return map;
  });
  protected badgeOf(id: string): 'best-price' | 'best-rate' | 'most-popular' | null {
    return this.badges()[id] ?? null;
  }
  protected badgeText(b: 'best-price' | 'best-rate' | 'most-popular'): string {
    switch (b) {
      case 'best-price': return 'Дешевле всех';
      case 'best-rate': return 'Лучший курс';
      case 'most-popular': return 'Выбор большинства';
    }
  }
  /*
   * Тот же приём подсветки латинских слов в названии карты (например
   * "PREMIUM"), что и на странице карточки (product-detail.page.ts,
   * .name-accent) — здесь применяем к названию в каталоге карт.
   */
  protected nameWords(name: string): string[] {
    return name.split(' ');
  }
  protected isLatinWord(word: string): boolean {
    return /^[A-Za-z]+$/.test(word);
  }
  protected readonly cards = signal<UserCard[]>([]);
  protected readonly recentTx = signal<CardTransaction[] | null>(null);
  protected readonly currentId = signal<string>('');
  protected readonly current = computed<UserCard | null>(() => {
    const id = this.currentId();
    if (!id) return null;
    return this.cards().find((c) => c.id === id) ?? null;
  });
  protected readonly showBilling = signal<UserCard | null>(null);
  protected readonly showReferral = signal(false);
  protected readonly isAuthed = computed(() => this.auth.isAuthenticated());
  protected readonly loading = signal(true);
  protected readonly loadFailed = signal(false);
  protected readonly issuingOrderId = signal('');
  private issuePollTimer: ReturnType<typeof setInterval> | null = null;
  protected readonly isCatalogView = computed(() => this.catalog() || !this.isAuthed());
  private readonly detailsMap = signal<Record<string, CardDetails | undefined>>({});
  private readonly revealedIds = signal<Set<string>>(new Set());
  private readonly loadingDetailsIds = signal<Set<string>>(new Set());

  @ViewChild('strip', { static: false }) private stripRef?: ElementRef<HTMLElement>;
  private observer?: IntersectionObserver;
  private initialScrollDone = false;
  private suppressObserverUntil = 0;

  constructor() {
    effect(() => {
      const list = this.cards();
      if (list.length === 0) return;
      if (this.initialScrollDone) return;
      if (!isPlatformBrowser(this.platformId)) return;
      setTimeout(() => this.scrollToCurrent(false), 0);
    });
  }

  ngOnInit(): void {
    this.cardsApi.listProducts().subscribe((res) => this.products.set(res.products));
    if (this.auth.isAuthenticated()) {
      this.loadCards();
      if (!this.catalog()) {
        this.startIssuePollIfNeeded();
        this.loadRecentTx();
      }
    } else {
      this.loading.set(false);
    }
  }

  private loadRecentTx(): void {
    this.txApi.list().subscribe({
      next: (r) => this.recentTx.set((r?.items ?? []).slice(0, 3)),
      error: () => this.recentTx.set([]),
    });
  }

  protected txWhen(iso: string): string {
    const d = new Date(iso);
    const today = new Date();
    const day = d.toDateString() === today.toDateString()
      ? 'Сегодня'
      : d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' });
    return `${day}, ${d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}`;
  }

  protected loadCards(): void {
    this.cardsApi.myCards().subscribe({
      next: (res) => {
        this.applyCards(res.cards);
        this.loadFailed.set(false);
        this.loading.set(false);
      },
      error: () => {
        this.applyCards(this.cardsApi.cardsCache());
        this.loadFailed.set(this.cards().length === 0);
        this.loading.set(false);
      },
    });
  }

  private applyCards(cards: UserCard[]): void {
    this.cards.set(cards);
    if (cards.length === 0) return;
    if (!cards.some((c) => c.id === this.currentId())) this.currentId.set(cards[0].id);
    this.clearIssuingState();
  }

  private startIssuePollIfNeeded(): void {
    if (!isPlatformBrowser(this.platformId)) return;
    const id = readIssuingOrderId();
    if (!id) return;
    this.issuingOrderId.set(id);
    const tick = (): void => {
      this.ordersApi.get(id).subscribe({
        next: ({ order }) => {
          if (order.status === 'issued') {
            this.clearIssuingState();
            this.loadCards();
          } else if (order.status !== 'paid' && order.status !== 'issuing') {
            this.clearIssuingState();
          }
        },
        error: (err) => {
          const st = (err as { status?: number })?.status ?? 0;
          if (st === 404 || st === 403) this.clearIssuingState();
        },
      });
    };
    tick();
    this.issuePollTimer = setInterval(tick, 5000);
  }

  private clearIssuingState(): void {
    if (this.issuePollTimer) { clearInterval(this.issuePollTimer); this.issuePollTimer = null; }
    if (this.issuingOrderId()) this.issuingOrderId.set('');
    clearIssuingOrderId();
  }

  protected onPullRefresh(ptr: PullToRefreshComponent): void {
    let pending = 2;
    const done = (): void => { if (--pending === 0) ptr.finishRefresh(); };
    this.cardsApi.listProducts().subscribe({
      next: (res) => this.products.set(res.products),
      error: done,
      complete: done,
    });
    if (this.auth.isAuthenticated()) {
      this.cardsApi.myCards().subscribe({
        next: (res) => this.applyCards(res.cards),
        error: done,
        complete: done,
      });
      if (!this.catalog()) this.loadRecentTx();
    } else {
      done();
    }
  }

  ngAfterViewInit(): void {
    if (!isPlatformBrowser(this.platformId)) return;
    if (this.cards().length > 0) {
      setTimeout(() => this.scrollToCurrent(false), 0);
    }
  }

  ngOnDestroy(): void {
    this.observer?.disconnect();
    if (this.issuePollTimer) clearInterval(this.issuePollTimer);
  }

  productName(productId: string): string {
    return this.products().find((p) => p.id === productId)?.name ?? 'Карта';
  }
  detailsFor = (c: UserCard) => (this.revealedIds().has(c.id) ? this.detailsMap()[c.id] : undefined);
  isLoadingDetails = (c: UserCard) => this.loadingDetailsIds().has(c.id);
  pad(n: number): string { return n.toString().padStart(2, '0'); }
  formatPan(pan: string): string {
    if (!pan) return '';
    return pan.replace(/\s+/g, '').replace(/(.{4})/g, '$1 ').trim();
  }
  money(v: number | string | null | undefined, c: string | null | undefined): string { return formatAmount(v, c); }
  symbol(c: string | null | undefined): string { return symbolFor(c); }
  symBefore(c: string | null | undefined): boolean { return isPrefixSymbolCurrency(c); }
  protected formatBalance(n: number): string {
    if (!isFinite(n)) return '0.00';
    return (Math.floor(n * 100) / 100).toFixed(2);
  }
  toggleDetails(c: UserCard, ev: Event): void {
    ev.stopPropagation();
    if (this.loadingDetailsIds().has(c.id)) return;
    const revealed = this.revealedIds();
    if (revealed.has(c.id)) {
      const next = new Set(revealed);
      next.delete(c.id);
      this.revealedIds.set(next);
      return;
    }
    if (this.detailsMap()[c.id]) {
      this.revealedIds.set(new Set(revealed).add(c.id));
      return;
    }
    this.loadingDetailsIds.set(new Set(this.loadingDetailsIds()).add(c.id));
    this.cardsApi.details(c.id).subscribe({
      next: (d) => {
        this.detailsMap.set({ ...this.detailsMap(), [c.id]: d });
        this.revealedIds.set(new Set(this.revealedIds()).add(c.id));
        const lset = new Set(this.loadingDetailsIds()); lset.delete(c.id); this.loadingDetailsIds.set(lset);
      },
      error: () => {
        const lset = new Set(this.loadingDetailsIds()); lset.delete(c.id); this.loadingDetailsIds.set(lset);
        this.toast.error('Карта пока не выпущена');
      },
    });
  }

  private scrollToCurrent(smooth: boolean): void {
    const strip = this.stripRef?.nativeElement;
    if (!strip) return;
    const id = this.currentId();
    if (!id) return;
    const el = strip.querySelector<HTMLElement>(`[data-cid="${cssEscape(id)}"]`);
    if (!el) return;
    this.suppressObserverUntil = Date.now() + 600;
    if (smooth) {
      el.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
    } else {
      const stripRect = strip.getBoundingClientRect();
      const elRect = el.getBoundingClientRect();
      const slideLeftInStrip = elRect.left - stripRect.left + strip.scrollLeft;
      const target = Math.max(0, slideLeftInStrip - (strip.clientWidth - el.clientWidth) / 2);
      strip.scrollLeft = target;
    }
    this.initialScrollDone = true;
    if (!this.observer) this.attachObserver();
  }

  private attachObserver(): void {
    const strip = this.stripRef?.nativeElement;
    if (!strip) return;
    if (typeof IntersectionObserver === 'undefined') return;
    this.observer = new IntersectionObserver((entries) => {
      if (Date.now() < this.suppressObserverUntil) return;
      const visible = entries
        .filter((e) => e.isIntersecting)
        .sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
      if (!visible) return;
      const id = (visible.target as HTMLElement).getAttribute('data-cid');
      if (id && id !== this.currentId()) {
        this.selectId(id, false);
      }
    }, { root: strip, threshold: [0.6, 0.8, 0.95] });
    strip.querySelectorAll<HTMLElement>('[data-cid]').forEach((el) => this.observer!.observe(el));
  }

  protected onSlideClick(id: string, ev: Event): void {
    ev.preventDefault();
    if (this.stripJustDragged) return;
    if (id === this.currentId()) return;
    this.selectId(id, true);
  }

  private stripPending = false;
  private stripDragging = false;
  private stripDragStartX = 0;
  private stripDragStartScrollLeft = 0;
  private stripJustDragged = false;
  private static readonly STRIP_DRAG_THRESHOLD = 6;

  protected onStripPointerDown(e: PointerEvent): void {
    if (e.pointerType !== 'mouse') return;
    if (e.button !== 0) return;
    const strip = this.stripRef?.nativeElement;
    if (!strip) return;
    this.stripPending = true;
    this.stripDragStartX = e.clientX;
    this.stripDragStartScrollLeft = strip.scrollLeft;
  }

  protected onStripPointerMove(e: PointerEvent): void {
    if (!this.stripPending && !this.stripDragging) return;
    const strip = this.stripRef?.nativeElement;
    if (!strip) return;
    const dx = e.clientX - this.stripDragStartX;
    if (!this.stripDragging) {
      if (Math.abs(dx) < HomePage.STRIP_DRAG_THRESHOLD) return;
      this.stripDragging = true;
      strip.classList.add('dragging');
      try { strip.setPointerCapture(e.pointerId); } catch {  }
      this.suppressObserverUntil = Number.POSITIVE_INFINITY;
    }
    strip.scrollLeft = this.stripDragStartScrollLeft - dx;
    e.preventDefault();
  }

  protected onStripPointerUp(e: PointerEvent): void {
    const wasDragging = this.stripDragging;
    this.stripPending = false;
    this.stripDragging = false;
    const strip = this.stripRef?.nativeElement;
    if (strip && wasDragging) {
      try { strip.releasePointerCapture(e.pointerId); } catch {  }
      strip.classList.remove('dragging');
    }
    if (!wasDragging) {
      return;
    }
    this.stripJustDragged = true;
    setTimeout(() => { this.stripJustDragged = false; }, 0);
    if (!strip) {
      this.suppressObserverUntil = 0;
      return;
    }
    const stripRect = strip.getBoundingClientRect();
    const centerX = stripRect.left + stripRect.width / 2;
    const slides = Array.from(strip.querySelectorAll<HTMLElement>('[data-cid]'));
    let bestId: string | null = null;
    let bestDist = Infinity;
    for (const slide of slides) {
      const r = slide.getBoundingClientRect();
      const c = r.left + r.width / 2;
      const d = Math.abs(c - centerX);
      if (d < bestDist) { bestDist = d; bestId = slide.getAttribute('data-cid'); }
    }
    if (bestId && bestId !== this.currentId()) {
      this.selectId(bestId, true);
    } else if (bestId === this.currentId()) {
      this.suppressObserverUntil = Date.now() + 600;
      setTimeout(() => this.scrollToCurrent(true), 0);
    } else {
      this.suppressObserverUntil = 0;
    }
  }

  protected onStripPointerCancel(e: PointerEvent): void {
    const wasDragging = this.stripDragging;
    this.stripPending = false;
    this.stripDragging = false;
    const strip = this.stripRef?.nativeElement;
    if (strip && wasDragging) {
      try { strip.releasePointerCapture(e.pointerId); } catch {  }
      strip.classList.remove('dragging');
      this.suppressObserverUntil = Date.now() + 600;
    }
  }

  protected pickCard(id: string, ev?: Event): void {
    ev?.preventDefault();
    if (id === this.currentId()) return;
    this.selectId(id, true);
  }

  private selectId(id: string, scrollSmooth: boolean): void {
    if (id === this.currentId()) return;
    this.currentId.set(id);
    if (scrollSmooth) {
      setTimeout(() => this.scrollToCurrent(true), 0);
    }
  }

  protected serviceCtaFor(c: UserCard): { expired: boolean; daysLeft: number } | null {
    const frozenByService = c.status === 'frozen';
    if (!c.service_expires_at && !frozenByService) return null;
    if (!c.service_expires_at) {
      return frozenByService ? { expired: true, daysLeft: 0 } : null;
    }
    const expiresMs = Date.parse(c.service_expires_at);
    if (isNaN(expiresMs)) return frozenByService ? { expired: true, daysLeft: 0 } : null;
    const nowMs = Date.now();
    const diff = expiresMs - nowMs;
    const daysLeft = Math.ceil(diff / 86_400_000);
    if (diff <= 0) return { expired: true, daysLeft: 0 };
    if (daysLeft <= 7 || frozenByService) return { expired: false, daysLeft };
    return null;
  }

  protected bankImage(c: UserCard): string | null {
    return this.productOf(c)?.image_url ?? null;
  }
  protected catalogBgImage(p: CardProduct): string | null {
    return p.bg_image_url || null;
  }
  protected catalogBgGradient(p: CardProduct): string {
    return (p.bg_gradient || '').trim() || 'var(--color-surface)';
  }
  protected bankGradient(c: UserCard): string {
    return this.productOf(c)?.gradient ?? '';
  }
  protected cardCurrency(c: UserCard): string {
    return this.productOf(c)?.card_currency ?? '';
  }
  protected isTopUpDisabled(c: UserCard): boolean {
    return !!this.productOf(c)?.disable_topup;
  }
  private productOf(c: UserCard): CardProduct | undefined {
    return this.products().find((pp) => pp.id === c.card_product_id);
  }
  protected binCountryOf(c: UserCard): string {
    return c.issuer_country || productBins(this.productOf(c))[0]?.country || '';
  }

  protected daysWord(n: number): string {
    const mod10 = n % 10;
    const mod100 = n % 100;
    if (mod100 >= 11 && mod100 <= 14) return 'дней';
    if (mod10 === 1) return 'день';
    if (mod10 >= 2 && mod10 <= 4) return 'дня';
    return 'дней';
  }
}

function cssEscape(s: string): string {
  if (typeof CSS !== 'undefined' && typeof CSS.escape === 'function') return CSS.escape(s);
  return s.replace(/["'\\\n\r\t]/g, '\\$&');
}