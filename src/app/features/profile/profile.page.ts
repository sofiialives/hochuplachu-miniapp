import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { BackBarComponent } from '../../ui/back-bar.component';
import { ButtonComponent } from '../../ui/button.component';
import { AuthService } from '../../core/auth/auth.service';
import { CardsApi } from '../../core/api/cards.api';
import { ProfileApi } from '../../core/api/profile.api';
import { RuntimeConfigService } from '../../core/config/runtime-config.service';
import { ChatwootService } from '../../core/support/chatwoot.service';
import { ToastService } from '../../core/notifications/toast.service';
import { errorMessage } from '../../core/errors/api-error';
import { ReferralDialog } from './referral.dialog';
import { EmailLinkDialog } from '../auth/email-link.dialog';
import { VerificationService } from '../../core/verification/verification.service';

@Component({
  selector: 'app-profile',
  standalone: true,
  imports: [BackBarComponent, ButtonComponent, EmailLinkDialog, ReferralDialog, RouterLink],
  template: `<app-back-bar />
    <section class="wrap">
      <div class="head-row">
        <div class="avatar">
          @if (user()?.photo_url) {
            <img [src]="user()!.photo_url" alt="avatar" />
          } @else {
            <div class="ph" [style.background]="gradient()">{{ initials() }}</div>
          }
        </div>
        <div class="id-col">
          <h2 class="name">{{ displayName() }}</h2>
          @if (needsEmailLogin()) {
            <p class="email email-dash" aria-hidden="true"></p>
            <div class="email-login-desktop">
              <app-button variant="primary" (clicked)="emailLoginOpen.set(true)">Войти по email</app-button>
            </div>
          } @else {
            <p class="email">{{ user()?.email ?? '—' }}</p>
          }
        </div>
      </div>

      @if (needsEmailLogin()) {
        <!-- TG-аккаунт без привязанного email: вход в существующий
             email-аккаунт = link-flow (backend поглощает email-учётку
             вместе с её картами/заявками, LinkEmail merge).
             Эта кнопка — МОБИЛЬНАЯ версия (см. .email-login CSS ниже,
             прячется от 1024px). Десктопная версия — .email-login-desktop
             внутри .id-col выше, на месте плейсхолдера-черты. Два разных
             экземпляра из-за разных паддингов и позиции в макете. -->
        <div class="email-login">
          <app-button variant="primary" (clicked)="emailLoginOpen.set(true)">Войти по email</app-button>
        </div>
      }

      @if (verification.needed()) {
        <a class="verification-row" routerLink="/verification">
          <span class="vdot" aria-hidden="true"></span>
          <div class="vtext">
            <b>Аккаунт не верифицирован</b><br>
            <span>Пройти верификацию</span>
          </div>
          <span class="varr">›</span>
        </a>
      }

      <div class="menu">
        <a class="row" routerLink="/profile/orders">
        <div class="icon-wrap">
          <svg xmlns="http://www.w3.org/2000/svg" width="29" height="29" viewBox="0 0 29 29" fill="none">
            <path d="M20.874 24.4688L25.0729 20.3L23.8042 19.0313L20.874 21.901L19.6958 20.7229L18.4271 22.0219L20.874 24.4688ZM7.25 10.875H21.75V8.45833H7.25V10.875ZM21.75 27.7917C20.0785 27.7917 18.6538 27.2024 17.4761 26.0239C16.2984 24.8453 15.7091 23.4207 15.7083 21.75C15.7075 20.0793 16.2968 18.6547 17.4761 17.4761C18.6555 16.2976 20.0801 15.7083 21.75 15.7083C23.4199 15.7083 24.8449 16.2976 26.0251 17.4761C27.2052 18.6547 27.7941 20.0793 27.7917 21.75C27.7893 23.4207 27.2 24.8458 26.0239 26.0251C24.8478 27.2044 23.4231 27.7933 21.75 27.7917ZM3.625 26.5833V6.04167C3.625 5.37708 3.86183 4.80836 4.3355 4.3355C4.80917 3.86264 5.37789 3.62581 6.04167 3.625H22.9583C23.6229 3.625 24.192 3.86183 24.6657 4.3355C25.1394 4.80917 25.3758 5.37789 25.375 6.04167V14.1073C24.8111 13.8253 24.2218 13.6187 23.6072 13.4874C22.9926 13.3561 22.3735 13.2909 21.75 13.2917H7.25V15.7083H15.8292C15.4868 16.0507 15.1698 16.4233 14.8782 16.826C14.5866 17.2288 14.3296 17.6618 14.1073 18.125H7.25V20.5417H13.3823C13.342 20.7431 13.317 20.9396 13.3074 21.1313C13.2977 21.3231 13.2925 21.5293 13.2917 21.75C13.2917 22.5958 13.4077 23.4066 13.6397 24.1824C13.8717 24.9581 14.2189 25.698 14.6812 26.4021L14.5 26.5833L12.6875 24.7708L10.875 26.5833L9.0625 24.7708L7.25 26.5833L5.4375 24.7708L3.625 26.5833Z" fill="#FFBA26"/>
          </svg>
          </div>
          <div class="text"><b>Мои заказы</b><br><span>Карты, eSIM и сервисы</span></div>
          <span class="arr">›</span>
        </a>
        <a class="row" [href]="kbUrl || '#'" [attr.target]="kbUrl ? '_blank' : null" [class.muted]="!kbUrl">
        <div class="icon-wrap">
       <svg xmlns="http://www.w3.org/2000/svg" width="25" height="25" viewBox="0 0 25 25" fill="none">
        <g clip-path="url(#clip0_474_1721)">
        <path d="M19.5686 5.80315C20.6541 5.80315 21.695 6.23434 22.4626 7.00186C23.2301 7.76937 23.6613 8.81035 23.6613 9.89579V19.5677C23.6613 20.6531 23.2301 21.6941 22.4626 22.4616C21.695 23.2291 20.6541 23.6603 19.5686 23.6603H9.89676C8.81133 23.6603 7.77035 23.2291 7.00283 22.4616C6.23532 21.6941 5.80413 20.6531 5.80413 19.5677V9.89579C5.80413 8.81035 6.23532 7.76937 7.00283 7.00186C7.77035 6.23434 8.81133 5.80315 9.89676 5.80315H19.5686ZM15.8488 1.33887C17.0698 1.33887 17.8889 1.93373 18.4983 3.0286C18.5696 3.1567 18.6149 3.29757 18.6316 3.44317C18.6484 3.58878 18.6364 3.73627 18.5962 3.87721C18.556 4.01816 18.4884 4.1498 18.3973 4.26463C18.3062 4.37946 18.1934 4.47523 18.0653 4.54646C17.9372 4.61769 17.7963 4.66299 17.6507 4.67978C17.5051 4.69656 17.3576 4.68451 17.2167 4.6443C17.0757 4.60409 16.9441 4.53651 16.8293 4.44542C16.7144 4.35433 16.6187 4.24152 16.5474 4.11342C16.3008 3.66922 16.1657 3.57101 15.8488 3.57101H4.68806C4.07645 3.57101 3.57199 4.07547 3.57199 4.68708V15.8456C3.57199 16.2027 3.74386 16.5353 4.02623 16.744L4.13783 16.8165C4.2652 16.8891 4.37703 16.986 4.46693 17.1018C4.55684 17.2176 4.62306 17.3499 4.66182 17.4913C4.70058 17.6326 4.71112 17.7802 4.69283 17.9257C4.67455 18.0711 4.62779 18.2115 4.55524 18.3389C4.4827 18.4662 4.38577 18.5781 4.27 18.668C4.15424 18.7579 4.02189 18.8241 3.88053 18.8629C3.73917 18.9016 3.59156 18.9122 3.44613 18.8939C3.3007 18.8756 3.16029 18.8288 3.03292 18.7563C2.5191 18.4641 2.09179 18.0411 1.79441 17.5302C1.49704 17.0194 1.3402 16.4389 1.33984 15.8478V4.68708C1.33984 2.84333 2.84431 1.33887 4.68806 1.33887H15.8488ZM17.2918 11.7105L13.6166 15.3846L12.1735 13.9427C11.9631 13.7394 11.6811 13.6269 11.3885 13.6294C11.0959 13.632 10.8159 13.7493 10.609 13.9563C10.4021 14.1632 10.2847 14.4431 10.2822 14.7357C10.2796 15.0284 10.3921 15.3103 10.5954 15.5208L12.8276 17.7529C13.0369 17.9622 13.3207 18.0797 13.6166 18.0797C13.9126 18.0797 14.1964 17.9622 14.4057 17.7529L18.87 13.2886C19.0733 13.0781 19.1858 12.7962 19.1832 12.5036C19.1807 12.211 19.0633 11.931 18.8564 11.7241C18.6495 11.5172 18.3695 11.3998 18.0769 11.3973C17.7843 11.3947 17.5023 11.5072 17.2918 11.7105Z" fill="#FFBA26"/>
        </g>
        <defs>
        <clipPath id="clip0_474_1721">
        <rect width="25" height="25" fill="white"/>
        </clipPath>
        </defs>
        </svg>
        </div>
          <div class="text"><b>База знаний</b><br><span>Возможности наших карт</span></div>
          <span class="arr">›</span>
        </a>
        <button type="button" class="row" (click)="showRefDialog.set(true)">
        <div class="icon-wrap">
        <svg xmlns="http://www.w3.org/2000/svg" width="25" height="25" viewBox="0 0 25 25" fill="none">
          <g clip-path="url(#clip0_474_1712)">
          <path fill-rule="evenodd" clip-rule="evenodd" d="M14.3788 5.55523C14.3788 3.63757 15.9404 2.08301 17.8668 2.08301C19.7932 2.08301 21.3548 3.63757 21.3548 5.55523C21.3548 7.47288 19.7932 9.02746 17.8668 9.02746C16.8941 9.02746 16.015 8.63088 15.383 7.99287L10.5545 11.2804C10.5991 11.5023 10.6225 11.7314 10.6225 11.9655C10.6225 12.429 10.5309 12.8722 10.3648 13.2772L15.6593 16.7557C16.2602 16.2664 17.0291 15.9719 17.8668 15.9719C19.7932 15.9719 21.3548 17.5264 21.3548 19.4442C21.3548 21.3618 19.7932 22.9163 17.8668 22.9163C15.9404 22.9163 14.3788 21.3618 14.3788 19.4442C14.3788 18.9419 14.4863 18.4637 14.6795 18.0321L9.42781 14.5817C8.81519 15.114 8.01273 15.4377 7.13448 15.4377C5.20812 15.4377 3.64648 13.8831 3.64648 11.9655C3.64648 10.0478 5.20812 8.49327 7.13448 8.49327C8.24221 8.49327 9.22829 9.00723 9.86674 9.80715L14.5464 6.62094C14.4375 6.28466 14.3788 5.92634 14.3788 5.55523Z" fill="#FFBA26"/>
          </g>
        <defs>
        <clipPath id="clip0_474_1712">
        <rect width="25" height="25" fill="white"/>
        </clipPath>
        </defs>
      </svg>
      </div>
          <div class="text"><b>Реферальная ссылка</b><br><span>Поделиться реферальной ссылкой</span></div>
          <span class="arr">›</span>
        </button>
        @if (useChatwoot()) {
          <button type="button" class="row" (click)="openSupportChat()">
          <div class="icon-wrap">
          <svg xmlns="http://www.w3.org/2000/svg" width="25" height="25" viewBox="0 0 25 25" fill="none">
            <path d="M4.63841 25.0031H17.1868V22.6591C17.1868 21.6229 16.7752 20.6292 16.0426 19.8966C15.3099 19.1639 14.3162 18.7523 13.2801 18.7523H11.7174C11.5102 18.7523 11.3115 18.67 11.1649 18.5235C11.0184 18.3769 10.9361 18.1782 10.9361 17.971C10.9361 17.7638 11.0184 17.565 11.1649 17.4185C11.3115 17.2719 11.5102 17.1896 11.7174 17.1896H13.2801C14.7307 17.1896 16.1219 17.7659 17.1476 18.7916C18.1733 19.8173 18.7495 21.2085 18.7495 22.6591V25.0031H19.1402C19.8778 25.0031 20.5466 24.7046 21.0311 24.2218H21.0936V24.1577C21.5627 23.6617 21.8229 23.0042 21.8202 22.3215V10.4294C24.3362 10.3294 25.841 7.53843 24.4971 5.36942L23.7127 4.10363C23.4157 3.624 23.0012 3.22814 22.5084 2.95357C22.0156 2.679 21.4608 2.53482 20.8967 2.53469H18.6542V1.54082C18.6542 1.33847 18.6144 1.13811 18.5369 0.951171C18.4595 0.764231 18.346 0.594372 18.2029 0.451294C18.0598 0.308216 17.89 0.194721 17.703 0.117288C17.5161 0.0398545 17.3157 0 17.1134 0C16.6116 0.000205174 16.1148 0.099236 15.6514 0.291438C15.1879 0.48364 14.7668 0.765249 14.4122 1.12019C14.0575 1.47513 13.7762 1.89644 13.5844 2.36008C13.3926 2.82372 13.294 3.3206 13.2942 3.82235V9.22302C11.2971 9.41992 9.78905 10.3638 8.6811 11.6952C7.99352 12.5203 7.46377 13.4892 7.0559 14.5049C6.70117 15.2238 6.4527 16.0035 6.33081 16.8255L6.3105 16.9177C5.87919 18.7648 5.72761 20.6026 5.68073 21.9683C5.66198 22.5528 5.66198 23.056 5.68823 23.4404H4.63841C4.03804 23.4405 3.45074 23.265 2.94874 22.9357C2.44674 22.6064 2.05192 22.1376 1.81284 21.5869C1.57376 21.0362 1.50084 20.4276 1.60305 19.836C1.70526 19.2444 1.97814 18.6955 2.38814 18.257L3.82581 16.7146C4.8163 15.6516 5.35578 14.2459 5.33072 12.7932C5.30565 11.3405 4.71799 9.95424 3.69142 8.92611L2.28031 7.51499C2.20823 7.44037 2.12202 7.38084 2.02669 7.33989C1.93136 7.29894 1.82883 7.27739 1.72509 7.27649C1.62134 7.27559 1.51845 7.29536 1.42243 7.33464C1.3264 7.37393 1.23916 7.43195 1.1658 7.50531C1.09244 7.57867 1.03442 7.66591 0.995133 7.76194C0.955847 7.85796 0.936077 7.96085 0.936979 8.06459C0.93788 8.16834 0.959435 8.27087 1.00038 8.3662C1.04133 8.46152 1.10086 8.54774 1.17549 8.61982L2.5866 10.0309C3.32796 10.7721 3.75245 11.7722 3.77053 12.8203C3.78861 13.8684 3.39885 14.8826 2.68348 15.6488L1.24581 17.1912C0.629664 17.8529 0.219986 18.68 0.0669961 19.5711C-0.0859933 20.4622 0.0243554 21.3786 0.384514 22.2079C0.744672 23.0372 1.33899 23.7434 2.0946 24.2399C2.85021 24.7364 3.73428 25.0016 4.63841 25.0031Z" fill="#FFBA26"/>
          </svg>
          </div>
            <div class="text"><b>Связаться с нами</b><br><span>Начать диалог</span></div>
            <span class="arr">›</span>
          </button>
        } @else {
          <a class="row" [href]="supportUrl || '#'" [attr.target]="supportUrl ? '_blank' : null" [class.muted]="!supportUrl">
          <div class="icon-wrap">
         <svg xmlns="http://www.w3.org/2000/svg" width="25" height="25" viewBox="0 0 25 25" fill="none">
          <path d="M4.63841 25.0031H17.1868V22.6591C17.1868 21.6229 16.7752 20.6292 16.0426 19.8966C15.3099 19.1639 14.3162 18.7523 13.2801 18.7523H11.7174C11.5102 18.7523 11.3115 18.67 11.1649 18.5235C11.0184 18.3769 10.9361 18.1782 10.9361 17.971C10.9361 17.7638 11.0184 17.565 11.1649 17.4185C11.3115 17.2719 11.5102 17.1896 11.7174 17.1896H13.2801C14.7307 17.1896 16.1219 17.7659 17.1476 18.7916C18.1733 19.8173 18.7495 21.2085 18.7495 22.6591V25.0031H19.1402C19.8778 25.0031 20.5466 24.7046 21.0311 24.2218H21.0936V24.1577C21.5627 23.6617 21.8229 23.0042 21.8202 22.3215V10.4294C24.3362 10.3294 25.841 7.53843 24.4971 5.36942L23.7127 4.10363C23.4157 3.624 23.0012 3.22814 22.5084 2.95357C22.0156 2.679 21.4608 2.53482 20.8967 2.53469H18.6542V1.54082C18.6542 1.33847 18.6144 1.13811 18.5369 0.951171C18.4595 0.764231 18.346 0.594372 18.2029 0.451294C18.0598 0.308216 17.89 0.194721 17.703 0.117288C17.5161 0.0398545 17.3157 0 17.1134 0C16.6116 0.000205174 16.1148 0.099236 15.6514 0.291438C15.1879 0.48364 14.7668 0.765249 14.4122 1.12019C14.0575 1.47513 13.7762 1.89644 13.5844 2.36008C13.3926 2.82372 13.294 3.3206 13.2942 3.82235V9.22302C11.2971 9.41992 9.78905 10.3638 8.6811 11.6952C7.99352 12.5203 7.46377 13.4892 7.0559 14.5049C6.70117 15.2238 6.4527 16.0035 6.33081 16.8255L6.3105 16.9177C5.87919 18.7648 5.72761 20.6026 5.68073 21.9683C5.66198 22.5528 5.66198 23.056 5.68823 23.4404H4.63841C4.03804 23.4405 3.45074 23.265 2.94874 22.9357C2.44674 22.6064 2.05192 22.1376 1.81284 21.5869C1.57376 21.0362 1.50084 20.4276 1.60305 19.836C1.70526 19.2444 1.97814 18.6955 2.38814 18.257L3.82581 16.7146C4.8163 15.6516 5.35578 14.2459 5.33072 12.7932C5.30565 11.3405 4.71799 9.95424 3.69142 8.92611L2.28031 7.51499C2.20823 7.44037 2.12202 7.38084 2.02669 7.33989C1.93136 7.29894 1.82883 7.27739 1.72509 7.27649C1.62134 7.27559 1.51845 7.29536 1.42243 7.33464C1.3264 7.37393 1.23916 7.43195 1.1658 7.50531C1.09244 7.57867 1.03442 7.66591 0.995133 7.76194C0.955847 7.85796 0.936077 7.96085 0.936979 8.06459C0.93788 8.16834 0.959435 8.27087 1.00038 8.3662C1.04133 8.46152 1.10086 8.54774 1.17549 8.61982L2.5866 10.0309C3.32796 10.7721 3.75245 11.7722 3.77053 12.8203C3.78861 13.8684 3.39885 14.8826 2.68348 15.6488L1.24581 17.1912C0.629664 17.8529 0.219986 18.68 0.0669961 19.5711C-0.0859933 20.4622 0.0243554 21.3786 0.384514 22.2079C0.744672 23.0372 1.33899 23.7434 2.0946 24.2399C2.85021 24.7364 3.73428 25.0016 4.63841 25.0031Z" fill="#FFBA26"/>
          </svg>
          </div>
            <div class="text"><b>Связаться с нами</b><br><span>Начать диалог</span></div>
            <span class="arr">›</span>
          </a>
        }
      </div>

      @if (!emailOnly()) {
        <div class="notifications">
          <h3>Уведомления</h3>
          <label class="toggle">
            <span>Email-уведомления</span>
            <input
              class="switch"
              type="checkbox"
              [disabled]="notifLoading()"
              [checked]="user()?.email_notifications_enabled ?? false"
              (change)="toggleNotif($any($event.target).checked)" />
          </label>
        </div>
      }
      
      @if (isStaff()) {
        <a class="admin" href="/admin">Открыть админ-панель →</a>
      }
    </section>

    @if (showRefDialog()) {
      <app-referral-dialog (closed)="showRefDialog.set(false)" />
    }
    @if (emailLoginOpen()) {
      <app-email-link-dialog mode="login" [closable]="true"
        (closed)="emailLoginOpen.set(false)"
        (linked)="onEmailLinked()" />
    }`,
  styles: [`
    .wrap {
      padding: 0 16px;
      
      padding-bottom: 110px;
      max-width: 1200px; margin: 0 auto;
      display: flex; flex-direction: column;
    }
    .head-row {
      display: flex; flex-direction: column; align-items: center;
    }
    .id-col { display: flex; flex-direction: column; align-items: center; }
    .avatar { 
      position: relative;
      width: 96px;
      height: 96px;
      margin-bottom: 18px;
    }
    .avatar img, .avatar .ph {
      width: 96px; height: 96px; border-radius: 50%;
      background: var(--grad-primary);
      color: var(--color-on-primary); display: flex; align-items: center; justify-content: center;
      font-size: 22px; font-family: var(--font-display);
      box-shadow: var(--shadow-primary);
    }

    .avatar::before {
      content: "";
      position: absolute;
      inset: -6.4px;
      border-radius: 50%;
      padding: 1px;
      background: radial-gradient(
      147.58% 147.58% at 53.03% 53.33%,
    #FFBA26 0%,
    rgba(255, 186, 38, 0) 100%
  );
  -webkit-mask:
    linear-gradient(#fff 0 0) content-box,
    linear-gradient(#fff 0 0);
  -webkit-mask-composite: xor;
  mask-composite: exclude;

}
    .name { text-align: center; margin-bottom: 4px; text-transform: uppercase; font-size: 20px; font-family: "Syncopate Cyr" }
    .email { text-align: center; color: var(--color-ink); margin-bottom: 20px; }

    
    .email-dash::before {
      content: '';
      display: block;
      width: 164px;
      height: 2px;
      border-radius: 999px;
      background: var(--color-hairline);
      margin: 20px 0;
    }

    
    .email-login-desktop { display: none; }

    
    .email-login {
      display: flex; justify-content: center;
      margin: calc(-1 * var(--space-md)) 0 var(--space-xl);
    }
    .email-login ::ng-deep button { padding: 20px 40px; height: auto; font-size: 20px; border-radius: 20px; }

    .menu { display: flex; flex-direction: column; gap: 8px; margin-bottom: var(--space-xl); }
    .row {
      display: flex; align-items: center; gap: 14px;
      padding: 14px 16px;
      background: var(--color-surface);
      border: 1px solid transparent;
      border-radius: var(--rounded-lg);
      box-shadow: var(--shadow-card);
      text-decoration: none; color: var(--color-ink); text-align: left;
      transition: background var(--dur-quick) ease, border-color var(--dur-quick) ease, transform var(--dur-quick) var(--ease-out), box-shadow var(--dur-quick) ease;
    }
    .row-guide { padding-top: 8px; padding-bottom: 8px; margin-top: 16px;}
    .row:hover { background: var(--color-surface); border-color: var(--color-primary); transform: translateY(-1px); box-shadow: var(--shadow-card-hover); }
    .row.muted { opacity: .55; pointer-events: none; }
    .ico {
      width: 22px; height: 22px; flex: 0 0 22px;
      color: var(--color-primary-ink);
    }
    .text-guide {text-align: center;}
    .text { flex: 1; font-size: 13px; line-height: 1.25; }
    .text b { font-weight: 600; font-size: 16px }
    .text span { color: rgba(0, 0, 0, 1); }
    .arr { color: var(--color-muted); font-size: 18px; line-height: 1; }
    .verification-row {
      display: flex; align-items: center; gap: 14px;
      padding: 14px 16px;
      background: color-mix(in srgb, var(--color-primary) 8%, var(--color-canvas));
      border: 1px solid color-mix(in srgb, var(--color-primary) 40%, var(--color-hairline));
      border-radius: var(--rounded-md);
      text-decoration: none; color: var(--color-ink);
      margin: 0 0 var(--space-lg);
    }
    .verification-row .vdot {
      width: 10px; height: 10px; border-radius: 50%; flex: 0 0 10px;
      background: var(--color-warning, #f0a020);
      box-shadow: 0 0 0 4px color-mix(in srgb, var(--color-warning, #f0a020) 22%, transparent);
    }
    .verification-row .vtext { flex: 1; font-size: 15px; line-height: 1.25; }
    .verification-row .vtext b { font-weight: 600; }
    .verification-row .vtext span { color: var(--color-muted); font-size: 13px; }
    .verification-row .varr { color: var(--color-muted); font-size: 18px; line-height: 1; }
    .notifications { padding: var(--space-md); background: var(--color-surface); border: 1px solid transparent; border-radius: var(--rounded-lg); box-shadow: var(--shadow-card); }
    .notifications h3 { margin-bottom: 20px; font-size: 14px; color: var(--color-ink); text-transform: uppercase; font-family: "Syncopate Cyr" }
    .toggle { display: flex; justify-content: space-between; align-items: center; gap: var(--space-md); cursor: pointer; font-size: 15px; color: var(--color-ink); }
    .switch {
      appearance: none; -webkit-appearance: none;
      width: 44px; height: 26px; flex: 0 0 44px;
      border-radius: 999px;
      background: color-mix(in srgb, var(--color-hairline) 80%, transparent);
      position: relative;
      cursor: pointer;
      transition: background .18s ease;
      margin: 0;
    }
    .switch::before {
      content: '';
      position: absolute;
      width: 22px; height: 22px;
      border-radius: 50%;
      background: #fff;
      top: 2px; left: 2px;
      box-shadow: 0 1px 3px rgba(0,0,0,.18), 0 1px 1px rgba(0,0,0,.08);
      transition: transform .18s ease;
    }
    .switch:checked { background: rgba(255, 186, 38, 1); }
    .switch:checked::before { transform: translateX(18px); }
    .switch:disabled { opacity: .6; cursor: progress; }
    .switch:focus-visible { outline: 2px solid var(--color-primary); outline-offset: 2px; }
    .admin { display: block; text-align: center; margin-top: var(--space-lg); color: var(--color-primary-ink); }
    .icon-wrap {
  position: relative;
  width: 22px;
  height: 22px;
  flex: 0 0 22px;
  display: flex;
  align-items: center;
  justify-content: center;
}

.icon-wrap svg {
  width: 22px;
  height: 22px;
  display: block;
  position: relative;
  z-index: 1;
}

.icon-wrap::before {
  content: "";
  position: absolute;
  inset: -8.4px;
  border-radius: 50%;
  padding: 2px;
  background: radial-gradient(
    147.58% 147.58% at 53.03% 53.33%,
    #FFBA26 0%,
    rgba(255, 186, 38, 0) 100%
  );
  -webkit-mask:
    linear-gradient(#fff 0 0) content-box,
    linear-gradient(#fff 0 0);
  -webkit-mask-composite: xor;
  mask:
    linear-gradient(#fff 0 0) content-box,
    linear-gradient(#fff 0 0);
  mask-composite: exclude;
  pointer-events: none;
}
    @media (min-width: 1024px) {
      .wrap { padding-left: 120px; padding-right: 120px; }

      .head-row {
        flex-direction: row; justify-content: center; align-items: center;
        gap: 32px; margin-bottom: 60px;
      }
      .avatar { margin-bottom: 0; width: 144px; height: 144px; }
      .avatar img, .avatar .ph { width: 144px; height: 144px; font-size: 32px; }
      .email { margin-bottom: 0; }

      
      .email-dash { display: none; }
      .email-login { display: none; }
      .email-login-desktop {
        display: flex; justify-content: center;
      }
        .name { font-size: 28px; }
      .email-login-desktop ::ng-deep button { padding: 16px 32px; height: auto; font-size: 18px; border-radius: 16px; }
  `],
})
export class ProfilePage implements OnInit {
  private readonly auth = inject(AuthService);
  private readonly api = inject(ProfileApi);
  private readonly cardsApi = inject(CardsApi);
  private readonly cfg = inject(RuntimeConfigService);
  private readonly chatwoot = inject(ChatwootService);
  private readonly toast = inject(ToastService);
  protected readonly verification = inject(VerificationService);
  protected readonly hasNoCards = signal<boolean | null>(null);

