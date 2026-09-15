// Telegram разрешает в startapp только [A-Za-z0-9_-] и ≤64 символа, поэтому
// обычный querystring туда не помещается. Договорённость:
//   "-"  заменяет "=" (key/value);
//   "--" заменяет "&" (разделитель пар).
// Backend разбирает тот же формат (см. internal/utils/startparam.go) —
// если меняете здесь, синхронизируйте там.
//
// Примеры:
//   "ABC123"
//       → { ref: "ABC123" } — одиночный токен без дефиса трактуется как
//         голый реф-код, чтобы старые ссылки t.me/<bot>?startapp=<code>
//         продолжали работать.
//   "ref-ABC--utm_source-telegram--utm_campaign-spring"
//       → { ref: "ABC", utm_source: "telegram", utm_campaign: "spring" }
export function parseStartParam(raw: string | null | undefined): Record<string, string> {
  if (!raw) return {};
  const s = raw.trim();
  if (!s) return {};
  if (!s.includes('-')) return { ref: s };
  const out: Record<string, string> = {};
  for (const pair of s.split('--')) {
    if (!pair) continue;
    const idx = pair.indexOf('-');
    if (idx <= 0) continue;
    const k = pair.slice(0, idx);
    const v = pair.slice(idx + 1);
    if (v) out[k] = v;
  }
  return out;
}
