// Хелперы «длительность в минутах ↔ человекочитаемое значение» для раздела
// «Ретеншен»: кондишены («прошло N с регистрации») и параметры действий
// (срок жизни промокода) хранятся в минутах, а админ вводит значение + единицу.

export type DurationUnit = 'minutes' | 'hours' | 'days';

export const DURATION_UNITS: { id: DurationUnit; label: string; factor: number }[] = [
  { id: 'minutes', label: 'минут', factor: 1 },
  { id: 'hours', label: 'часов', factor: 60 },
  { id: 'days', label: 'дней', factor: 60 * 24 },
];

/** значение + единица → минуты (некорректный ввод → 0). */
export function toMinutes(value: string | number, unit: DurationUnit): number {
  const n = typeof value === 'number' ? value : parseFloat(value);
  if (isNaN(n) || n < 0) return 0;
  const factor = DURATION_UNITS.find((u) => u.id === unit)?.factor ?? 1;
  return Math.round(n * factor);
}

/** минуты → {value, unit} с самой крупной единицей без потери точности. */
export function fromMinutes(minutes: number): { value: number; unit: DurationUnit } {
  if (minutes > 0 && minutes % (60 * 24) === 0) return { value: minutes / (60 * 24), unit: 'days' };
  if (minutes > 0 && minutes % 60 === 0) return { value: minutes / 60, unit: 'hours' };
  return { value: minutes, unit: 'minutes' };
}

/** минуты → «3 дн.» / «5 ч.» / «45 мин.» для таблиц и сводок. */
export function humanizeMinutes(minutes: number): string {
  if (!minutes) return '—';
  const { value, unit } = fromMinutes(minutes);
  const suffix = unit === 'days' ? 'дн.' : unit === 'hours' ? 'ч.' : 'мин.';
  return `${value} ${suffix}`;
}
