# Azure DevOps Assist

VS Code から Azure DevOps を操作する拡張機能です。

## インストール

1. VS Code の Extensions を開く（Ctrl+Shift+X）
2. "Azure DevOps Assist" を検索して Install

## セットアップ

### ステップ 1: PAT を取得

1. [dev.azure.com](https://dev.azure.com) にアクセス
2. User settings > Personal access tokens > New Token
3. 以下のスコープを選択:
   - Work Items (Read)
   - Code (Read)  
   - Pull Request (Read)
4. トークンをコピー

### ステップ 2: 組織を追加

1. VS Code のサイドバーで Azure DevOps のアイコンをクリック
2. コマンドパレット（Ctrl+Shift+P）で「Add Organization」を実行
3. 組織名と PAT を入力

## 使い方

### サイドバーで参照

- Organizations を展開すると、Projects が表示される
- 各 Project の下に以下が表示される:
  - Sprints: スプリント内のワークアイテム
  - Repositories: Git リポジトリ
- 各ノードを右クリックしてアクション実行

### ワークアイテム参照

1. Sprints を展開して目的のスプリントを選択
2. ワークアイテムが親子階層で表示される
3. フィルタボタンをクリックして表示内容を変更:
   - all: すべて表示
   - assigned: 自分に割り当てられたアイテム
   - myactivity: 自分が作成・編集したアイテム
   - active: 完了していないアイテム

### ワークアイテム作成

コマンドパレット（Ctrl+Shift+P）で以下を実行:
- Create Epic: Epic 作成
- Create Issue: Issue 作成
- Create Task: Task 作成

スプリントコンテキストで実行するとそのスプリントに自動設定されます。

### リポジトリ操作

1. Repositories を展開してリポジトリを表示
2. 右クリックメニューで以下を実行:
   - Open URL: Web UI をブラウザで開く
   - Clone Repository: ローカルにクローン（PAT 自動埋め込み）
3. Branches を展開してブランチ一覧を表示

### Pull Request 参照

1. Repository の下の Pull Requests を展開
2. フィルタボタンをクリックして表示内容を変更:
   - mine: 自分が作成した PR
   - active: オープンしている PR
   - completed: マージ済み PR
   - abandoned: 破棄された PR

### ツリーをリフレッシュ

コマンドパレットで「Refresh Node」を実行、または該当ノードを右クリックして Refresh

## コマンド一覧

| コマンド | 説明 |
|---------|------|
| Add Organization | 組織を追加 |
| Enter PAT for Org | 特定組織の PAT を更新 |
| Remove Organization | 組織を削除 |
| Remove All Organizations | すべての組織を削除 |
| Create Epic | Epic を作成 |
| Create Issue | Issue を作成 |
| Create Task | Task を作成 |
| Create Pull Request | PR を作成 |
| Clone Repository | リポジトリをクローン |
| Refresh Node | ツリーをリフレッシュ |
| Open Work Items | ワークアイテム一覧を表示 |
| Open URL | Web UI をブラウザで開く |

## トラブルシューティング

### ログ確認

1. View > Output を開く
2. ドロップダウンから "Azure DevOps Assist" を選択
3. API 呼び出しやエラーのログを確認

### PAT エラー

- エラーメッセージ: "Authentication failed. The PAT is invalid or has expired."
- 対応: コマンドパレットで「Enter PAT for Org」を実行して PAT を再設定

### リポジトリが表示されない

- スプリント情報の取得に時間がかかる場合がある
- 「Refresh Node」を実行して再読み込み

## セキュリティ

- PAT は VS Code の Secret Storage に暗号化して保存
- ログには PAT は出力されない（ホスト名のみ）
- リポジトリクローン時、PAT は git に引き渡されローカルに保存されない

## 詳細仕様

詳しい仕様については [.github/APP_SPEC.md](./.github/APP_SPEC.md) を参照
