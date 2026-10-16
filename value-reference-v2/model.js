/*
 * 値型・参照型 × 値渡し・参照渡し の状態モデル。
 *
 * C# の動きを「変数・値・参照・オブジェクト・ref(別名)」だけの小さな意味論で実行し、
 * ステップごとに (1) 実行後の完全なスナップショット と (2) そこへ入るときのイベント列 を作る。
 * 描画側はスナップショットを描くだけ・イベントを飾りとして再生するだけにしているので、
 * どのステップへ飛んでも、アニメーションの途中で操作しても、表示は必ずスナップショットどおりになる。
 * 画面に出る a.Value などの結果はここで実際に計算した値で、固定値を書いていない。
 * Node からも require できるようにして、結果をコマンドラインで検証できるようにしている。
 */
(function (root) {
  'use strict';

  // ===== 配置（ステージ座標 1920x1080）=====
  // 「呼び出し元・オブジェクト・関数」の列の x を全シーン共通にして、観客が毎回図を読み直さなくて済むようにする。
  const X = { caller: 950, obj: 1320, callee: 1700 };
  const Y = { top: 330, bottom: 660, bottom2: 812, single: 500, single2: 720 };
  const LANE_TOP = { y: 168, h: 340 };
  const LANE_BOTTOM = { y: 520, h: 360 };
  // コードの行の高さは描画側でも同じ値を使う必要があるので、ここで計算してブロックに持たせる。
  const CODE = { x: 40, w: 660, top: 112, fs: 28, gap: 18, head: 42, pad: 16, foot: 46 };
  const lineHeight = fs => Math.round(fs * 1.4);

  // 4 分割（シーン7）。象限内の相対座標で、どの象限でも同じ位置関係にする。
  const QS = 0.8;
  const QUAD = { w: 910, h: 370 };
  const QPOS = { a: [160, 200], o1: [455, 200], o2: [455, 312], c: [740, 200] };

  function clone(o) { return o === undefined ? undefined : JSON.parse(JSON.stringify(o)); }

  // ===== 値 =====
  // 変数の箱に入るもの。参照型の変数に入るのはオブジェクトそのものではなく ref（識別子）だけ。
  const V = {
    int: n => ({ k: 'val', v: n }),
    struct: (type, fields) => ({ k: 'struct', type, fields: Object.assign({}, fields) }),
    ref: (obj, id) => ({ k: 'ref', obj, id }),
    empty: () => ({ k: 'empty' }),
  };

  function World() {
    this.vars = {};    // key -> 変数（呼び出し元の変数・引数。ref 引数は alias を持ち中身を持たない）
    this.objs = {};    // key -> オブジェクト（参照型のインスタンス）
    this.frames = {};  // key -> 関数呼び出しの枠
    this.console = []; // Console.WriteLine の出力
    this.marks = {};   // このシーンで変わったもの（黄色で示す）・新しく生成したもの（明るい緑）
    this.seq = {};     // 例ごとのオブジェクト番号。別々のプログラムなので、それぞれ #001 から振る
  }

  // ===== ステップの組み立て =====
  function Director() {
    this.steps = [];
    this.w = new World();
    this.p = null;          // シーン内で持ち越す表示状態（コード・レーン・列見出しなど）
    this.principles = [];   // 発表全体で積み上がる「3つの原理」のチップ
  }

  Director.prototype.scene = function (no, title, opt) {
    opt = opt || {};
    const prev = this.p;
    this.p = {
      scene: no, title, layout: opt.layout || 'main',
      blocks: [], console: null, lanes: [], cols: [], quads: [], dim: [],
    };
    // まとめでは直前の 4 分割をそのまま背景に残したいので、図の状態を引き継げるようにする。
    if (opt.inherit && prev) { this.p.quads = clone(prev.quads); }
    else { this.w.marks = {}; }
    this.w.console = [];
  };

  Director.prototype.step = function (fn) {
    const s = new Step(this);
    fn(s);
    const snap = s.snapshot();
    snap.index = this.steps.length;
    this.steps.push(snap);
    return snap;
  };

  function Step(d) {
    this.d = d;
    this.w = d.w;
    this.events = [];
    this.quietDepth = 0;
    this.muteDepth = 0;
    this.out = { hl: null, caption: null, notes: [], overlays: [], header: true, chips: true, bg: false };
  }

  // quiet: 演出なし・変更マークなし（シーン冒頭の状態づくり用）
  // mute: 演出なし・変更マークあり（比較用に「変わった後」を静かに再現する用）
  Step.prototype.quiet = function (fn) { this.quietDepth++; try { fn(); } finally { this.quietDepth--; } };
  Step.prototype.mute = function (fn) { this.muteDepth++; try { fn(); } finally { this.muteDepth--; } };
  Step.prototype.ev = function (e) { if (!this.quietDepth && !this.muteDepth) this.events.push(e); };
  Step.prototype.mark = function (k) { if (!this.quietDepth) this.w.marks[k] = true; };

  // 4 象限のように同時に起きる処理を、トラックごとの並列イベントとして記録する。
  Step.prototype.par = function () {
    const fns = Array.prototype.slice.call(arguments);
    if (this.quietDepth || this.muteDepth) { fns.forEach(f => f()); return; }
    const outer = this.events;
    const tracks = fns.map(f => { this.events = []; f(); return this.events; });
    this.events = outer;
    this.events.push({ t: 'par', tracks });
  };

  // ----- 意味論の操作 -----
  Step.prototype.declare = function (key, o) {
    this.w.vars[key] = {
      key, name: o.name, type: o.type, shape: o.shape || 'val', lane: o.lane || null,
      frame: o.frame || null, x: o.x, y: o.y, s: o.s || 1, content: V.empty(), alias: null,
    };
    this.ev({ t: 'varAppear', key });
  };

  // ref 引数は新しい箱を作らず、呼び出し元の変数の「別名」になる。だから中身(content)を持たない。
  Step.prototype.refParam = function (key, target, o) {
    if (!this.w.vars[target]) throw new Error('unknown ref target ' + target);
    this.w.vars[key] = {
      key, name: o.name, type: o.type, shape: 'alias', lane: o.lane || null,
      frame: o.frame || null, x: o.x, y: o.y, s: o.s || 1, content: null, alias: target,
    };
    this.ev({ t: 'alias', key, target });
  };

  // 別名をたどって実体の変数を得る。経路は「ref を経由して操作した」演出に使う。
  Step.prototype.deref = function (key) {
    let v = this.w.vars[key];
    if (!v) throw new Error('unknown var ' + key);
    const path = [key];
    while (v.alias) { v = this.w.vars[v.alias]; path.push(v.key); }
    return { v, path };
  };

  Step.prototype.newObj = function (key, o) {
    const g = o.group;
    const n = (this.w.seq[g] || 0) + 1;
    this.w.seq[g] = n;
    const id = '#' + String(n).padStart(3, '0');
    this.w.objs[key] = {
      key, id, type: o.type, fields: Object.assign({}, o.fields), lane: o.lane || null,
      x: o.x, y: o.y, s: o.s || 1,
    };
    this.mark('new:' + key);
    this.ev({ t: 'objCreate', key });
    return V.ref(key, id);
  };

  // 宣言時の初期化。代入と同じ演出を使うが、「変更された値」の黄色は付けない。
  Step.prototype.init = function (key, value, src) {
    const { v, path } = this.deref(key);
    const old = clone(v.content);
    v.content = clone(value);
    this.ev({ t: 'assign', init: true, path, to: v.key, old, value: clone(value), src: src || { kind: 'lit' } });
  };

  // 変数への代入。ref 引数なら別名をたどって、呼び出し元の変数そのものに書き込む。
  Step.prototype.assign = function (key, value, src) {
    const { v, path } = this.deref(key);
    const old = clone(v.content);
    v.content = clone(value);
    this.mark('v:' + v.key);
    this.ev({ t: 'assign', path, to: v.key, old, value: clone(value), src: src || { kind: 'lit' } });
  };

  // 値渡し：引数という別の変数に、呼び出し元の変数の中身をコピーする（値型でも参照型でも同じ操作）。
  Step.prototype.copy = function (fromKey, toKey) {
    const src = this.deref(fromKey).v;
    const dst = this.w.vars[toKey];
    if (!dst || dst.alias) throw new Error('copy target must be a real variable: ' + toKey);
    dst.content = clone(src.content);
    this.ev({ t: 'copy', from: src.key, to: toKey });
  };

  // box.Value = n：変数が参照なら参照先オブジェクトを、構造体なら変数の中の値そのものを書き換える。
  Step.prototype.setMember = function (key, field, value) {
    const { v, path } = this.deref(key);
    if (v.content.k === 'ref') {
      const o = this.w.objs[v.content.obj];
      const old = o.fields[field];
      o.fields[field] = value;
      this.mark('of:' + o.key + '.' + field);
      this.ev({ t: 'member', path, obj: o.key, field, old, value });
    } else if (v.content.k === 'struct') {
      const old = v.content.fields[field];
      v.content.fields[field] = value;
      this.mark('vf:' + v.key + '.' + field);
      this.ev({ t: 'member', path, obj: null, field, old, value });
    } else {
      throw new Error('member access on ' + v.content.k + ' (' + key + ')');
    }
  };

  Step.prototype.getMember = function (key, field) {
    const { v } = this.deref(key);
    if (v.content.k === 'ref') return this.w.objs[v.content.obj].fields[field];
    if (v.content.k === 'struct') return v.content.fields[field];
    throw new Error('member access on ' + v.content.k + ' (' + key + ')');
  };

  // Console.WriteLine(a.Value)
  Step.prototype.print = function (key, field) {
    const { v, path } = this.deref(key);
    const value = this.getMember(key, field);
    this.w.console.push(String(value));
    this.ev({
      t: 'read', path, obj: v.content.k === 'ref' ? v.content.obj : null,
      field, value, line: this.w.console.length - 1,
    });
    return value;
  };

  Step.prototype.openFrame = function (key, o) {
    this.w.frames[key] = { key, title: o.title, lane: o.lane || null, x: o.x, y: o.y, s: o.s || 1, done: false };
    this.ev({ t: 'frameOpen', key });
  };
  Step.prototype.closeFrame = function (key) {
    this.w.frames[key].done = true;
    this.ev({ t: 'frameDone', key });
  };

  Step.prototype.remove = function () {
    for (const k of arguments) { delete this.w.vars[k]; delete this.w.objs[k]; delete this.w.frames[k]; }
  };
  // 1 つの例（レーン・象限）を丸ごと消して、オブジェクト番号も #001 から振り直す。
  Step.prototype.clear = function (lane) {
    for (const table of [this.w.vars, this.w.objs, this.w.frames]) {
      for (const k of Object.keys(table)) if (table[k].lane === lane) delete table[k];
    }
    for (const k of Object.keys(this.w.marks)) if (k.indexOf(':' + lane + '.') >= 0) delete this.w.marks[k];
    delete this.w.seq[lane];
  };
  Step.prototype.clearAll = function () {
    this.w.vars = {}; this.w.objs = {}; this.w.frames = {}; this.w.seq = {}; this.w.marks = {};
  };
  Step.prototype.move = function (key, pos) {
    const e = this.w.vars[key] || this.w.objs[key] || this.w.frames[key];
    if (!e) throw new Error('unknown element ' + key);
    Object.assign(e, pos);
  };
  Step.prototype.moveLane = function (lane, y, y2) {
    for (const table of [this.w.vars, this.w.objs, this.w.frames]) {
      for (const e of Object.values(table)) if (e.lane === lane) e.y = (y2 != null && e.key.endsWith('.o2')) ? y2 : y;
    }
  };
  Step.prototype.reopenFrame = function (key) { this.w.frames[key].done = false; };

  // ----- 表示の操作 -----
  Step.prototype.code = function (blocks) { this.d.p.blocks = layoutBlocks(blocks); };
  Step.prototype.consoleBox = function () {
    const last = this.d.p.blocks[this.d.p.blocks.length - 1];
    this.d.p.console = { x: CODE.x, y: last.y + last.h + CODE.gap, w: CODE.w };
  };
  Step.prototype.noConsole = function () { this.d.p.console = null; };
  Step.prototype.hl = function (block, line, sub) {
    this.out.hl = block == null ? null : { block, lines: Array.isArray(line) ? line : [line], sub: sub || null };
  };
  Step.prototype.caption = function (text, badge, kind) { this.out.caption = { text, badge: badge || null, kind: kind || null }; };
  Step.prototype.note = function (at, text, kind, side) {
    side = side || 'below';
    this.out.notes.push({ key: 'n|' + at + '|' + side + '|' + text, at, text, kind: kind || 'info', side });
  };
  Step.prototype.overlay = function (key, html, kind, pos) {
    this.out.overlays.push({ key, html, kind, x: pos.x, y: pos.y });
  };
  Step.prototype.lanes = function (list) { this.d.p.lanes = list; };
  Step.prototype.cols = function (list) { this.d.p.cols = list; };
  Step.prototype.dim = function () { this.d.p.dim = Array.prototype.slice.call(arguments); };
  Step.prototype.header = function (on) { this.out.header = on; };
  Step.prototype.chips = function (on) { this.out.chips = on; };
  Step.prototype.background = function (on) { this.out.bg = on; };
  Step.prototype.principle = function (n, text) {
    const arr = this.d.principles.filter(x => x.n !== n);
    arr.push({ n, text });
    arr.sort((a, b) => a.n - b.n);
    this.d.principles = arr;
  };
  Step.prototype.quads = function (list) { this.d.p.quads = list; };
  Step.prototype.quadResult = function (quadKey, op, value) {
    const q = this.d.p.quads.find(q => q.key === quadKey);
    q.res = q.res.filter(r => r.op !== op).concat([{ op, v: value }]);
  };

  Step.prototype.snapshot = function () {
    const d = this.d, w = this.w, p = d.p;
    const dim = new Set(p.dim);
    const aliasTargets = new Set(Object.values(w.vars).filter(v => v.alias).map(v => v.alias));
    const doneFrame = f => !!(f && w.frames[f] && w.frames[f].done);
    const marksWith = prefix => {
      const r = {};
      for (const k in w.marks) if (k.indexOf(prefix) === 0) r[k.slice(prefix.length)] = true;
      return r;
    };
    const vars = Object.values(w.vars).map(v => Object.assign(clone(v), {
      changed: !!w.marks['v:' + v.key],
      fchanged: marksWith('vf:' + v.key + '.'),
      aliased: aliasTargets.has(v.key),
      aliasName: v.alias ? w.vars[v.alias].name : null,
      dim: dim.has(v.lane),
      faded: doneFrame(v.frame),
    }));
    const objs = Object.values(w.objs).map(o => Object.assign(clone(o), {
      fchanged: marksWith('of:' + o.key + '.'),
      fresh: !!w.marks['new:' + o.key],
      dim: dim.has(o.lane),
    }));
    const frames = Object.values(w.frames).map(f => Object.assign(clone(f), { dim: dim.has(f.lane) }));
    const arrows = vars.filter(v => !v.alias && v.content.k === 'ref').map(v => ({
      key: 'arr:' + v.key, from: v.key, to: v.content.obj, dim: v.dim, faded: v.faded,
    }));
    const links = vars.filter(v => v.alias).map(v => ({
      key: 'lnk:' + v.key, from: v.key, to: v.alias, dim: v.dim, faded: v.faded,
    }));
    return {
      scene: p.scene, title: p.title, layout: p.layout,
      header: this.out.header, chips: this.out.chips, bg: this.out.bg,
      blocks: clone(p.blocks).map(b => Object.assign(b, { dim: !!b.lane && dim.has(b.lane) })),
      hl: this.out.hl,
      console: p.console ? Object.assign(clone(p.console), { lines: w.console.slice() }) : null,
      lanes: clone(p.lanes).map(l => Object.assign(l, { dim: dim.has(l.key) })),
      cols: clone(p.cols),
      quads: clone(p.quads),
      frames, vars, objs, arrows, links,
      notes: this.out.notes, overlays: this.out.overlays, caption: this.out.caption,
      principles: clone(d.principles),
      events: this.events,
    };
  };

  function layoutBlocks(blocks) {
    let y = CODE.top;
    return blocks.map(b => {
      const fs = b.fs || CODE.fs;
      const out = Object.assign({ x: CODE.x, w: CODE.w, fs }, b);
      out.lh = lineHeight(fs);
      if (b.y == null) out.y = y;
      out.h = CODE.head + out.lines.length * out.lh + CODE.pad + (out.foot ? CODE.foot : 0);
      y = out.y + out.h + CODE.gap;
      return out;
    });
  }

  // ===== シナリオ =====
  function build() {
    const d = new Director();
    const L1 = Object.assign({ key: 'L1', label: '値型' }, LANE_TOP);
    const L2 = Object.assign({ key: 'L2', label: '参照型' }, LANE_BOTTOM);
    const COLS = (callerText) => [
      { key: 'caller', text: callerText || '呼び出し元', x: X.caller },
      { key: 'obj', text: 'オブジェクト', x: X.obj },
      { key: 'callee', text: '関数の中', x: X.callee },
    ];

    // 参照型の値渡しで Change を呼んだ直後の状態（a と box が同じ #001 を指す）を静かに作る。
    function setupBoxByValue(s, lane, y) {
      s.quiet(() => {
        const r = s.newObj(lane + '.o1', { group: lane, type: 'Box', fields: { Value: 10 }, lane, x: X.obj, y });
        s.declare(lane + '.a', { name: 'a', type: 'Box', lane, x: X.caller, y });
        s.init(lane + '.a', r);
        s.openFrame(lane + '.f', { title: 'Change(Box box)', lane, x: X.callee, y });
        s.declare(lane + '.box', { name: 'box', type: 'Box', lane, frame: lane + '.f', x: X.callee, y });
        s.copy(lane + '.a', lane + '.box');
      });
    }

    // ---------- シーン1：タイトルと問題提起 ----------
    d.scene(1, '値渡しなのに値が変わる？', { layout: 'title' });
    d.step(s => {
      s.header(false);
      s.overlay('t-title', '値渡しなのに<span class="hl">値が変わる？</span>', 'title', { x: 960, y: 430 });
      s.overlay('t-sub', '値型・参照型と値渡し・参照渡しを可視化してみた', 'subtitle', { x: 960, y: 570 });
      s.overlay('t-tag', 'ゆるトーク　·　C#', 'tag', { x: 960, y: 670 });
    });
    d.step(s => {
      s.code([
        { key: 'type', label: '型', lines: ['class Box', '{', '    public int Value;', '}'], x: 200, y: 200, w: 700, fs: 32 },
        { key: 'fn', label: '関数', lines: ['void Change(Box box)', '{', '    box.Value = 20;', '}'], x: 200, y: 470, w: 700, fs: 32 },
        { key: 'main', label: '呼び出し元', lines: ['Box a = new Box { Value = 10 };', '', 'Change(a);', '', 'Console.WriteLine(a.Value);'], x: 1020, y: 200, w: 700, fs: 32 },
      ]);
      s.caption('このコード、最後に何が表示される？');
    });
    d.step(s => {
      s.hl('main', 4);
      s.overlay('q', '結果は <b class="n10">10</b>？ それとも <b class="n20">20</b>？', 'question', { x: 1370, y: 620 });
      s.overlay('q-hint', '※ 引数に <code>ref</code> が付いていない ＝ <b>値渡し</b>', 'hint', { x: 1370, y: 740 });
    });

    // ---------- シーン2：変数には何が入っている？ ----------
    d.scene(2, '変数には何が入っている？');
    d.step(s => {
      s.lanes([L1]);
      s.cols(COLS('変数').slice(0, 1));
      s.code([{ key: 'v', lane: 'L1', label: '値型（int）', lines: ['int a = 10;'], y: 176 }]);
      s.hl('v', 0);
      s.declare('L1.a', { name: 'a', type: 'int', lane: 'L1', x: X.caller, y: Y.top });
      s.init('L1.a', V.int(10));
      s.caption('値型の変数には、データそのものが入る');
    });
    let r001;
    d.step(s => {
      s.lanes([L1, L2]);
      s.cols(COLS('変数').slice(0, 2));
      s.code([
        { key: 'v', lane: 'L1', label: '値型（int）', lines: ['int a = 10;'], y: 176 },
        { key: 'r', lane: 'L2', label: '参照型（class Box）', lines: ['class Box { public int Value; }', '', 'Box a = new Box { Value = 10 };'], y: 528 },
      ]);
      s.dim('L1');
      s.hl('r', 2, 'new Box { Value = 10 }');
      r001 = s.newObj('L2.o1', { group: 'L2', type: 'Box', fields: { Value: 10 }, lane: 'L2', x: X.obj, y: Y.bottom });
      s.note('L2.o1', '#001 は説明用の識別子（メモリアドレスではない）', 'info');
      s.caption('new でオブジェクトが作られる');
    });
    d.step(s => {
      s.hl('r', 2, 'Box a =');
      s.declare('L2.a', { name: 'a', type: 'Box', lane: 'L2', x: X.caller, y: Y.bottom });
      s.init('L2.a', r001, { kind: 'obj', key: 'L2.o1' });
      s.caption('変数 a に入るのは、オブジェクトへの参照 #001');
    });
    d.step(s => {
      s.dim();
      s.note('L1.a', 'データそのもの', 'info');
      s.note('L2.a', 'オブジェクトへの参照', 'ref');
      s.principle(1, '中身は？');
      s.caption('変数には何が入っている？', 1, 'principle');
    });

    // ---------- シーン3：値渡しはコピーするだけ ----------
    d.scene(3, '値渡しは「コピー」するだけ');
    const s3code = [
      { key: 'v', lane: 'L1', label: '値型（int）', lines: ['void Change(int x)', '{', '    x = 20;', '}', '', 'int a = 10;', 'Change(a);'], y: 176 },
      { key: 'r', lane: 'L2', label: '参照型（class Box）', lines: ['void Change(Box box)', '{', '    // ...', '}', '', 'Box a = new Box { Value = 10 };', 'Change(a);'], y: 528 },
    ];
    d.step(s => {
      s.lanes([L1, L2]);
      s.cols(COLS());
      s.code(s3code);
      s.dim('L2');
      s.hl('v', 6);
      s.openFrame('L1.f', { title: 'Change(int x)', lane: 'L1', x: X.callee, y: Y.top });
      s.declare('L1.x', { name: 'x', type: 'int', lane: 'L1', frame: 'L1.f', x: X.callee, y: Y.top });
      s.caption('呼び出すと、引数 x という新しい変数ができる');
    });
    d.step(s => {
      s.hl('v', 0, 'int x');
      s.copy('L1.a', 'L1.x');
      s.caption('a の中身 10 を、x にコピーする');
    });
    d.step(s => {
      s.hl('v', 2);
      s.assign('L1.x', V.int(20));
      s.note('L1.a', '10 のまま', 'same');
      s.caption('x を書き換えても、a は 10 のまま（別の箱だから）');
    });
    d.step(s => {
      s.dim('L1');
      s.hl('r', 6);
      s.openFrame('L2.f', { title: 'Change(Box box)', lane: 'L2', x: X.callee, y: Y.bottom });
      s.declare('L2.box', { name: 'box', type: 'Box', lane: 'L2', frame: 'L2.f', x: X.callee, y: Y.bottom });
      s.caption('参照型でも同じ。引数 box という新しい変数ができる');
    });
    d.step(s => {
      s.hl('r', 0, 'Box box');
      s.copy('L2.a', 'L2.box');
      s.note('L2.o1', 'オブジェクトはコピーされない', 'info');
      s.caption('a の中身 #001 を、box にコピーする');
    });
    d.step(s => {
      s.dim();
      s.note('L1.x', '10 をコピー', 'copy');
      s.note('L2.box', '#001 をコピー', 'copy');
      s.principle(2, 'コピー？');
      s.caption('値渡し ＝ 中身をコピーするだけ。値型も参照型も同じ', 2, 'principle');
    });

    // ---------- シーン4：参照型を値渡しして、オブジェクトを書き換える ----------
    d.scene(4, '参照型を値渡しして、オブジェクトを書き換える');
    const s4code = fnBody => [
      { key: 'type', label: '型', lines: ['class Box { public int Value; }'] },
      { key: 'fn', label: '関数', lines: ['void Change(Box box)', '{', '    ' + fnBody, '}'] },
      { key: 'main', label: '呼び出し元', lines: ['Box a = new Box { Value = 10 };', 'Change(a);', 'Console.WriteLine(a.Value);'] },
    ];
    d.step(s => {
      s.remove('L1.a', 'L1.x', 'L1.f');
      s.moveLane('L2', Y.single);
      s.lanes([]);
      s.cols(COLS());
      s.dim();
      s.code(s4code('box.Value = 20;'));
      s.consoleBox();
      s.hl('main', 1);
      s.ev({ t: 'pulseArrows', keys: ['arr:L2.a', 'arr:L2.box'] });
      s.note('L2.o1', '同じオブジェクト', 'ref');
      s.caption('a と box は別々の変数。でも指す先は同じ #001');
    });
    d.step(s => {
      s.hl('fn', 2);
      s.setMember('L2.box', 'Value', 20);
      s.caption('box が指す #001 の Value を書き換える');
    });
    d.step(s => {
      s.hl('main', 2);
      s.closeFrame('L2.f');
      s.print('L2.a', 'Value');
      s.caption('a から #001 をたどると…');
    });
    const answer = s => s.overlay('ans', '値渡しなのに、<b>20</b> になった！', 'answer', { x: X.obj, y: 262 });
    d.step(s => {
      s.hl('main', 2);
      answer(s);
    });
    d.step(s => {
      s.hl('main', 2);
      answer(s);
      s.note('L2.a', '#001 のまま', 'same');
      s.note('L2.box', '#001 のまま', 'same');
      s.note('L2.o1', 'Value が変わった', 'chg');
      s.caption('変数は変わっていない。<em>オブジェクトが変わった。</em>', null, 'strong');
    });

    // ---------- シーン5：参照型を値渡しして、別のオブジェクトを代入する ----------
    d.scene(5, '参照型を値渡しして、別のオブジェクトを代入する');
    let r002;
    d.step(s => {
      // シーン4で書き換えたオブジェクトを使い回さず、同じ初期状態から始める（比較しやすくするため）。
      s.clear('L2');
      setupBoxByValue(s, 'L2', Y.single);
      s.code(s4code('box = new Box { Value = 30 };'));
      s.consoleBox();
      s.cols(COLS());
      s.hl('main', 1);
      s.caption('同じ状態から。今度は box に別のオブジェクトを代入する');
    });
    d.step(s => {
      s.hl('fn', 2, 'new Box { Value = 30 }');
      r002 = s.newObj('L2.o2', { group: 'L2', type: 'Box', fields: { Value: 30 }, lane: 'L2', x: X.obj, y: Y.single2 });
      s.caption('new で新しいオブジェクト #002 ができる');
    });
    d.step(s => {
      s.hl('fn', 2, 'box =');
      s.assign('L2.box', r002, { kind: 'obj', key: 'L2.o2' });
      s.note('L2.a', '#001 のまま', 'same');
      s.caption('代入で変わるのは、関数側の変数 box だけ');
    });
    d.step(s => {
      s.hl('main', 2);
      s.closeFrame('L2.f');
      s.print('L2.a', 'Value');
      s.caption('a は #001 を指したまま → 10');
    });
    d.step(s => {
      // 上段にシーン4の「メンバーを書き換えた後」を再現し、下段のシーン5と並べて比べる。
      s.mute(() => {
        const r = s.newObj('C4.o1', { group: 'C4', type: 'Box', fields: { Value: 10 }, lane: 'C4', x: X.obj, y: Y.top });
        s.declare('C4.a', { name: 'a', type: 'Box', lane: 'C4', x: X.caller, y: Y.top });
        s.init('C4.a', r);
        s.openFrame('C4.f', { title: 'Change(Box box)', lane: 'C4', x: X.callee, y: Y.top });
        s.declare('C4.box', { name: 'box', type: 'Box', lane: 'C4', frame: 'C4.f', x: X.callee, y: Y.top });
        s.copy('C4.a', 'C4.box');
        s.setMember('C4.box', 'Value', 20);
      });
      delete s.w.marks['new:C4.o1'];
      s.moveLane('L2', Y.bottom, Y.bottom2);
      s.reopenFrame('L2.f');
      s.noConsole();
      s.lanes([
        Object.assign({ key: 'C4', label: 'メンバー変更' }, LANE_TOP),
        Object.assign({ key: 'L2', label: '再代入' }, LANE_BOTTOM),
      ]);
      s.code([
        { key: 'c4', label: 'シーン4：メンバーを書き換える', lines: ['box.Value = 20;'], y: 176, foot: { text: '→ オブジェクトが変わる', kind: 'obj' } },
        { key: 'c5', label: 'シーン5：変数に代入する', lines: ['box = new Box { Value = 30 };'], y: 528, foot: { text: '→ 変数 box が変わる', kind: 'var' } },
      ]);
      s.note('C4.o1', 'ここが変わった', 'chg');
      s.note('L2.box', 'ここが変わった', 'chg');
      s.principle(3, '変数？ オブジェクト？');
      s.caption('変数を変える？ オブジェクトを変える？', 3, 'principle');
    });

    // ---------- シーン6：参照渡しでは何が変わる？ ----------
    d.scene(6, '参照渡しでは何が変わる？');
    let r6;
    d.step(s => {
      s.clear('C4');
      s.clear('L2');
      s.quiet(() => {
        s.declare('L1.a', { name: 'a', type: 'int', lane: 'L1', x: X.caller, y: Y.top });
        s.init('L1.a', V.int(10));
        const r = s.newObj('L2.o1', { group: 'L2', type: 'Box', fields: { Value: 10 }, lane: 'L2', x: X.obj, y: Y.bottom });
        s.declare('L2.a', { name: 'a', type: 'Box', lane: 'L2', x: X.caller, y: Y.bottom });
        s.init('L2.a', r);
      });
      s.lanes([L1, L2]);
      s.cols(COLS());
      s.code([
        { key: 'v', lane: 'L1', label: '値型（int）', lines: ['void Change(ref int x)', '{', '    x = 20;', '}', '', 'int a = 10;', 'Change(ref a);'], y: 176 },
        { key: 'r', lane: 'L2', label: '参照型（class Box）', lines: ['void Change(ref Box box)', '{', '    box = new Box { Value = 30 };', '}', '', 'Box a = new Box { Value = 10 };', 'Change(ref a);'], y: 528 },
      ]);
      s.dim('L2');
      s.hl('v', 6);
      s.openFrame('L1.f', { title: 'Change(ref int x)', lane: 'L1', x: X.callee, y: Y.top });
      s.refParam('L1.x', 'L1.a', { name: 'x', type: 'ref int', lane: 'L1', frame: 'L1.f', x: X.callee, y: Y.top });
      s.caption('ref：新しい箱は作らない。x は a そのもの（別名）');
    });
    d.step(s => {
      s.hl('v', 2);
      s.assign('L1.x', V.int(20));
      s.note('L1.a', 'a が 20 に変わった', 'chg');
      s.caption('x への代入 ＝ 呼び出し元の a への代入');
    });
    d.step(s => {
      s.dim('L1');
      s.hl('r', 6);
      s.openFrame('L2.f', { title: 'Change(ref Box box)', lane: 'L2', x: X.callee, y: Y.bottom });
      s.refParam('L2.box', 'L2.a', { name: 'box', type: 'ref Box', lane: 'L2', frame: 'L2.f', x: X.callee, y: Y.bottom });
      s.caption('参照型でも同じ。box は a そのもの（#001 のコピーは作らない）');
    });
    d.step(s => {
      s.hl('r', 2);
      r6 = s.newObj('L2.o2', { group: 'L2', type: 'Box', fields: { Value: 30 }, lane: 'L2', x: X.obj, y: Y.bottom2 });
      s.assign('L2.box', r6, { kind: 'obj', key: 'L2.o2' });
      s.note('L2.a', 'a が #002 に変わった', 'chg');
      s.caption('呼び出し元の a そのものが #002 に変わる');
    });
    d.step(s => {
      s.dim();
      s.note('L1.a', 'a が変わった', 'chg');
      s.note('L2.a', 'a が変わった', 'chg');
      s.principle(2, 'コピー？ 元の変数？');
      s.caption('コピーする？ それとも元の変数を操作する？', 2, 'principle');
    });

    // ---------- シーン7：4パターンを比較する ----------
    d.scene(7, '4パターンを比較する', { layout: 'grid' });
    const Q = [
      { key: 'Q1', kind: 'struct', byRef: false, qx: 40, qy: 246, title: '値型 × <span class="byval">値渡し</span>' },
      { key: 'Q2', kind: 'struct', byRef: true, qx: 970, qy: 246, title: '値型 × <span class="byref">参照渡し</span>' },
      { key: 'Q3', kind: 'class', byRef: false, qx: 40, qy: 626, title: '参照型 × <span class="byval">値渡し</span>' },
      { key: 'Q4', kind: 'class', byRef: true, qx: 970, qy: 626, title: '参照型 × <span class="byref">参照渡し</span>' },
    ];
    const typeOf = q => (q.kind === 'struct' ? 'ValueBox' : 'ReferenceBox');
    const qp = (q, name) => ({ x: q.qx + QPOS[name][0], y: q.qy + QPOS[name][1] });
    const sigOf = q => 'void Change(' + (q.byRef ? 'ref ' : '') + typeOf(q) + ' box)  Change(' + (q.byRef ? 'ref ' : '') + 'a);';

    function quadSetup(s, q) {
      const a = qp(q, 'a');
      s.quiet(() => {
        if (q.kind === 'struct') {
          s.declare(q.key + '.a', { name: 'a', type: 'ValueBox', shape: 'struct', lane: q.key, x: a.x, y: a.y, s: QS });
          s.init(q.key + '.a', V.struct('ValueBox', { Value: 10 }));
        } else {
          const o = qp(q, 'o1');
          const r = s.newObj(q.key + '.o1', { group: q.key, type: 'ReferenceBox', fields: { Value: 10 }, lane: q.key, x: o.x, y: o.y, s: QS });
          s.declare(q.key + '.a', { name: 'a', type: 'ReferenceBox', lane: q.key, x: a.x, y: a.y, s: QS });
          s.init(q.key + '.a', r);
        }
      });
    }
    function quadCall(s, q) {
      const c = qp(q, 'c');
      s.openFrame(q.key + '.f', { title: 'Change', lane: q.key, x: c.x, y: c.y, s: QS });
      if (q.byRef) {
        s.refParam(q.key + '.box', q.key + '.a', { name: 'box', type: 'ref ' + typeOf(q), lane: q.key, frame: q.key + '.f', x: c.x, y: c.y, s: QS });
      } else {
        s.declare(q.key + '.box', { name: 'box', type: typeOf(q), shape: q.kind === 'struct' ? 'struct' : 'val', lane: q.key, frame: q.key + '.f', x: c.x, y: c.y, s: QS });
        s.copy(q.key + '.a', q.key + '.box');
      }
    }
    const DEFS = { key: 'defs', label: '型の定義', lines: ['struct ValueBox { public int Value; }', 'class ReferenceBox { public int Value; }'], x: 1240, y: 104, w: 640, fs: 21 };
    const opBlock = (label, lines) => ({ key: 'op', label, lines, x: 40, y: 104, w: 1180, fs: 26 });

    d.step(s => {
      s.clearAll();
      s.quads(Q.map(q => ({ key: q.key, title: q.title, sig: sigOf(q), x: q.qx, y: q.qy, w: QUAD.w, h: QUAD.h, res: [] })));
      s.code([opBlock('まずは呼び出す（どれも a.Value = 10 から）', ['Change(a);      // 値渡し', 'Change(ref a);  // 参照渡し']), DEFS]);
      Q.forEach(q => quadSetup(s, q));
      s.par.apply(s, Q.map(q => () => quadCall(s, q)));
    });
    d.step(s => {
      s.code([opBlock('操作A：メンバーを書き換える（4つとも関数の中身は同じ）', ['box.Value = 20;']), DEFS]);
      s.hl('op', 0);
      s.par.apply(s, Q.map(q => () => s.setMember(q.key + '.box', 'Value', 20)));
      Q.forEach(q => s.quadResult(q.key, 'A', s.getMember(q.key + '.a', 'Value')));
    });
    d.step(s => {
      // 操作Aの結果を引き継ぐと比較がわかりにくくなるので、呼び出し直後の状態に戻してから操作Bを行う。
      Q.forEach(q => s.clear(q.key));
      Q.forEach(q => { quadSetup(s, q); s.quiet(() => quadCall(s, q)); });
      s.code([opBlock('操作B：引数に代入する（初期状態に戻してから）', ['box = new ValueBox { Value = 30 };      // 値型', 'box = new ReferenceBox { Value = 30 };  // 参照型']), DEFS]);
    });
    d.step(s => {
      s.hl('op', [0, 1]);
      s.par.apply(s, Q.map(q => () => {
        if (q.kind === 'struct') {
          // 構造体の new はオブジェクトを作らない。値そのものが変数に入る。
          s.assign(q.key + '.box', V.struct('ValueBox', { Value: 30 }), { kind: 'lit' });
        } else {
          const o = qp(q, 'o2');
          const r = s.newObj(q.key + '.o2', { group: q.key, type: 'ReferenceBox', fields: { Value: 30 }, lane: q.key, x: o.x, y: o.y, s: QS });
          s.assign(q.key + '.box', r, { kind: 'obj', key: q.key + '.o2' });
        }
      }));
      Q.forEach(q => s.quadResult(q.key, 'B', s.getMember(q.key + '.a', 'Value')));
    });

    // ---------- シーン8：まとめ ----------
    d.scene(8, 'まとめ', { layout: 'grid', inherit: true });
    const sumTitle = s => s.overlay('m-title', '4パターン、覚える必要はありません。', 'big', { x: 960, y: 270 });
    const sumPrinciples = s => {
      s.overlay('m-p1', '<i>1</i>変数には何が入っている？', 'prin', { x: 440, y: 430 });
      s.overlay('m-p2', '<i>2</i>コピーする？ 元の変数を操作する？', 'prin', { x: 440, y: 530 });
      s.overlay('m-p3', '<i>3</i>変数を変える？ オブジェクトを変える？', 'prin', { x: 440, y: 630 });
    };
    const sumSetup = s => { s.background(true); s.chips(false); s.code([]); };
    d.step(s => { sumSetup(s); sumTitle(s); });
    d.step(s => { sumSetup(s); sumTitle(s); sumPrinciples(s); });
    d.step(s => {
      sumSetup(s); sumTitle(s); sumPrinciples(s);
      s.overlay('m-msg', '仕組みがわかれば、結果は自分で導き出せる。', 'msg', { x: 960, y: 810 });
    });

    validate(d.steps);
    return d.steps;
  }

  // シナリオの書き間違い（存在しない行・要素への参照）を、発表中ではなく起動時に検出する。
  function validate(steps) {
    steps.forEach((st, i) => {
      const where = 'step ' + (i + 1);
      if (st.hl) {
        const b = st.blocks.find(b => b.key === st.hl.block);
        if (!b) throw new Error(where + ': unknown code block ' + st.hl.block);
        st.hl.lines.forEach(l => { if (!(l >= 0 && l < b.lines.length)) throw new Error(where + ': bad line ' + l); });
        if (st.hl.sub && b.lines[st.hl.lines[0]].indexOf(st.hl.sub) < 0) throw new Error(where + ': "' + st.hl.sub + '" not in line');
      }
      const keys = new Set(st.vars.map(v => v.key).concat(st.objs.map(o => o.key)));
      st.notes.forEach(n => { if (!keys.has(n.at)) throw new Error(where + ': note anchor ' + n.at); });
      st.vars.forEach(v => { if (v.frame && !st.frames.find(f => f.key === v.frame)) throw new Error(where + ': frame ' + v.frame); });
      st.arrows.forEach(a => { if (!keys.has(a.to)) throw new Error(where + ': arrow to missing ' + a.to); });
    });
  }

  const api = { build, V, X, Y };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.VR_MODEL = api;
})(typeof window !== 'undefined' ? window : globalThis);
