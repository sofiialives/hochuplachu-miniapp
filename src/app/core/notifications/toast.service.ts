import { Injectable, signal } from '@angular/core';

export type ToastKind = 'success' | 'error' | 'info';

export interface Toast {
  id: number;
  kind: ToastKind;
  text: string;
}

@Injectable({ providedIn: 'root' })
export class ToastService {
  readonly toasts = signal<Toast[]>([]);
  private nextId = 0;

  push(text: string, kind: ToastKind = 'info', ttl = 3500): void {
    const id = this.nextId++;
    this.toasts.update((arr) => [...arr, { id, kind, text }]);
    setTimeout(() => this.toasts.update((arr) => arr.filter((t) => t.id !== id)), ttl);
  }

  success(text: string): void { this.push(text, 'success'); }
  error(text: string): void { this.push(text, 'error'); }
  info(text: string): void { this.push(text, 'info'); }
}
