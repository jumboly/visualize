/*
 * データ生成とインデックス構造（B-tree の葉順序モデル / STR バルクロードの R-tree）。
 * 描画コードから切り離しているのは、探索結果を「事実」として先に確定させ、
 * UI 側はその記録を再生するだけにするため（前後移動しても結果がぶれない）。
 * Node からも require できるようにして、数値をコマンドラインで検証できるようにしている。
 */
(function (global) {
  'use strict';

  // 固定シードの PRNG。Math.random だと発表のたびに件数が変わってしまうため。
  function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  const SEED = 20251015;
  const N = 2000;
  // 一様分布を主体にしつつ、少しだけクラスタを混ぜる。
  // 完全一様だと R-tree の「まとまり」が見えにくく、強すぎると比較が恣意的に見えるため控えめにしている。
  const CLUSTERS = [
    { x: 20, y: 76, s: 6, n: 130 },
    { x: 79, y: 24, s: 7, n: 130 },
    { x: 52, y: 86, s: 5, n: 90 },
    { x: 74, y: 70, s: 5, n: 80 },
    { x: 26, y: 24, s: 6, n: 70 },
  ];
  const QUERY = { minX: 40, minY: 40, maxX: 60, maxY: 60 };

  function generatePoints() {
    const rnd = mulberry32(SEED);
    const gauss = () => {
      // Box-Muller。外部ライブラリに依存しないため自前で実装。
      const u = 1 - rnd();
      const v = rnd();
      return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
    };
    // 小数1桁に丸める：DB の値らしさを出しつつ、x が同じ行（タイ）も自然に発生させて辞書順の第2キーを見せるため。
    const r1 = (v) => Math.round(Math.min(100, Math.max(0, v)) * 10) / 10;
    const raw = [];
    let clustered = 0;
    for (const c of CLUSTERS) {
      for (let i = 0; i < c.n; i++) raw.push([r1(c.x + gauss() * c.s), r1(c.y + gauss() * c.s)]);
      clustered += c.n;
    }
    for (let i = clustered; i < N; i++) raw.push([r1(rnd() * 100), r1(rnd() * 100)]);
    // 挿入順をシャッフルし、出現アニメーションでクラスタが固まって出ないようにする。
    for (let i = raw.length - 1; i > 0; i--) {
      const j = Math.floor(rnd() * (i + 1));
      [raw[i], raw[j]] = [raw[j], raw[i]];
    }
    return raw.map(([x, y], i) => ({ id: i + 1, x, y }));
  }

  const inRect = (p, q) => p.x >= q.minX && p.x <= q.maxX && p.y >= q.minY && p.y <= q.maxY;

  // ---------------- B-tree (x, y) ----------------
  // ページ分割は可視化の論点ではないので、葉レベルの論理順序＝(x, y, id) の辞書順ソート配列で表す。
  function buildBTree(points) {
    const order = points.map((_, i) => i);
    order.sort((a, b) => {
      const p = points[a], q = points[b];
      return p.x - q.x || p.y - q.y || p.id - q.id;
    });
    const rank = new Array(points.length);
    order.forEach((pi, r) => (rank[pi] = r));
    return { order, rank };
  }

  // 先頭キー x の範囲で二分探索し、その連続区間を走査しながら y を評価する。
  // 典型的な複合インデックスの範囲スキャン（Skip Scan 等の最適化なし）を表すモデル。
  function btreeSearch(points, bt, q) {
    const { order } = bt;
    const lowerBound = (pred) => {
      let lo = 0, hi = order.length;
      while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (pred(points[order[mid]])) hi = mid; else lo = mid + 1;
      }
      return lo;
    };
    const lo = lowerBound((p) => p.x >= q.minX);
    const hi = lowerBound((p) => p.x > q.maxX);
    const scanned = order.slice(lo, hi);
    const results = scanned.filter((pi) => {
      const y = points[pi].y;
      return y >= q.minY && y <= q.maxY;
    });
    return { lo, hi, scanned, results };
  }

  // ---------------- R-tree (STR bulk load) ----------------
  const unionMbr = (boxes) => ({
    minX: Math.min(...boxes.map((b) => b.minX)),
    minY: Math.min(...boxes.map((b) => b.minY)),
    maxX: Math.max(...boxes.map((b) => b.maxX)),
    maxY: Math.max(...boxes.map((b) => b.maxY)),
  });
  const intersects = (a, b) => a.minX <= b.maxX && a.maxX >= b.minX && a.minY <= b.maxY && a.maxY >= b.minY;

  // STR: x でスライスに切り、各スライス内を y で並べて M 個ずつ詰める。
  function strGroups(entries, M) {
    const P = Math.ceil(entries.length / M);
    const S = Math.ceil(Math.sqrt(P));
    const byX = entries.slice().sort((a, b) => a.cx - b.cx || a.cy - b.cy);
    const sliceSize = S * M;
    const groups = [];
    for (let i = 0; i < byX.length; i += sliceSize) {
      const slice = byX.slice(i, i + sliceSize).sort((a, b) => a.cy - b.cy || a.cx - b.cx);
      for (let j = 0; j < slice.length; j += M) groups.push(slice.slice(j, j + M));
    }
    return groups;
  }

  function buildRTree(points, M) {
    let nextId = 0;
    const ptEntries = points.map((p, i) => ({ cx: p.x, cy: p.y, ref: i }));
    let level = strGroups(ptEntries, M).map((g) => {
      const pts = g.map((e) => e.ref);
      return {
        id: nextId++, leaf: true, children: [], points: pts, allPoints: pts,
        mbr: unionMbr(pts.map((i) => ({ minX: points[i].x, minY: points[i].y, maxX: points[i].x, maxY: points[i].y }))),
      };
    });
    while (level.length > 1) {
      const entries = level.map((n) => ({ cx: (n.mbr.minX + n.mbr.maxX) / 2, cy: (n.mbr.minY + n.mbr.maxY) / 2, ref: n }));
      level = strGroups(entries, M).map((g) => {
        const children = g.map((e) => e.ref);
        return {
          id: nextId++, leaf: false, children, points: [],
          allPoints: children.flatMap((c) => c.allPoints),
          mbr: unionMbr(children.map((c) => c.mbr)),
        };
      });
    }
    const root = level[0];
    const byDepth = [];
    (function setDepth(n, d, parent) {
      n.depth = d;
      n.parent = parent;
      (byDepth[d] = byDepth[d] || []).push(n);
      n.children.forEach((c) => setDepth(c, d + 1, n));
    })(root, 0, null);
    return { root, byDepth, height: byDepth.length - 1, M };
  }

  // 実際に木をたどり、各ノードの交差判定結果をイベント列として記録する。UI はこの記録だけを再生する。
  function rtreeSearch(points, rt, q) {
    const events = [];
    const examined = [];
    const results = [];
    (function visit(node) {
      const hit = intersects(node.mbr, q);
      events.push({ node, depth: node.depth, hit });
      if (!hit) return;
      if (node.leaf) {
        for (const pi of node.points) {
          examined.push(pi);
          if (inRect(points[pi], q)) results.push(pi);
        }
      } else node.children.forEach(visit);
    })(rt.root);
    return { events, examined, results };
  }

  function build(M = 9) {
    const points = generatePoints();
    const bt = buildBTree(points);
    const bres = btreeSearch(points, bt, QUERY);
    const rt = buildRTree(points, M);
    const rres = rtreeSearch(points, rt, QUERY);
    const truth = points.map((p, i) => i).filter((i) => inRect(points[i], QUERY));
    const same = (a, b) => a.length === b.length && [...a].sort((x, y) => x - y).every((v, i) => v === [...b].sort((x, y) => x - y)[i]);
    return {
      points, query: QUERY, bt, bres, rt, rres, truth,
      resultsMatch: same(bres.results, rres.results) && same(bres.results, truth),
    };
  }

  const api = { build, mulberry32, intersects, inRect, QUERY, N };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else global.SpatialModel = api;
})(typeof window !== 'undefined' ? window : globalThis);
