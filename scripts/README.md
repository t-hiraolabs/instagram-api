# 素材シート切り出しスクリプト

Story Studio の素材（花・葉・フレーム・リボン等）を画像生成AIで作った「素材シート
（Sprite Sheet、例: 4×4グリッドで16種類・背景完全透明）」から自動切り出しし、
Supabase Storage / DB へ登録するローカル実行ツールです。

管理画面（アプリ内の「素材シート管理」画面）でアップロードした素材シートは
`asset_sheets` テーブルに `status='uploaded'` で登録されます。このスクリプトを
そのレコードのIDを指定して実行すると、切り出し→Storageアップロード→`assets`
テーブルへの登録→`asset_sheets.status` の更新まで行います。

## セットアップ

```bash
cd scripts
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

`scripts/.env` を作成し、以下を設定してください（`.env` はリポジトリ全体で
gitignore対象のため、誤ってコミットされることはありません）。

```
SUPABASE_URL=https://<project-ref>.supabase.co
SUPABASE_SERVICE_ROLE_KEY=<service_role シークレットキー>
```

`SUPABASE_SERVICE_ROLE_KEY` は Supabase Dashboard の
Project Settings > API > `service_role` secret から取得できます。
このキーはRLSを完全にバイパスするため、**絶対にクライアント/リポジトリに含めない**でください。

## 使い方

### 1件だけ処理する

```bash
python crop_sprite_sheet.py --sheet-id <asset_sheets.id>
```

`asset_sheets.id` は管理画面の「シートアップロード」タブに表示されるアップロード
済みシート一覧、または以下のSQLで確認できます。

```sql
select id, original_filename, status from asset_sheets order by created_at desc;
```

### 監視モード（アップロードのたびに手動実行したくない場合）

```bash
python crop_sprite_sheet.py --watch
```

`status='uploaded'` のシートを10秒間隔（`--interval`で変更可）でポーリングし、
見つかり次第自動的に切り出し・登録します。tmux やバックグラウンドプロセスとして
常時起動しておけば、管理画面からアップロードするだけで済むようになります。
Ctrl+Cで停止するまで動き続け、1件の処理に失敗しても監視自体は継続します。

## 素材シートの作成ガイドライン

- 背景は完全透明（アルファ0）にする
- 素材同士は重ならないようにする
- 素材の周囲に十分な余白を空ける（アルファのしきい値判定と連結成分分離のため）
- グリッドの列数・行数がわかっている場合、アップロード時にその値を渡しておくと、
  検出数とグリッド数の不一致を自動検知できます（重なり・余白不足の早期発見）

## アルゴリズム概要

1. シート画像をアルファチャンネルで二値化（`alpha > 10`）
2. `scipy.ndimage.label` で連結成分（＝各素材の輪郭）を検出
3. 小さすぎる成分（ノイズ、50px²未満）は除外
4. グリッド指定がある場合、検出数と一致しなければ処理を中断し
   `asset_sheets.status='failed'` として理由を記録
5. 各bounding boxを数pxパディングして切り出し、透過PNGとして保存
6. 長辺400px程度のサムネイルも生成
7. 本体・サムネイルを `story-assets/{category_slug}/{asset_id}.png` /
   `.../thumb_{asset_id}.png` にアップロード
8. `assets` テーブルに登録（`plan='free'`、`sheet_id`・`crop_x/y/w/h` で元シートとの
   対応関係を保持）。タグ付けは管理画面の素材一覧から別途行ってください。

## コラージュの画像スタイル（シネマ風・レトロ風など）

コラージュ機能の「スタイル」（背景テクスチャ画像＋フレーム画像＋アクセントカラーを
組み合わせた名前付きテンプレート）も、ここで登録した「背景」「フレーム」カテゴリの
素材を使う。手順:

1. 「背景」カテゴリでテクスチャ画像（例: シネマ風の暗いグラデーション）、
   「フレーム」カテゴリで縁取り画像（中央が透過したPNG、例: レターボックスの黒帯）を
   それぞれ素材シートとしてアップロード→このスクリプトで切り出し登録
2. 管理画面の「コラージュスタイル」タブで「新規スタイルを作成」→ 名前・プラン・
   アクセントカラー・背景画像・フレーム画像（任意）を選んで保存
3. コラージュ編集画面の「スタイルを選ぶ」ステップに、組み込みの4色テーマと並んで
   自動的に表示されるようになる
