import type { Network, NetNode, Road, RoadClass, Mode } from './types';

/**
 * 第3章以降で使う架空の街（2.4km × 1.5km）。固定シードで毎回同じものを作る。
 *
 * - 南北に川。橋は 北大橋（幹線）・旧橋（幅4m・東向き一方通行）・歩道橋（歩行者専用）の3本と、高速道路の高架。
 * - 東西に線路（y=800）。道路が渡れるのは4か所の踏切だけ。
 * - 北西：碁盤目＋一方通行 / 南西：狭い路地の旧市街 / 北東：公園の遊歩道 / 南東：行き止まりの多い住宅地
 *
 * 川と線路で4つの地区に分かれる構造は、第5章の階層探索の「領域」にもそのまま使う。
 */

export const WORLD = { w: 2400, h: 1500 };
const COLS = 24;
const ROWS = 15;
const SP = 100;
const RIVER_COL = 12;
export const RAIL_Y = 800;
export const EXPRESS_Y = 1000;
/** 線路を渡れる列（踏切） */
const CROSSINGS = new Set([5, 9, 18, 21]);
/** 公園（この範囲の内側の道は遊歩道） */
const PARK = { i0: 14, i1: 16, j0: 3, j1: 5 };

export function riverX(y: number): number {
  return 1250 + 42 * Math.sin(y / 300 + 0.6);
}
export const RIVER_HALF = 38;

export interface RoadNetwork extends Network {
  /** 説明や初期配置に使う名前付きの地点 */
  poi: Record<string, number>;
  /** 名前付きの道路 */
  named: Record<string, number>;
  park: { x: number; y: number; w: number; h: number };
}

/** 再現可能な乱数（mulberry32） */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const gx = (i: number) => 50 + SP * i;
const gy = (j: number) => 50 + SP * j;

