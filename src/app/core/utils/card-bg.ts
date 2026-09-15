export function makeCardBg(imageUrl: string | undefined | null, gradient: string | undefined | null): string | null {
  const img = (imageUrl || '').trim();
  if (img) {
    const safeImg = img.replace(/['"\n\r]/g, '');
    return `url('${safeImg}') center / cover no-repeat`;
  }
  const grad = (gradient || '').trim();
  if (!grad) return null;
  return isPreset(grad) ? presetCss(grad) : grad;
}

function isPreset(s: string): boolean {
  return s === 'blue' || s === 'dark' || s === 'gold';
}

function presetCss(s: string): string {
  switch (s) {
    case 'dark': return 'linear-gradient(135deg, #181715 0%, #2d2a25 100%)';
    case 'gold': return 'linear-gradient(135deg, #d4a017 0%, #8c6a0b 100%)';
    case 'blue':
    default:
      return 'linear-gradient(135deg, #2563eb 0%, #1e40af 60%, #0c1e5d 100%)';
  }
}