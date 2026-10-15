import { describe, expect, it } from 'vitest';
import { dijkstra } from '../src/algo/dijkstra';
import { buildTimeline, frameAt, SearchReplay } from '../src/viz/replay';
import { randomGraph } from './helpers';

describe('探索イベントの再生', () => {
  const g = randomGraph(7, 30, 90);
  const res = dijkstra(g, { sources: 0, record: true });

  it('全イベントを適用すると、探索結果と同じ状態になる', () => {
    const rp = new SearchReplay(g.n, g.edges.length, res.events);
    const st = rp.at(res.events.length);
    expect(Array.from(st.dist)).toEqual(Array.from(res.dist));
    expect(Array.from(st.settled)).toEqual(Array.from(res.settled));
    expect(st.order).toEqual(res.order);
    expect(st.examinedCount).toBe(res.edgesScanned);
  });

  it('巻き戻してから進めても、同じ位置なら同じ状態になる', () => {
    const rp = new SearchReplay(g.n, g.edges.length, res.events);
    const k = Math.floor(res.events.length / 2);
    const a = Array.from(rp.at(k).dist);
    rp.at(res.events.length);
    rp.at(3);
    expect(Array.from(rp.at(k).dist)).toEqual(a);
  });

  it('wave モードでは、ノードは波紋の半径がそのコストに達した時刻に確定する', () => {
    const tl = buildTimeline(res.events, 'wave');
    const rp = new SearchReplay(g.n, g.edges.length, res.events);
    for (const v of res.order) {
      const c = res.dist[v];
      expect(rp.at(frameAt(tl, res.events, c).k).settled[v]).toBe(1);
      if (c > 0) {
        const before = frameAt(tl, res.events, c - 1e-6);
        expect(rp.at(before.k).settled[v]).toBe(0);
        expect(before.radius).toBeLessThan(c);
      }
    }
  });

  it('step モードの停止位置は単調増加で、最後は終端', () => {
    const tl = buildTimeline(res.events, 'step');
    for (let i = 1; i < tl.stops.length; i++) expect(tl.stops[i]).toBeGreaterThan(tl.stops[i - 1]);
    expect(tl.stops[tl.stops.length - 1]).toBe(tl.duration);
    expect(frameAt(tl, res.events, tl.duration).k).toBe(res.events.length);
  });
});
