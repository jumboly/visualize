/*
 * 変数・値・参照・オブジェクトの概念モデル。
 * 描画から切り離しているのは、各操作の「前後の状態」を先に確定させ、
 * 画面はその差分を再生するだけにするため（前後移動・再実行しても状態がぶれない）。
 * Node からも require できるようにして、4パターンの結果をコマンドラインで検証できるようにしている。
 *
 * 値の表現:
 *   { k: 'int', v: 10 }                       … 値型（int）
 *   { k: 'struct', t: 'ValueBox', f: {...} }  … 値型（struct）。変数の中にデータそのものが入る
 *   { k: 'ref', o: '#001' }                   … 参照型の値（オブジェクトへの参照）
 * ref 引数は「値」を持たず、alias として呼び出し元の変数そのものを指す。
 */
(function (global) {
  'use strict';

  const clone = (o) => JSON.parse(JSON.stringify(o));
  const empty = () => ({ vars: {}, order: [], objs: {}, callee: null, out: null });

  // 同じ種類の操作は常に同じ長さにする（同じ操作＝同じ演出、をテンポでもそろえるため）
  const DUR = {
    decl: 450, new: 750, set: 1500, copy: 1700, bind: 1200, field: 1500,
    enter: 450, ret: 650, print: 1300, init: 700, reset: 1000, wait: 600,
  };
  const GAP = 150;

  // ref 引数を通して、実際に読み書きされる変数までたどる
  function resolve(s, id) {
    let v = s.vars[id];
    while (v && v.alias) v = s.vars[v.alias];
    return v;
  }

  function readField(s, id, f) {
    const v = resolve(s, id);
    if (!v || !v.val) return undefined;
    if (v.val.k === 'ref') return s.objs[v.val.o].f[f];
    if (v.val.k === 'struct') return v.val.f[f];
    return undefined;
  }

  function newVar(op, extra) {
    return Object.assign({
      id: op.v, name: op.name || op.v, type: op.type, scope: op.scope || 'caller',
      alias: null, val: null, chg: false, fchg: {}, pos: op.pos || null,
    }, extra);
  }

  function markRef(s, val) {
    if (val && val.k === 'ref' && s.objs[val.o]) s.objs[val.o].refd = true;
  }

  function apply(s0, op) {
    if (op.op === 'init' || op.op === 'reset') {
      // 比較の前提をそろえるため、前の状態を引き継がずに初期状態を作り直す
      return op.ops.reduce(apply, empty());
    }
    const s = clone(s0);
    switch (op.op) {
      case 'decl':
        s.vars[op.v] = newVar(op);
        s.order.push(op.v);
        break;
      case 'new':
        // 関数の中で new したものは「新しく生成された」と区別して描くため、生成時のスコープを覚えておく
        s.objs[op.o] = { oid: op.o, type: op.type, f: Object.assign({}, op.f), chg: {}, pos: op.pos || null, refd: false, fresh: !!s.callee };
        break;
      case 'set': {
        const t = resolve(s, op.v);
        t.val = clone(op.val);
        t.chg = !!op.chg;
        t.fchg = {};
        markRef(s, t.val);
        break;
      }
      case 'copy': {
        // 値渡し：新しい引数変数を作り、呼び出し元の変数の「中身」をそのまま複製する。
        // 値型でも参照型でも処理はまったく同じ（参照型ならコピーされるのは参照の値）。
        const src = resolve(s, op.from);
        s.vars[op.v] = newVar(Object.assign({ scope: 'callee' }, op), { val: clone(src.val) });
        s.order.push(op.v);
        break;
      }
      case 'bind':
        // 参照渡し：値はコピーせず、呼び出し元の変数そのものを指す別名を作る
        s.vars[op.v] = newVar(Object.assign({ scope: 'callee' }, op), { alias: op.to });
        s.order.push(op.v);
        break;
      case 'field': {
        const t = resolve(s, op.v);
        if (t.val.k === 'ref') {
          // 参照型：変数の中身（参照）は変えず、参照先オブジェクトの状態だけを変える
          const o = s.objs[t.val.o];
          o.f[op.f] = op.val;
          o.chg[op.f] = true;
        } else if (t.val.k === 'struct') {
          // 値型：データは変数の中にあるので、変数の中身が変わる
          t.val.f[op.f] = op.val;
          t.fchg[op.f] = true;
        } else {
          throw new Error('field: ' + op.v + ' はメンバーを持たない');
        }
        break;
      }
      case 'enter':
        s.callee = { title: op.title };
        break;
      case 'ret':
        // 関数から戻ると引数変数は無くなる。オブジェクトは誰かが参照していれば残る
        for (const id of s.order.filter((id) => s.vars[id].scope === 'callee')) delete s.vars[id];
        s.order = s.order.filter((id) => s.vars[id]);
        s.callee = null;
        break;
      case 'print':
        s.out = String(readField(s, op.v, op.f));
        break;
      case 'wait':
        break;
      default:
        throw new Error('unknown op: ' + op.op);
    }
    return s;
  }

  // 一度でも参照されたのに、今はどの変数からも参照されていないオブジェクト
  function isOrphan(s, oid) {
    const o = s.objs[oid];
    if (!o || !o.refd) return false;
    return !Object.values(s.vars).some((v) => !v.alias && v.val && v.val.k === 'ref' && v.val.o === oid);
  }

  /*
   * def = { steps: [[op, ...], ...] }
   * 各ステップの各操作に、開始時刻・長さ・前後の状態を付けて返す。
   * ステップ k の開始状態はステップ k-1 の最終状態なので、どのステップから描いても整合する。
   */
  function compile(def) {
    let s = empty();
    const steps = def.steps.map((ops) => {
      const start = s;
      let t = 0;
      const timed = ops.map((op) => {
        const before = s;
        const after = apply(s, op);
        const dur = op.dur ?? DUR[op.op];
        const item = { op, before, after, t0: t, dur };
        t += dur + GAP;
        s = after;
        return item;
      });
      return { start, ops: timed, end: s, total: Math.max(0, t - GAP) };
    });
    return Object.assign({}, def, { steps });
  }

  // ---------- 4パターン比較（シーン7）の定義 ----------
  // 表示用のプログラムと検証用で同じ定義を使い、画面と検証結果が食い違わないようにする
  const PATTERNS = [
    { key: 'vv', label: '値型 × 値渡し', vt: true, ref: false },
    { key: 'vr', label: '値型 × 参照渡し', vt: true, ref: true },
    { key: 'rv', label: '参照型 × 値渡し', vt: false, ref: false },
    { key: 'rr', label: '参照型 × 参照渡し', vt: false, ref: true },
  ];

  function patternSetup(p) {
    const T = p.vt ? 'ValueBox' : 'ReferenceBox';
    const ops = [];
    if (p.vt) {
      ops.push({ op: 'decl', v: 'a', type: T });
      ops.push({ op: 'set', v: 'a', val: { k: 'struct', t: T, f: { Value: 10 } } });
    } else {
      ops.push({ op: 'new', o: '#001', type: T, f: { Value: 10 } });
      ops.push({ op: 'decl', v: 'a', type: T });
      ops.push({ op: 'set', v: 'a', val: { k: 'ref', o: '#001' } });
    }
    ops.push({ op: 'enter', title: 'Change' });
    if (p.ref) ops.push({ op: 'bind', v: 'box', type: 'ref ' + T, to: 'a' });
    else ops.push({ op: 'copy', v: 'box', type: T, from: 'a' });
    return ops;
  }

  function patternOpA() {
    return [{ op: 'field', v: 'box', f: 'Value', val: 20, lit: '20', at: [0, 1] }];
  }

  function patternOpB(p) {
    const T = p.vt ? 'ValueBox' : 'ReferenceBox';
    // struct の new はオブジェクトを作らず「値」を作るだけ。class の new だけが新しいオブジェクトを作る
    if (p.vt) return [{ op: 'set', v: 'box', val: { k: 'struct', t: T, f: { Value: 30 } }, chg: true, src: 'code', lit: 'new', at: [0, 1] }];
    return [
      { op: 'new', o: '#002', type: T, f: { Value: 30 }, at: [0, 1] },
      { op: 'set', v: 'box', val: { k: 'ref', o: '#002' }, chg: true, src: 'obj', at: [0, 1] },
    ];
  }

  function patternDef(p) {
    return {
      steps: [
        [{ op: 'init', ops: patternSetup(p), at: [0, 0] }],
        patternOpA(p),
        [{ op: 'reset', ops: patternSetup(p) }, ...patternOpB(p)],
      ],
    };
  }

  // 戻った後に呼び出し元から見える a.Value（関数の中で ref 引数経由で見ても同じ）
  function verifyPatterns() {
    return PATTERNS.map((p) => {
      const c = compile(patternDef(p));
      return { pattern: p.label, A: readField(c.steps[1].end, 'a', 'Value'), B: readField(c.steps[2].end, 'a', 'Value') };
    });
  }

  const api = { DUR, GAP, empty, apply, compile, resolve, readField, isOrphan, PATTERNS, patternDef, verifyPatterns };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else global.VRModel = api;
})(typeof window !== 'undefined' ? window : globalThis);
