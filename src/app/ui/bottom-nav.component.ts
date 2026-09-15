import { Component, inject } from '@angular/core';
import { RouterLink, RouterLinkActive } from '@angular/router';
import { AuthService } from '../core/auth/auth.service';
import { GuideTargetDirective } from '../features/guides/guide-target.directive';

@Component({
  selector: 'app-bottom-nav',
  standalone: true,
  imports: [RouterLink, RouterLinkActive, GuideTargetDirective],
  template: `
    <div class="wrap">
    <nav class="nav">
      <div class="bar">
      <a routerLink="/" [routerLinkActiveOptions]="{exact:true}" routerLinkActive="active">
        <svg class="ico" width="24" height="24" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path d="M12.87 2.54974C12.6374 2.32252 12.3252 2.19531 12 2.19531C11.6748 2.19531 11.3626 2.32252 11.13 2.54974L3 10.4347L3 19.7497C3 20.4397 3.56 20.9997 4.25 20.9997L9 20.9997L9 15.9997C9 14.3447 10.345 12.9997 12 12.9997C13.655 12.9997 15 14.3447 15 15.9997L15 20.9997L19.75 20.9997C20.44 20.9997 21 20.4397 21 19.7497L21 10.4347L12.87 2.54974Z" fill="currentColor"/>
        </svg>
        <span>Главная</span>
      </a>
      <a appGuideTarget="nav-cards" routerLink="/cards" routerLinkActive="active">
        <svg class="ico" width="24" height="20" viewBox="0 0 24 20" fill="none" aria-hidden="true">
          <path d="M24 15.4853C24 16.4331 23.6207 17.342 22.9456 18.0122C22.2705 18.6823 21.3548 19.0588 20.4 19.0588H3.6C2.64522 19.0588 1.72955 18.6823 1.05442 18.0122C0.379285 17.342 0 16.4331 0 15.4853V7.14706H24V15.4853ZM15.6 11.9118C15.2817 11.9118 14.9765 12.0373 14.7515 12.2607C14.5264 12.484 14.4 12.787 14.4 13.1029C14.4 13.4189 14.5264 13.7218 14.7515 13.9452C14.9765 14.1686 15.2817 14.2941 15.6 14.2941H19.2C19.5183 14.2941 19.8235 14.1686 20.0485 13.9452C20.2736 13.7218 20.4 13.4189 20.4 13.1029C20.4 12.787 20.2736 12.484 20.0485 12.2607C19.8235 12.0373 19.5183 11.9118 19.2 11.9118H15.6ZM20.4 0C21.3548 0 22.2705 0.376496 22.9456 1.04666C23.6207 1.71683 24 2.62577 24 3.57353V4.76471H0V3.57353C0 2.62577 0.379285 1.71683 1.05442 1.04666C1.72955 0.376496 2.64522 0 3.6 0H20.4Z" fill="currentColor"/>
        </svg>
        <span>Карты</span>
      </a>
      <a routerLink="/esim" routerLinkActive="active">
        <svg class="ico" width="24" height="24" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <mask id="mask0_427_1636" style="mask-type:luminance" maskUnits="userSpaceOnUse" x="3" y="1" width="18" height="22">
            <path d="M4 2H16.4445L20 5.6365V22H4V2Z" fill="white" stroke="white" stroke-width="2" stroke-linejoin="round"/>
            <path d="M16.5 13H7.5V18H16.5V13Z" fill="black" stroke="black" stroke-width="2" stroke-linejoin="round"/>
            <path d="M7.5 6V9M10.5 6V9M13.5 6V9" stroke="black" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
          </mask>
          <g mask="url(#mask0_427_1636)">
            <path d="M0 0H24V24H0V0Z" fill="currentColor"/>
          </g>
        </svg>
        <span>eSIM</span>
      </a>
      <a routerLink="/services" routerLinkActive="active">
        <svg class="ico" width="24" height="24" viewBox="0 0 30 30" fill="none" aria-hidden="true">
          <path fill-rule="evenodd" clip-rule="evenodd" d="M20 20H25V25H20V20ZM12.5 20H17.5V25H12.5V20ZM5 20H10V25H5V20ZM20 12.5H25V17.5H20V12.5ZM12.5 12.5H17.5V17.5H12.5V12.5ZM5 12.5H10V17.5H5V12.5ZM20 5H25V10H20V5ZM12.5 5H17.5V10H12.5V5ZM5 5H10V10H5V5Z" fill="currentColor"/>
        </svg>
        <span>Сервисы</span>
      </a>
      <!-- Гостю «Профиль» ведёт прямо на /login (страница профиля всё равно
           под authGuard — без этого клик уходил бы в returnUrl-редирект). -->
      <a [routerLink]="isAuthed() ? '/profile' : '/login'" routerLinkActive="active">
        <svg class="ico" width="24" height="24" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <g clip-path="url(#clip0_427_1631)">
            <path d="M23.0982 4.42579C22.7976 3.21439 22.4249 2.24288 22.016 1.53523C21.2705 0.263868 20.4048 0 19.8156 0C19.2265 0 18.3607 0.263868 17.6152 1.53523C17.2064 2.23088 16.8457 3.17841 16.5451 4.36582C13.6713 3.37031 10.3407 3.37031 7.46693 4.36582C7.16633 3.17841 6.80561 2.23088 6.39679 1.53523C5.6513 0.263868 4.78557 0 4.19639 0C3.60721 0 2.74148 0.263868 1.99599 1.53523C1.57515 2.24288 1.21443 3.21439 0.913828 4.42579C0.613226 5.6012 0.396794 6.94453 0.240481 8.4078C0.0120241 10.6267 0 13.2894 0 13.8051C0 15.5322 0.517034 17.1514 1.40681 18.5787L3.39078 16.5997C3.51102 16.4798 3.70341 16.4798 3.81162 16.5997C3.91984 16.7196 3.93186 16.9115 3.81162 17.0195L1.74349 19.0825C2.11623 19.6102 2.5491 20.1019 3.01804 20.5577L5.18237 18.3988C5.30261 18.2789 5.49499 18.2789 5.60321 18.3988C5.71142 18.5187 5.72345 18.7106 5.60321 18.8186L3.4509 20.9655C5.62725 22.8366 8.65732 24 12 24C15.3427 24 18.3727 22.8366 20.5491 20.9655L18.3968 18.8186C18.2766 18.6987 18.2766 18.5067 18.3968 18.3988C18.517 18.2909 18.7094 18.2789 18.8176 18.3988L20.982 20.5577C21.4629 20.1019 21.8838 19.6102 22.2565 19.0825L20.1884 17.0195C20.0681 16.8996 20.0681 16.7076 20.1884 16.5997C20.3086 16.4918 20.501 16.4798 20.6092 16.5997L22.5932 18.5787C23.483 17.1514 24 15.5322 24 13.8051C24 13.2894 24 10.6267 23.7595 8.4078C23.6032 6.94453 23.3747 5.6012 23.0862 4.42579H23.0982ZM6.57716 14.3928C5.57916 14.3928 4.77355 13.5892 4.77355 12.5937C4.77355 11.5982 5.57916 10.7946 6.57716 10.7946C7.57515 10.7946 8.38076 11.5982 8.38076 12.5937C8.38076 13.5892 7.57515 14.3928 6.57716 14.3928ZM13.7916 20.3898C13.1543 20.3898 12.5411 20.1379 12.0962 19.6822C12.0601 19.6462 12.024 19.5982 11.988 19.5622C11.9519 19.5982 11.9279 19.6462 11.8798 19.6822C11.658 19.9058 11.394 20.0834 11.103 20.2046C10.812 20.3258 10.4997 20.3882 10.1844 20.3882C9.86901 20.3882 9.55678 20.3258 9.26576 20.2046C8.97475 20.0834 8.71072 19.9058 8.48898 19.6822L9.34269 18.8306C9.7996 19.2864 10.5932 19.2864 11.0381 18.8306C11.1495 18.7185 11.2377 18.5856 11.2975 18.4395C11.3574 18.2933 11.3877 18.1369 11.3868 17.979C11.3868 17.943 11.3748 17.919 11.3627 17.8831C10.3407 17.5832 9.58317 16.5877 9.58317 15.5802C9.58317 14.9205 10.6653 14.3808 11.988 14.3808C13.3106 14.3808 14.3928 14.9205 14.3928 15.5802C14.3928 16.5877 13.6353 17.5832 12.6132 17.8831C12.6132 17.919 12.5892 17.943 12.5892 17.979C12.5892 18.3028 12.7094 18.6027 12.9379 18.8306C13.3948 19.2864 14.1884 19.2864 14.6333 18.8306L15.487 19.6822C15.0301 20.1379 14.4289 20.3898 13.7916 20.3898ZM17.3988 14.3928C16.4008 14.3928 15.5952 13.5892 15.5952 12.5937C15.5952 11.5982 16.4008 10.7946 17.3988 10.7946C18.3968 10.7946 19.2024 11.5982 19.2024 12.5937C19.2024 13.5892 18.3968 14.3928 17.3988 14.3928Z" fill="currentColor"/>
          </g>
          <defs>
            <clipPath id="clip0_427_1631">
              <rect width="24" height="24" fill="white"/>
            </clipPath>
          </defs>
        </svg>
        <span>Профиль</span>
      </a>
      </div>
      <!-- Декоративная жёлтая черта под баром — статичная, не привязана к
           активному пункту. Ширина ~ под 3 центральные иконки. -->
           </nav>
           <span class="nav-underline" aria-hidden="true"></span>
    </div>`,
  styles: [`
    /* Сам .nav — просто визуальный бар, позиционирование (fixed) теперь
       на .wrap ниже. */
    .nav {
      view-transition-name: bottom-nav;
      background: rgba(255, 255, 255, 1);
      border-radius: 72px;
      padding: 10px 16px;
      display: flex; flex-direction: column; align-items: center;
    }
    /* position:fixed, 20px от низа экрана — по явному запросу владельца
       (раньше сидел в обычном потоке документа, у низа страницы просто
       потому что был последним элементом). ВАЖНО: теперь футер выпал из
       потока — страницы ПОД ним нуждаются в нижнем padding (высота нав-
       бара + 20px + отступ), иначе последний контент экрана будет
       перекрыт футером. Этот padding нужно добавить на каждой странице
       отдельно (обычно на .wrap той страницы) — этот компонент сам не
       может знать высоту контента других страниц. */
    .wrap {
      position: fixed;
      left: 0; right: 0; bottom: 20px;
      z-index: 500;
      padding: 0 16px;
      max-width: 1200px; margin: 0 auto;
      display: flex; flex-direction: column;
    }
    /* <1024px — тот же паттерн, что на главной/сервисах: 52px с боков
       фиксированно на узких экранах почти не оставляет места контенту. */

    .bar {
      display: flex; justify-content: space-between; align-items: center;
      width: 100%;
    }
    /* Декоративная черта под баром — 6px высота, border-radius 72px
       (полная пилюля), ширина примерно под 3 центральные иконки. */
    /* Декоративная черта ПОСЛЕ футера (не внахлёст — margin-top:12px, а
       не отрицательный margin) — 6px высота, border-radius 72px (полная
       пилюля). На мобиле ширина под 3 центральные иконки, на десктопе —
       под все 5 (см. медиа-запрос ниже). */
    .nav-underline {
      position: relative;
      z-index: 1;
      width: 55%;
      max-width: 220px;
      height: 6px;
      margin: 0 auto;
      background: rgba(255, 186, 38, 1);
      border-radius: 72px;
      pointer-events: none;
    }
    a {
      display: inline-flex; flex-direction: column; align-items: center; justify-content: center; gap: 2px;
      color: rgba(186, 186, 186, 1);
      font-size: 13px; font-weight: 500;
      text-decoration: none;
      white-space: nowrap;
      transition: color var(--dur-quick) ease, background var(--dur-quick) ease, padding var(--dur-quick) ease;
    }
    a span { display: none; }
    /* Иконки — fill="currentColor" в разметке, цвет управляется отсюда
       через CSS color (наследуется в SVG). Неактивная — серая. */
    .ico { width: 24px; height: 24px; flex: 0 0 24px; color: inherit; }
    /* Активный пункт — кремовая подложка вокруг иконки, сама иконка —
       насыщенный жёлтый (контраст держится за счёт разницы кремовый/
       насыщенный, а не одинаковых значений). */
    a.active {
      color: rgba(255, 186, 38, 1);
      padding: 6px 12px;
      background: rgba(255, 245, 222, 1);
      border-radius: 128px;
    }

    /* ===== Десктоп — текст 4px справа от иконки ===== */
    @media (min-width: 1024px) {
      a { flex-direction: row; gap: 4px; }
      a span { display: inline; }
      .wrap { padding-left: 120px; padding-right: 120px; }
      /* На десктопе черта под всеми 5 иконками, а не под тремя. */
      .nav-underline { width: 80%; max-width: none; }
    }
  `],
})
export class BottomNavComponent {
  private readonly auth = inject(AuthService);
  protected readonly isAuthed = this.auth.isAuthenticated;
}