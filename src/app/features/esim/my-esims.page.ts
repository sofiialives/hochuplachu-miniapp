import { Component, ViewChild } from '@angular/core';
import { BackBarComponent } from '../../ui/back-bar.component';
import { PullToRefreshComponent } from '../../ui/pull-to-refresh.component';
import { MyEsimsComponent } from './my-esims.component';

// MyEsimsPage — «/esim/my»: полный список купленных eSIM. На «/esim» тот же
// компонент стоит под лимитом (последние две + ссылка сюда) — как «Последние
// операции» и «/history» на странице карт.
@Component({
  selector: 'app-my-esims-page',
  standalone: true,
  imports: [BackBarComponent, PullToRefreshComponent, MyEsimsComponent],
  template: `<app-pull-to-refresh #ptr (refresh)="onPullRefresh(ptr)">
    <app-back-bar />
    <section class="wrap">
      <h1>Мои eSIM</h1>
      <app-my-esims #list [showEmpty]="true" />
    </section>
  </app-pull-to-refresh>`,
  styles: [`
    .wrap {
      padding: var(--space-md) var(--space-md) var(--space-xl);
      max-width: 640px; margin: 0 auto;
      display: flex; flex-direction: column; gap: var(--space-md);
    }
    h1 { margin: 0; padding: 0; }
  `],
})
export class MyEsimsPage {
  @ViewChild('list') private readonly list?: MyEsimsComponent;

  protected onPullRefresh(ptr: PullToRefreshComponent): void {
    this.list?.reload();
    ptr.finishRefresh();
  }
}
