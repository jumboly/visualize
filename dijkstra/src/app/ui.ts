/** サイドパネル用の小さな UI 部品（章どうしで見た目と操作感をそろえるため） */

export interface Option<T> {
  value: T;
  label: string;
  title?: string;
}

/** セグメントボタン。選択状態は呼び出し側が持ち、set() で反映する */
export function segmented<T>(opts: Option<T>[], value: T, onChange: (v: T) => void): { el: HTMLElement; set(v: T): void } {
  const el = document.createElement('div');
  el.className = 'seg';
  const btns = opts.map((o) => {
    const b = document.createElement('button');
    b.textContent = o.label;
    if (o.title) b.title = o.title;
    b.addEventListener('click', () => {
      set(o.value);
      onChange(o.value);
    });
    el.appendChild(b);
    return b;
  });
  function set(v: T): void {
    btns.forEach((b, i) => b.classList.toggle('on', opts[i].value === v));
  }
  set(value);
  return { el, set };
}

/** ラベル付きの1行 */
export function row(label: string, ...children: Array<HTMLElement | string>): HTMLElement {
  const r = document.createElement('div');
  r.className = 'row';
  if (label) {
    const l = document.createElement('span');
    l.className = 'lbl';
    l.textContent = label;
    r.appendChild(l);
  }
  for (const c of children) r.append(c);
  return r;
}

export function button(label: string, onClick: () => void, title?: string): HTMLButtonElement {
  const b = document.createElement('button');
  b.className = 'btn';
  b.textContent = label;
  if (title) b.title = title;
  b.addEventListener('click', onClick);
  return b;
}

export function hint(html: string): HTMLElement {
  const p = document.createElement('div');
  p.className = 'hint';
  p.innerHTML = html;
  return p;
}

export interface Stat {
  k: string;
  v: string;
  wide?: boolean;
  title?: string;
}

/** 数値表示。毎フレーム呼ばれるので、変化がなければ DOM を触らない */
export function renderStats(host: HTMLElement, stats: Stat[]): void {
  const html = stats
    .map((s) => `<div class="stat${s.wide ? ' wide' : ''}"${s.title ? ` title="${s.title}"` : ''}><div class="k">${s.k}</div><div class="v">${s.v}</div></div>`)
    .join('');
  if (host.dataset.html !== html) {
    host.innerHTML = html;
    host.dataset.html = html;
  }
}

export interface LegendItem {
  /** 16x16 の SVG の中身 */
  swatch: string;
  label: string;
}

export function renderLegend(host: HTMLElement, items: LegendItem[]): void {
  host.innerHTML = items
    .map((i) => `<div class="li"><svg width="26" height="18" viewBox="0 0 26 18">${i.swatch}</svg><span>${i.label}</span></div>`)
    .join('');
}

/** 凡例でよく使う見本 */
export const SW = {
  unreached: '<circle cx="13" cy="9" r="6.5" fill="#0b0f17" stroke="#56627a" stroke-width="1.5" stroke-dasharray="2 2.2"/>',
  tentative: '<circle cx="13" cy="9" r="6.5" fill="#0f1a2c" stroke="#8fb8e8" stroke-width="2" stroke-dasharray="3.5 2"/>',
  settled: '<circle cx="13" cy="9" r="6.5" fill="#1f4f86" stroke="#4da3ff" stroke-width="2"/>',
  current: '<circle cx="13" cy="9" r="6.5" fill="#1f4f86" stroke="#ffffff" stroke-width="3"/>',
  road: '<line x1="2" y1="9" x2="24" y2="9" stroke="#34405a" stroke-width="3"/>',
  examined: '<line x1="2" y1="9" x2="24" y2="9" stroke="#7d8db0" stroke-width="2.5" stroke-dasharray="5 3"/>',
  wave: '<line x1="2" y1="9" x2="24" y2="9" stroke="#2f74c0" stroke-opacity=".75" stroke-width="8" stroke-linecap="round"/>',
  path: '<line x1="2" y1="9" x2="24" y2="9" stroke="#ffd166" stroke-width="5" stroke-linecap="round"/>',
  start: '<circle cx="13" cy="9" r="7" fill="none" stroke="#3ddc84" stroke-width="3"/>',
  goal: '<circle cx="13" cy="9" r="7" fill="none" stroke="#ffd166" stroke-width="3" stroke-dasharray="4 2"/>',
  river: '<rect x="2" y="3" width="22" height="12" rx="3" fill="#123a5c"/>',
};
