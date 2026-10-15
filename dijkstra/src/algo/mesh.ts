/**
 * 道路区間 → メッシュ（正方形の格子）への変換。
 *
 * 到達できる道路区間と交差するセルを塗る。セルの値は、そのセルの中で最も早く到達できるコスト
 * （区間がセルに入る点のコスト）。道路に沿ってコストは増えていくので、入口の点が最小になる。
 *
 * これは「道路が通っているセル」を塗る近似であり、道路のない場所（川・公園の中など）や
 * セルの大きさによって結果が変わる。
 */

export interface CostSegment {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  /** 始点・終点のコスト（線形に変化する） */
  c0: number;
  c1: number;
}

export interface Mesh {
  size: number;
  /** セル (0,0) の左上の座標 */
  ox: number;
  oy: number;
  /** "ix,iy" → そのセルの最小コスト */
  cells: Map<string, number>;
}

export const cellKey = (ix: number, iy: number) => `${ix},${iy}`;

export function buildMesh(segs: CostSegment[], size: number, ox = 0, oy = 0): Mesh {
  const cells = new Map<string, number>();
  for (const s of segs) {
    visitCells(s.x0 - ox, s.y0 - oy, s.x1 - ox, s.y1 - oy, size, (ix, iy, t) => {
      const c = s.c0 + (s.c1 - s.c0) * t;
      const k = cellKey(ix, iy);
      const old = cells.get(k);
      if (old === undefined || c < old) cells.set(k, c);
    });
  }
  return { size, ox, oy, cells };
}

/**
 * 線分が通るセルを順に訪問する（Amanatides & Woo のボクセル走査）。
 * t は線分上でそのセルに入るときのパラメータ（0..1）。
 * 線分がセルの境界線上をちょうど通る場合は、片側のセルだけを数える。
 */
export function visitCells(x0: number, y0: number, x1: number, y1: number, size: number, visit: (ix: number, iy: number, t: number) => void): void {
  let ix = Math.floor(x0 / size);
  let iy = Math.floor(y0 / size);
  const ex = Math.floor(x1 / size);
  const ey = Math.floor(y1 / size);
  const dx = x1 - x0;
  const dy = y1 - y0;
  const stepX = dx > 0 ? 1 : dx < 0 ? -1 : 0;
  const stepY = dy > 0 ? 1 : dy < 0 ? -1 : 0;
  // 次の縦／横の境界に達するまでの t と、セル1つ分進む t
  const tDeltaX = stepX !== 0 ? size / Math.abs(dx) : Infinity;
  const tDeltaY = stepY !== 0 ? size / Math.abs(dy) : Infinity;
  let tMaxX = stepX > 0 ? ((ix + 1) * size - x0) / dx : stepX < 0 ? (ix * size - x0) / dx : Infinity;
  let tMaxY = stepY > 0 ? ((iy + 1) * size - y0) / dy : stepY < 0 ? (iy * size - y0) / dy : Infinity;
  let t = 0;
  visit(ix, iy, 0);
  // 最大でも横断するセル数 + 余裕で打ち切る（浮動小数の誤差で無限ループしないように）
  const maxSteps = Math.abs(ex - ix) + Math.abs(ey - iy) + 2;
  for (let n = 0; n < maxSteps && (ix !== ex || iy !== ey); n++) {
    if (tMaxX < tMaxY) {
      t = tMaxX;
      ix += stepX;
      tMaxX += tDeltaX;
    } else {
      t = tMaxY;
      iy += stepY;
      tMaxY += tDeltaY;
    }
    if (t > 1) break;
    visit(ix, iy, t);
  }
}

/** セルの集合の輪郭（隣にセルがない辺）を線分の列で返す。メッシュを統合したポリゴンの表示用 */
export function meshOutline(mesh: Mesh): Array<[number, number, number, number]> {
  const s = mesh.size;
  const has = (ix: number, iy: number) => mesh.cells.has(cellKey(ix, iy));
  const out: Array<[number, number, number, number]> = [];
  for (const k of mesh.cells.keys()) {
    const [ix, iy] = k.split(',').map(Number);
    const x = mesh.ox + ix * s;
    const y = mesh.oy + iy * s;
    if (!has(ix, iy - 1)) out.push([x, y, x + s, y]);
    if (!has(ix, iy + 1)) out.push([x, y + s, x + s, y + s]);
    if (!has(ix - 1, iy)) out.push([x, y, x, y + s]);
    if (!has(ix + 1, iy)) out.push([x + s, y, x + s, y + s]);
  }
  return out;
}
