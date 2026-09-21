export function makeCardBg(imageUrl: string | undefined | null, gradient: string | undefined | null): string | null {
  const img = (imageUrl || '').trim();
  const grad = (gradient || '').trim();
  const gradCss = grad ? (isPreset(grad) ? presetCss(grad) : grad) : '';

  if (img) {
    const safeImg = img.replace(/['"\n\r]/g, '');

    return `url('${safeImg}') center / contain no-repeat${gradCss ? `, ${gradCss}` : ''}`;
  }
  return gradCss || null;
}

function isPreset(s: string): boolean {
  return s === 'blue' || s === 'dark' || s === 'gold';
}

function presetCss(s: string): string {
  switch (s) {
    case 'dark': return 'linear-gradient(135deg, var(--card-dark-from) 0%, var(--card-dark-to) 100%)';
    case 'gold': return 'linear-gradient(135deg, var(--card-gold-from) 0%, var(--card-gold-to) 100%)';
    case 'blue':
    default:
      return 'linear-gradient(135deg, var(--card-blue-from) 0%, var(--card-blue-mid) 60%, var(--card-blue-to) 100%)';
  }
}