  ngOnInit(): void {
    this.cardsApi.myCards().subscribe({
      next: (r) => this.hasNoCards.set((r.cards ?? []).length === 0),
      error: () => this.hasNoCards.set(null),
    });
  }

  protected readonly user = this.auth.user;
  protected readonly isStaff = this.auth.isStaff;
  protected readonly showRefDialog = signal(false);
  protected readonly notifLoading = signal(false);
  protected readonly kbUrl = this.cfg.brand.knowledge_base_url;
  protected readonly supportUrl = this.cfg.brand.support_bot_url;
  protected readonly useChatwoot = computed(
    () => this.chatwoot.available() && !this.user()?.telegram_id,
  );
  protected readonly emailOnly = computed(() => {
    const u = this.user();
    return !!u && !u.telegram_id;
  });
  protected readonly needsEmailLogin = computed(() => {
    const u = this.user();
    return !!u && !u.email_linked;
  });
  protected readonly emailLoginOpen = signal(false);

  protected onEmailLinked(): void {
    this.emailLoginOpen.set(false);
    this.toast.success('Email привязан');
    this.cardsApi.myCards().subscribe({
      error: () => {  },
    });
  }

  protected openSupportChat(): void {
    this.chatwoot.open();
  }

  protected displayName(): string {
    const u = this.user();
    if (!u) return '';
    return [u.first_name, u.last_name].filter(Boolean).join(' ') || u.username || 'Пользователь';
  }
  protected initials(): string {
    const u = this.user();
    const first = (u?.first_name?.[0] ?? '').toUpperCase();
    const last = (u?.last_name?.[0] ?? '').toUpperCase();
    if (!first && !last) {
      return (u?.email?.[0] ?? '').toUpperCase();
    }
    return first + last;
  }
  protected gradient(): string {
    const id = this.user()?.id ?? '';
    let hash = 0;
    for (const ch of id) hash = (hash << 5) - hash + ch.charCodeAt(0);
    const h1 = (hash & 0xff) % 360;
    return `linear-gradient(135deg, hsl(${h1}, 60%, 60%), hsl(${(h1 + 60) % 360}, 60%, 50%))`;
  }
  protected toggleNotif(value: boolean): void {
    this.notifLoading.set(true);
    this.api.update({ email_notifications_enabled: value }).subscribe({
      next: () => {
        this.auth.refreshMe().subscribe({
          next: () => {
            this.notifLoading.set(false);
            this.toast.success(value ? 'Email-уведомления включены' : 'Email-уведомления отключены');
          },
          error: () => this.notifLoading.set(false),
        });
      },
      error: (err) => {
        this.notifLoading.set(false);
        this.toast.error(errorMessage(err, 'Не удалось обновить настройки'));
      },
    });
  }
}