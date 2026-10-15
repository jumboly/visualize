export const SVGNS = 'http://www.w3.org/2000/svg';

type Attrs = Record<string, string | number | undefined>;

/** SVG 要素を作って属性を設定し、親があれば追加する */
export function el<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Attrs = {}, parent?: Element): SVGElementTagNameMap[K] {
  const e = document.createElementNS(SVGNS, tag);
  for (const [k, v] of Object.entries(attrs)) if (v !== undefined) e.setAttribute(k, String(v));
  parent?.appendChild(e);
  return e;
}

export function setAttrs(e: Element, attrs: Attrs): void {
  for (const [k, v] of Object.entries(attrs)) if (v !== undefined) e.setAttribute(k, String(v));
}

/** 数値の表示。整数ならそのまま、そうでなければ小数1桁 */
export function fmt(v: number, digits = 1): string {
  if (!Number.isFinite(v)) return '∞';
  return Number.isInteger(v) ? String(v) : v.toFixed(digits);
}

export function clamp(v: number, a = 0, b = 1): number {
  return Math.max(a, Math.min(b, v));
}
