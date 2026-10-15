import type { ChapterDef } from './types';

/** まだ実装していない章の仮置き。Phase ごとに本物へ差し替える。 */
function placeholder(no: number, title: string, model: string): ChapterDef {
  return {
    no,
    title,
    model,
    create(host) {
      return {
        beats: [
          {
            title: '準備中',
            caption: '<p class="muted">この章は準備中です。</p>',
            enter: () => (host.stage.innerHTML = ''),
          },
        ],
        dispose() {},
      };
    },
  };
}

export const chapters: ChapterDef[] = [
  placeholder(1, '最短経路探索はゴールを目指さない', '波紋のように、累積コストの小さい順に探索が広がる'),
  placeholder(2, '1対1も1対Nも同じ', '目的地は探索の方向を決めない。決めるのは「いつ止めるか」だけ'),
  placeholder(3, '道路ネットワークの世界', '最短経路は、道路のコストと通行可能性で決まる'),
  placeholder(4, '波紋から商圏を作る', '最短コストの探索結果を、面の情報に変換する'),
  placeholder(5, '階層探索で高速化する', 'アルゴリズムだけでなく、探索する対象の構造を工夫する'),
  placeholder(6, '巡回セールスマン問題', 'ダイクストラ法の結果を、別の最適化問題の入力にする'),
];