export function roadNetwork(): RoadNetwork {
  const rand = rng(20251016);
  const nodes: NetNode[] = [];
  const grid = new Map<string, number>();
  const key = (i: number, j: number) => `${i},${j}`;
  const west = (i: number) => i < RIVER_COL;
  const north = (j: number) => j <= 7;

  // ---- ノード（碁盤目を基本に、北西以外は少しゆがめて不規則な街並みにする） ----
  for (let j = 0; j < ROWS; j++) {
    for (let i = 0; i < COLS; i++) {
      if (i === RIVER_COL) continue;
      const onArterial = j === 2 || i === 5 || i === 18;
      const nearBridge = (i === 11 || i === 13) && (j === 2 || j === 6 || j === 11);
      const nearRail = j === 7 || j === 8;
      const regular = (west(i) && north(j)) || onArterial || nearBridge;
      const jx = regular ? 0 : (rand() - 0.5) * 34;
      const jy = regular || nearRail ? 0 : (rand() - 0.5) * 34;
      grid.set(key(i, j), nodes.length);
      nodes.push({ id: nodes.length, x: Math.round(gx(i) + jx), y: Math.round(gy(j) + jy) });
    }
  }

  const roads: Road[] = [];
  const named: Record<string, number> = {};
  const len = (a: number, b: number) => Math.round(Math.hypot(nodes[a].x - nodes[b].x, nodes[a].y - nodes[b].y));
  const ALL: Mode[] = ['walk', 'car'];
  function add(a: number, b: number, cls: RoadClass, width: number, opts: Partial<Road> = {}): number {
    const modes: Mode[] = cls === 'path' ? ['walk'] : cls === 'expressway' || cls === 'ramp' ? ['car'] : ALL;
    roads.push({ id: roads.length, a, b, length: len(a, b), cls, width, oneway: false, modes, ...opts });
    return roads.length - 1;
  }
  const isFrontage = (j: number) => j === 9 || j === 10;
  const inPark = (i: number, j: number) => i >= PARK.i0 && i <= PARK.i1 && j >= PARK.j0 && j <= PARK.j1;

  /** 2つの格子点を結ぶ道路の種類と幅 */
  function classify(i1: number, j1: number, i2: number, j2: number): { cls: RoadClass; width: number } {
    if ((j1 === 2 && j2 === 2) || (i1 === i2 && (i1 === 5 || i1 === 18))) return { cls: 'arterial', width: 14 };
    if (inPark(i1, j1) && inPark(i2, j2)) return { cls: 'path', width: 3 };
    // 高速道路沿いの側道。IC のランプがつながるので、大型車も通れる幅にする
    if (j1 === j2 && isFrontage(j1)) return { cls: 'local', width: 7 };
    if (west(i1) && !north(Math.max(j1, j2))) {
      // 南西の旧市街：狭い路地。ところどころ歩行者専用の参道
      if (rand() < 0.12) return { cls: 'path', width: 2.5 };
      return { cls: 'narrow', width: rand() < 0.5 ? 3.5 : 4 };
    }
    if (!west(i1) && rand() < 0.15) return { cls: 'narrow', width: 4.5 };
    return { cls: 'local', width: rand() < 0.5 ? 6 : 7 };
  }

  // ---- 格子の道路 ----
  for (let j = 0; j < ROWS; j++) {
    for (let i = 0; i < COLS; i++) {
      const a = grid.get(key(i, j));
      if (a === undefined) continue;
      const right = grid.get(key(i + 1, j));
      if (right !== undefined) {
        const c = classify(i, j, i + 1, j);
        // 北西の4条通りは東向きの一方通行
        const oneway = west(i) && j === 4 && c.cls === 'local';
        add(a, right, c.cls, c.width, { oneway });
      }
      const down = grid.get(key(i, j + 1));
      // 線路をまたぐ縦の道は踏切だけ
      if (down !== undefined && (j !== 7 || CROSSINGS.has(i))) {
        const c = classify(i, j, i, j + 1);
        // 北西の8番通りは北向きの一方通行（a を南側にして a→b を北向きにする）
        if (i === 8 && north(j + 1) && c.cls === 'local') add(down, a, c.cls, c.width, { oneway: true });
        else add(a, down, c.cls, c.width);
      }
    }
  }

  // ---- 橋 ----
  const g = (i: number, j: number) => grid.get(key(i, j))!;
  named.northBridge = add(g(11, 2), g(13, 2), 'arterial', 14, { bridge: true, name: '北大橋' });
  named.oldBridge = add(g(11, 6), g(13, 6), 'narrow', 4, { bridge: true, oneway: true, name: '旧橋' });
  named.footBridge = add(g(11, 11), g(13, 11), 'path', 3, { bridge: true, name: '歩道橋' });

  // ---- 高速道路（高架。IC 以外では下の道路とつながらない） ----
  const icXs = [400, 1000, 1600, 2200];
  const ics = icXs.map((x) => {
    nodes.push({ id: nodes.length, x, y: EXPRESS_Y });
    return nodes.length - 1;
  });
  for (let k = 0; k + 1 < ics.length; k++) {
    const r = add(ics[k], ics[k + 1], 'expressway', 20, { bridge: k === 1, name: k === 1 ? '高速道路の高架橋' : undefined });
    if (k === 1) named.expressBridge = r;
  }
  for (const ic of ics) {
    // IC は格子の列の中間にあるので、北西側と南東側の交差点へ斜めのランプでつなぐ
    const i = Math.round((nodes[ic].x - 50) / SP);
    add(ic, g(i - 1, 9), 'ramp', 8);
    add(ic, g(i, 10), 'ramp', 8);
  }

  // ---- 南東の住宅地：道をいくつか間引いて行き止まりを作る（全体の連結は保つ） ----
  const removable = roads.filter((r) => {
    const a = nodes[r.a];
    const b = nodes[r.b];
    const frontage = a.y === b.y && Math.abs(a.y - EXPRESS_Y) < 60;
    return r.cls === 'local' || r.cls === 'narrow' ? !frontage && a.x > 1400 && b.x > 1400 && a.y > 870 && b.y > 870 : false;
  });
  const dropped = new Set<number>();
  for (const r of removable) {
    if (rand() < 0.3) {
      dropped.add(r.id);
      if (!connected(nodes.length, roads, dropped)) dropped.delete(r.id);
    }
  }
  // 行き止まりの袋小路を少し足す
  const spurs: Array<[number, number, number, number]> = [
    [15, 13, 40, 55],
    [20, 12, -45, 50],
    [2, 13, 45, 45],
    [22, 9, 50, 40],
  ];
  const kept = roads.filter((r) => !dropped.has(r.id));
  for (const [i, j, dx, dy] of spurs) {
    const a = g(i, j);
    nodes.push({ id: nodes.length, x: nodes[a].x + dx, y: nodes[a].y + dy });
    const b = nodes.length - 1;
    kept.push({ id: -1, a, b, length: len(a, b), cls: 'narrow', width: 4, oneway: false, modes: ALL });
  }
  // id を詰め直す（id は配列の添字と一致させる）
  const remap = new Map<number, number>();
  const finalRoads = kept.map((r, k) => {
    if (r.id >= 0) remap.set(r.id, k);
    return { ...r, id: k };
  });
  for (const k of Object.keys(named)) named[k] = remap.get(named[k])!;

  const poi: Record<string, number> = {
    // 第3章：川の西と東
    west: g(3, 6),
    east: g(19, 6),
    // 第4章：店舗（川の近く。歩道橋・旧橋の影響が見える位置）
    store: g(10, 9),
    // 第6章：配送センター
    depot: g(6, 9),
  };

  return {
    nodes,
    roads: finalRoads,
    poi,
    named,
    park: { x: gx(PARK.i0) - 20, y: gy(PARK.j0) - 20, w: SP * (PARK.i1 - PARK.i0) + 40, h: SP * (PARK.j1 - PARK.j0) + 40 },
  };
}

/** 方向を無視して全ノードが1つにつながっているか */
function connected(n: number, roads: Road[], dropped: Set<number>): boolean {
  const adj: number[][] = Array.from({ length: n }, () => []);
  for (const r of roads) {
    if (dropped.has(r.id)) continue;
    adj[r.a].push(r.b);
    adj[r.b].push(r.a);
  }
  const seen = new Uint8Array(n);
  const stack = [0];
  seen[0] = 1;
  let count = 1;
  while (stack.length) {
    const v = stack.pop()!;
    for (const w of adj[v]) {
      if (!seen[w]) {
        seen[w] = 1;
        count++;
        stack.push(w);
      }
    }
  }
  return count === n;
}

/** 座標に最も近いノード */
export function nearestNode(net: RoadNetwork, x: number, y: number): number {
  let best = -1;
  let bd = Infinity;
  for (const v of net.nodes) {
    const d = Math.hypot(v.x - x, v.y - y);
    if (d < bd) {
      bd = d;
      best = v.id;
    }
  }
  return best;
}
