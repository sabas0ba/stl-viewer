# CLAUDE.md — stl-viewer

本ファイルはこのリポジトリ固有の作業指示である。利用者全体の共通規約より優先する。

## 前提環境

- 開発環境は <https://github.com/sabas0ba/dotfiles> の nix / コンテナ環境を基準とする。
  本リポジトリには最小構成の `flake.nix` を同梱している (`nix develop` で node 22 と
  playwright 用 Chromium が入る)。dotfiles 側の環境を使う場合もそちらを優先してよい。
- `package-lock.json` は生成済みである (playwright 1.56.0)。依存を変更した場合は
  `npm install` の結果を一緒にコミットすること。
- `flake.lock` は未生成である。nix を使う環境で一度 `nix flake update` を実行して
  コミットすること (生成環境に nix がなかったため)。

## このリポジトリの構成

```
src/index.html      HTML テンプレート (/*__CSS__*/ と /*__JS__*/ を差し込む)
src/style.css       スタイル
src/js/NN_*.js      ファイル名の昇順に連結され、1 つの即時実行関数に格納される
build.mjs           バンドル。dist/index.html と dist/stl-viewer.html を生成
dist/               生成物。コミット対象 (CI が `build.mjs --check` で同期を検査する)
test/core.test.mjs  DOM 非依存モジュールの単体テスト (node の vm 上で評価)
test/browser.test.mjs  headless Chromium での結合テスト
test/make-fixtures.mjs 検証用 STL の生成
```

`src/js` の番号帯:

| 帯 | 内容 | DOM/WebGL 依存 |
| --- | --- | --- |
| 00-30 | ユーティリティ、線形代数、STL 入出力、幾何解析 | なし (単体テスト対象) |
| 35 | 中抜き (ボクセル化・空洞生成・surface nets・断面性能) | なし (単体テスト対象) |
| 40-42 | PDF ライタ、実寸図面 (輪郭抽出・用紙割り付け・SVG) | なし (単体テスト対象) |
| 50-60 | WebGL2 ラッパ、シェーダ、カメラ | あり |
| 70 | パーツ / シーン / ステージ判定 | なし (単体テスト対象) |
| 80 | 描画 (ビューポート、断面キャップ、寸法オーバーレイ) | あり |
| 85 | 姿勢評価 | なし (単体テスト対象) |
| 90-99 | UI 配線、中抜きタブ、図面タブ、エントリポイント | あり |

## コーディング規約

- 外部ライブラリを追加しない。ブラウザ側は依存ゼロを維持する (単一 HTML であることが要件)。
- `src/js` はブラウザ互換性を優先し、`var` と `function` 宣言を用いた ES5 相当の記述で統一する
  (ビルド時のトランスパイルを行わないため)。ビルド・テストスクリプト側は ESM で書いてよい。
- コメントと UI 文言は日本語。比喩や誇張表現を用いない。
- 座標系は X 右 / Y 奥 / Z 上、単位 mm、Z=0 がビルドプレート面。この前提を崩さない。
- 数値計算を変更した場合は `test/core.test.mjs` に検証値付きのテストを追加する
  (解析解が分かる形状で期待値を書くこと)。
- 中抜き (`35_hollow.js`) を変更した場合は、立方体・角筒のように体積と断面二次モーメントの
  解析値が分かる形状で検証すること。ボクセル起因の誤差は格子間隔と同程度に収まるはずである。
- PDF 出力に手を入れた場合は `test/pdf-scale.test.mjs` (300dpi でラスタ化して実寸を計測)
  を必ず通すこと。PDF は無圧縮・ASCII のみで生成し、xref のバイトオフセットが
  壊れないよう `serializePDF` の出力順序を変えないこと。
- 描画・UI を変更した場合は `test/browser.test.mjs` に確認を追加し、
  スクリーンショット (`dist/shots/`) で目視確認する。
- コミットメッセージは Conventional Commits。
- 一時ファイルは git ignore 済みのディレクトリ (`dist/shots/` 等) に置く。

## 作業手順

```sh
node build.mjs                 # dist/ を更新 (ソース変更後は必ず実行してコミット)
node test/core.test.mjs        # 単体テスト
node test/pdf-scale.test.mjs   # PDF 実寸検証 (poppler-utils が必要)
node test/make-fixtures.mjs    # 検証用 STL (初回のみ)
NODE_PATH="$(npm root)" node test/browser.test.mjs   # 結合テスト
```

`dist/` の更新漏れは CI (`node build.mjs --check`) で検出される。

## 公開

`main` への push で `.github/workflows/pages.yml` が `dist/` を GitHub Pages へ配置する。
Actions のバージョンはコミット SHA で固定している。更新時も SHA で固定すること。
