import { Pipe, PipeTransform, SecurityContext, inject } from '@angular/core';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';

// Matches either `[text](url)` markdown OR `<a href="url" ...>text</a>` raw HTML anchor.
const LINK_RE = /\[([^\]]+)\]\(([^)\s]+)\)|<a\b[^>]*?\bhref\s*=\s*["']([^"']+)["'][^>]*?>([\s\S]*?)<\/a>/gi;
const ALLOWED_PROTO = /^(https?:|mailto:|tel:)/i;

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

@Pipe({ name: 'mdLink', standalone: true })
export class MarkdownLinkPipe implements PipeTransform {
  private readonly sanitizer = inject(DomSanitizer);

  transform(value: string | null | undefined): SafeHtml {
    if (!value) return '';
    let out = '';
    let lastIdx = 0;
    LINK_RE.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = LINK_RE.exec(value)) !== null) {
      out += escapeHtml(value.slice(lastIdx, m.index));
      const label = m[1] ?? m[4] ?? '';
      const rawUrl = m[2] ?? m[3] ?? '';
      if (ALLOWED_PROTO.test(rawUrl)) {
        const safeUrl = this.sanitizer.sanitize(SecurityContext.URL, rawUrl) ?? '';
        // strip any HTML from label (defensive)
        const safeLabel = escapeHtml(label.replace(/<[^>]*>/g, ''));
        out += `<a href="${escapeHtml(safeUrl)}" target="_blank" rel="noopener noreferrer">${safeLabel}</a>`;
      } else {
        out += escapeHtml(m[0]);
      }
      lastIdx = m.index + m[0].length;
    }
    out += escapeHtml(value.slice(lastIdx));
    return this.sanitizer.bypassSecurityTrustHtml(out);
  }
}
