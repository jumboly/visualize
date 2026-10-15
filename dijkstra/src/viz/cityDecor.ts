import { RAIL_Y, RIVER_HALF, riverX, WORLD, type RoadNetwork } from '../graph/roadNetwork';
import type { Network } from '../graph/types';
import { el } from './svg';

/** 第3章以降の街の視点範囲 */
export const CITY_VIEWBOX = { x: -30, y: -30, w: WORLD.w + 60, h: WORLD.h + 60 };

/** 川・線路・公園などの背景と、主要な場所の名前を描く */
export function drawCity(under: SVGGElement, labels: SVGGElement, net: RoadNetwork): void {
  // 川
  const ys: number[] = [];
  for (let y = -40; y <= WORLD.h + 40; y += 20) ys.push(y);
  const left = ys.map((y) => `${riverX(y) - RIVER_HALF},${y}`);
  const right = [...ys].reverse().map((y) => `${riverX(y) + RIVER_HALF},${y}`);
  el('polygon', { points: [...left, ...right].join(' '), class: 'river' }, under);
  // 公園
  const p = net.park;
  el('rect', { x: p.x, y: p.y, width: p.w, height: p.h, rx: 30, class: 'park' }, under);
  // 線路（枕木の模様で表す）
  el('line', { x1: -30, y1: RAIL_Y, x2: WORLD.w + 30, y2: RAIL_Y, class: 'rail-base' }, under);
  el('line', { x1: -30, y1: RAIL_Y, x2: WORLD.w + 30, y2: RAIL_Y, class: 'rail-ties' }, under);

  const text = (x: number, y: number, s: string, cls = '') => {
    el('text', { x, y, class: `city-label ${cls}`, 'text-anchor': 'middle' }, labels).textContent = s;
  };
  text(riverX(1300) , 1330, '川', 'river-name');
  text(60, RAIL_Y - 14, '線路', 'rail-name');
  text(p.x + p.w / 2, p.y + p.h / 2 + 10, '公園', 'park-name');
  const mid = (id: number) => {
    const r = net.roads[id];
    return { x: (net.nodes[r.a].x + net.nodes[r.b].x) / 2, y: (net.nodes[r.a].y + net.nodes[r.b].y) / 2 };
  };
  const nb = mid(net.named.northBridge);
  text(nb.x, nb.y - 26, '北大橋');
  const ob = mid(net.named.oldBridge);
  text(ob.x, ob.y - 26, '旧橋（幅4m・東向き一方通行）');
  const fb = mid(net.named.footBridge);
  text(fb.x, fb.y - 22, '歩道橋（歩行者専用）');
  const eb = mid(net.named.expressBridge);
  text(eb.x, eb.y + 50, '高速道路（自動車専用）', 'express-name');
}

/** 一方通行の道路に矢印を描く（車両の進行方向） */
export function drawOneways(layer: SVGGElement, net: Network): void {
  for (const r of net.roads) {
    if (!r.oneway) continue;
    const a = net.nodes[r.a];
    const b = net.nodes[r.b];
    const mx = (a.x + b.x) / 2;
    const my = (a.y + b.y) / 2;
    const ang = (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI;
    el('path', { d: 'M-13,-9 L9,0 L-13,9 Z', class: 'oneway-arrow', transform: `translate(${mx},${my}) rotate(${ang})` }, layer);
  }
}
