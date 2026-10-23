const nf = new Intl.NumberFormat('de-DE');
const nf1 = new Intl.NumberFormat('de-DE', { maximumFractionDigits: 1 });

export function num(n: number): string {
  return nf.format(n);
}

export function num1(n: number): string {
  return nf1.format(n);
}

/** 12.3k / 1,2 Mio. style compact numbers. */
export function compact(n: number): string {
  if (n >= 1e6) return `${nf1.format(n / 1e6)} Mio.`;
  if (n >= 1e4) return `${nf1.format(n / 1e3)} Tsd.`;
  return nf.format(n);
}

export function ms(n: number): string {
  if (n >= 1000) return `${nf1.format(n / 1000)} s`;
  return `${nf.format(Math.round(n))} ms`;
}

export function bytes(n: number): string {
  if (n >= 1e6) return `${nf1.format(n / 1e6)} MB`;
  if (n >= 1e3) return `${nf1.format(n / 1e3)} KB`;
  return `${nf.format(n)} B`;
}

export function css(rgb: number): string {
  return '#' + rgb.toString(16).padStart(6, '0');
}
