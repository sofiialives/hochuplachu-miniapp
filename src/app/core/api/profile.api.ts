import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { ApiService } from './api.service';
import { User } from '../auth/auth.service';

@Injectable({ providedIn: 'root' })
export class ProfileApi {
  private readonly api = inject(ApiService);
  update(body: Partial<{ email_notifications_enabled: boolean }>): Observable<{ user: User }> {
    return this.api.patch('/profile', body);
  }
}
