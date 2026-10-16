/*
 * 画面に表示している C# コードを model.js から取り出して実際にコンパイル・実行し、
 * その出力が model.js の計算結果（画面に出している値）と一致するかを確かめる。
 * 「アニメーションの説明」と「本物の C# の動き」がずれていないことを、手で読む以外の方法で保証するため。
 *
 *   node verify/check.js        （.NET SDK が必要）
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const { build } = require('../model.js');

const steps = build();
const sceneSteps = no => steps.filter(s => s.scene === no);
const last = no => sceneSteps(no).slice(-1)[0];
const blockOf = (st, key) => st.blocks.find(b => b.key === key).lines;
const varOf = (st, key) => st.vars.find(v => v.key === key);
const objOf = (st, key) => st.objs.find(o => o.key === key);
// 「関数」と「呼び出し元」が空行で区切られたブロックを分ける
const splitAtBlank = lines => { const i = lines.indexOf(''); return [lines.slice(0, i), lines.slice(i + 1)]; };
// 参照型の変数 a から見える Value（モデル上の値）
const valueSeenFrom = (st, varKey) => {
  const c = varOf(st, varKey).content;
  return c.k === 'ref' ? objOf(st, c.obj).fields.Value : c.k === 'struct' ? c.fields.Value : c.v;
};

const cases = [];
const add = (name, fn, main, expected) => cases.push({ name, fn, main, expected: String(expected) });

// シーン1（＝シーン4と同じコード）
{
  const st = sceneSteps(1)[1];
  add('scene1', blockOf(st, 'fn'), blockOf(st, 'main').filter(l => l), last(4).console.lines.join(' '));
}
// シーン3：値型と参照型の値渡し
{
  const st = last(3);
  const [vf, vm] = splitAtBlank(blockOf(st, 'v'));
  add('scene3-int', vf, vm.concat('Console.WriteLine(a);'), valueSeenFrom(st, 'L1.a'));
  const [rf, rm] = splitAtBlank(blockOf(st, 'r'));
  add('scene3-Box', rf, rm.concat('Console.WriteLine(a.Value);'), valueSeenFrom(st, 'L2.a'));
}
// シーン4・5：Console.WriteLine の出力そのものを比べる
for (const no of [4, 5]) {
  // シーン5の最後は比較用の画面なので、関数のコードを表示している最後のステップを使う
  const st = sceneSteps(no).filter(s => s.blocks.some(b => b.key === 'fn')).pop();
  const printed = sceneSteps(no).map(s => s.console && s.console.lines.join(' ')).filter(Boolean).pop();
  add('scene' + no, blockOf(st, 'fn'), blockOf(st, 'main'), printed);
}
// シーン6：参照渡し。参照型では a が「別のオブジェクト」に差し替わったかも確かめる
{
  const st = last(6);
  const [vf, vm] = splitAtBlank(blockOf(st, 'v'));
  add('scene6-int', vf, vm.concat('Console.WriteLine(a);'), valueSeenFrom(st, 'L1.a'));
  const [rf, rm] = splitAtBlank(blockOf(st, 'r'));
  const sameObject = varOf(st, 'L2.a').content.obj === 'L2.o1';
  add('scene6-Box', rf, [rm[0], 'var original = a;'].concat(rm.slice(1), 'Console.WriteLine(a.Value + " " + ReferenceEquals(a, original));'),
    valueSeenFrom(st, 'L2.a') + ' ' + (sameObject ? 'True' : 'False'));
}
// シーン7：4パターン × 操作A/B
{
  const sts = sceneSteps(7);
  const opA = blockOf(sts[1], 'op'), opB = blockOf(sts[3], 'op');
  for (const q of last(7).quads) {
    const [sig, call] = q.sig.split(/\s{2,}/);
    const type = /ValueBox/.test(sig) && !/ReferenceBox/.test(sig) ? 'ValueBox' : 'ReferenceBox';
    const bodyB = opB.find(l => l.indexOf('new ' + type + ' ') >= 0).replace(/\s*\/\/.*$/, '');
    for (const [op, body] of [['A', opA[0]], ['B', bodyB]]) {
      add('scene7-' + q.key + op, [sig, '{', '    ' + body, '}'],
        [type + ' a = new ' + type + ' { Value = 10 };', call, 'Console.WriteLine(a.Value);'],
        q.res.find(r => r.op === op).v);
    }
  }
}

// ---- C# を生成 ----
const indent = (lines, n) => lines.map(l => (l ? ' '.repeat(n) + l : l)).join('\n');
const typeDefs = [blockOf(last(4), 'type')[0]].concat(blockOf(sceneSteps(7)[0], 'defs'));
const cls = c => c.name.replace(/[^A-Za-z0-9]/g, '_');
const src = [
  '// node verify/check.js が model.js から生成するファイル（手で編集しない）',
  'using System;',
  '',
  cases.map(c => cls(c) + '.Run();').join('\n'),
  '',
  typeDefs.join('\n'),
  '',
  cases.map(c => [
    'static class ' + cls(c),
    '{',
    indent(['static ' + c.fn[0]].concat(c.fn.slice(1)), 4),
    '    public static void Run()',
    '    {',
    '        Console.Write("' + c.name + ': ");',
    indent(c.main, 8),
    '    }',
    '}',
  ].join('\n')).join('\n\n'),
  '',
].join('\n');

const dir = __dirname;
fs.writeFileSync(path.join(dir, 'Program.cs'), src);
const out = execSync('dotnet run --project "' + dir + '"', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] });
const actual = {};
out.trim().split('\n').forEach(line => { const m = line.match(/^([\w-]+): (.*)$/); if (m) actual[m[1]] = m[2].trim(); });

let ng = 0;
for (const c of cases) {
  const ok = actual[c.name] === c.expected;
  if (!ok) ng++;
  console.log((ok ? 'OK  ' : 'NG  ') + c.name.padEnd(14) + ' C#: ' + String(actual[c.name]).padEnd(8) + ' 画面: ' + c.expected);
}
console.log(ng ? ng + ' 件不一致' : '全 ' + cases.length + ' 件一致');
process.exit(ng ? 1 : 0);
