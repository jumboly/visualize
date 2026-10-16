# visualize

データ構造やアルゴリズムを可視化したスライドの置き場です。`index.html` から各スライドへリンクしています。

公開ページ: https://www.jumboly.jp/visualize/

| ディレクトリ | 内容 |
|---|---|
| [btree-rtree/](btree-rtree/) | B-treeとR-treeを可視化してみた（なぜXYの複合インデックスでは足りないのか？） |
| [value-reference/](value-reference/) | 値渡しなのに値が変わる？（値型・参照型と値渡し・参照渡しを可視化してみた） |
| [dijkstra/](dijkstra/) | ダイクストラ法を可視化して腹に落とす（6章構成のインタラクティブ教材。TypeScript + Vite。ビルド済みの `dist/index.html` を直接開ける） |
| [value-reference-v2/](value-reference-v2/) | 値渡しなのに値が変わる？ v2（同じテーマの別実装。表示中の C# を実行して結果を検証する `verify/` 付き） |

## 追加するとき

1. `<スライド名>/index.html` を作ります。依存ファイルも同じディレクトリに置き、ブラウザで直接開けるようにします。
2. ルートの `index.html` の `<ul>` にカードを 1 つ追加します。
3. 上の表に 1 行追加します。
