# Azure DevOps 拡張 — アプリケーション仕様

## 概要

VS Code から Azure DevOps を操作する拡張機能。サイドパネルで組織・プロジェクト・スプリント・ワークアイテム・リポジトリを参照し、コマンドパレットから各種操作を実行できる。

## 主な機能

### 認証・組織管理

- **組織追加** (`ado-assist.addOrganization`)
  - 新しい Azure DevOps 組織を追加する
  - 組織名と PAT（Personal Access Token）の入力が必要
  - PAT は VS Code の Secret Storage に暗号化して保存される

- **PAT 入力/更新** (`ado-assist.enterPatForOrg`)
  - 指定した組織の PAT を設定または更新する
  - 検証後、Secret Storage に保存される
  - 以後の API 呼び出しに自動的に利用される

- **組織削除** (`ado-assist.removeOrganization`)
  - 指定した組織と関連する PAT を削除する
  - 組織の全キャッシュがクリアされる

- **すべてクリア** (`ado-assist.removeAllOrganizations`)
  - すべての組織情報と保存済み PAT を一括クリアする
  - キャッシュ・エラー状態も完全にクリアされる

### スプリント・ワークアイテム管理

- **スプリント表示** (`sprintsFolder`)
  - プロジェクト下のすべてのスプリント（イテレーション）を表示
  - カレンダーアイコンで視覚的に識別
  - 各スプリントのワークアイテムを遅延ロードで取得

- **ワークアイテム一覧表示** (`ado-assist.openWorkItems`)
  - スプリント内のワークアイテムを表示
  - 親子関係を階層表示（Epic → Feature → Story → Task）
  - ステータス別にアイコンで表示：
    - ✅ Done（完了）：青チェックマーク
    - 🔴 In Progress（進行中）：赤実行アイコン
    - 🟡 その他：黄問題アイコン

- **ワークアイテムフィルタ**
  - **全件表示** (`all`)：全ワークアイテムを表示
  - **割り当て済み** (`assigned`)：自分に割り当てられたアイテム
  - **マイアクティビティ** (`myactivity`)：自分が作成・編集したアイテム
  - **アクティブ** (`active`)：完了していないアイテム

- **Epic/Issue/Task 作成** (`ado-assist.createEpic/createIssue/createTask`)
  - 新しいワークアイテムを作成する
  - 選択したスプリント/フィルタコンテキストを使用
  - Azure DevOps Web UI で直接編集可能

### Sprint フォルダ操作

- **Sprint アイコン表示**
  - スプリントに対してカレンダーアイコン（$(calendar)）を表示
  - 右クリックメニュー：
    - 📂 ブラウザで開く（integrated browser）
    - 📋 ワークアイテム一覧を表示

### リポジトリ操作

- **リポジトリ表示** (`repositoriesFolder`)
  - プロジェクト下のすべての Git リポジトリを表示
  - リポジトリアイコンで識別

- **Pull Request 管理**
  - **PR 一覧表示**：各リポジトリの PR をステータス別に表示
  - **PR フィルタ**：
    - **マイ PR** (`mine`)：自分が作成した PR
    - **アクティブ** (`active`)：レビュー待ち・ドラフト中の PR
    - **完了** (`completed`)：マージ済みの PR
    - **破棄** (`abandoned`)：破棄された PR

- **リポジトリクローン** (`ado-assist.cloneRepo`)
  - リポジトリをローカルにクローン
  - 保存済み PAT を自動埋め込み（Basic 認証で HTTPS クローン時）
  - エラー時は PAT 埋め込みをスキップして処理継続

- **Pull Request 作成** (`ado-assist.createPullRequest`)
  - 新しい PR を作成する

### ブランチ表示

- **ブランチ一覧表示**
  - リポジトリ下の heads（ローカル/リモート ブランチ）を表示
  - レイジーロード対応

### その他操作

- **URL を開く** (`ado-assist.openUrl`)
  - パネル内のアイテムから Web ページを Integrated Browser で開く
  - URL 取得時に複数フォールバック手段を試行：
    1. `_links?.web?.href`（Web UI リンク）
    2. `url`（API リンク）
    3. `webUrl`（代替 Web リンク）

- **ノード更新** (`ado-assist.refreshNode`)
  - ツリービューの指定ノード（またはツリー全体）をリフレッシュ
  - キャッシュをクリアして最新状態を取得

- **反復アイテムフィルタリング** (`ado-assist.setIterationItemFilter`)
  - イテレーション内のワークアイテムに対してフィルタを適用

- **PR フィルタリング** (`ado-assist.setPrFilter`)
  - リポジトリ下の PR に対してフィルタを適用

## UI レイアウト

### サイドパネル（Activity Bar）

```
📍 Azure DevOps (Sidebar Icon)
├── 🏢 Organization 1
│   ├── 📂 Projects
│   │   ├── 📋 Project A
│   │   │   ├── 📅 Sprints (カレンダーアイコン)
│   │   │   │   ├── 🔽 Sprint 1 (Collapsed by default)
│   │   │   │   │   └── #123 Epic Title (親子階層)
│   │   │   │   │       ├── #124 Feature Title
│   │   │   │   │       └── #125 Story Title
│   │   │   │   └── 🔽 Sprint 2
│   │   │   └── 📦 Repositories (リポアイコン)
│   │   │       ├── 📂 Repo A
│   │   │       │   ├── 🌿 Branches
│   │   │       │   │   ├── main
│   │   │       │   │   └── develop
│   │   │       │   └── 🔗 Pull Requests
│   │   │       │       ├── #1 PR Title (draft)
│   │   │       │       └── #2 PR Title (active)
│   │   │       └── 📂 Repo B
│   └── ⚙️ Actions (Add Org, etc.)
└── 🏢 Organization 2
    └── ...
```

### ツリーアイテムの種類と表現

| Type | Icon | Collapsible | Context |
|------|------|------------|---------|
| organization | 🏢 (blue) | Yes | organization |
| sprintsFolder | 📅 (calendar) | Yes | sprintsFolder |
| sprintsIteration | ▶ / ▼ | Yes | sprintsIteration |
| workItem (active) | 🟡 (yellow issues) | Conditional | workitem_active |
| workItem (done) | ✅ (blue check) | Conditional | workitem |
| repositoriesFolder | 📦 (repo) | Yes | repositoriesFolder |
| repository | 📂 | Yes | repository |
| branches | 🌿 | Yes | branchesFolder |
| branch | — | No | branch |
| pullRequestsFolder | 🔗 | Yes | pullRequestsFolder |
| pullRequest | — | No | pullRequest |

## エラーハンドリング

### 統一されたエラーメッセージ

- **`ERROR_MESSAGES.PAT_INVALID`**: "Authentication failed. The PAT is invalid or has expired."
  - PAT 検証失敗時に表示
  
- **`ERROR_MESSAGES.PAT_REDIRECTED`**: "Authentication failed (redirected). Check your PAT."
  - HTTP 302 リダイレクト（認証失敗）時に表示

### エラー処理の戦略

- API エラーはすべてキャッチして、ユーザーフレンドリーなメッセージを表示
- 秘密情報（PAT）読み込み失敗時は、詳細ログを出力チャネルに記録し、ユーザーには簡潔なメッセージのみ表示
- リポジトリクローン時 PAT 埋め込み失敗は、元の URL でフォールバック

## キャッシング戦略

### キャッシュレイヤー

1. **プロジェクト一覧キャッシュ**
   - キー：`projects:{org}`
   - TTL：ユーザーが `refreshNode` するまで有効

2. **ワークアイテムキャッシュ**
   - キー：`workitems:{org}:{projectId}:iter:{iterationPath}:{filterCategory}`
   - フィルタ変更時に自動クリア

3. **親子関係キャッシュ**
   - キー：`workitems:{org}:{projectId}:iter:{iterationPath}`
   - 値：`Map<parentId, [children]>`（階層構築用）

4. **リポジトリ・PR キャッシュ**
   - キー：`repos:{org}:{projectId}` / `prs:{org}:{repoId}:category:{catKey}`
   - フィルタ変更時に自動クリア

### キャッシュクリア

- 組織削除時：その組織の全キャッシュをクリア
- フィルタ変更時：該当キャッシュのみクリア
- ノード更新時：対象の組織キャッシュをクリア

## 認証・セキュリティ

### PAT 保管

- VS Code の `context.secrets` に PAT を暗号化保存
- キー形式：`ado-assist.pat.{organizationName}`
- ユーザーが組織を削除すると同時に PAT も削除される

### URL ロギング

- ロギング時は `http://` または `https://` 直後のホスト部分に対してのみマスキング
- PAT が URL に埋め込まれている場合は、ホストから `PAT:password@` 部分を削除して出力

## パフォーマンス

- **遅延ロード**：子要素は必要になるまでロードしない
- **並列キャンセル**：フェッチ中にノード削除時、自動キャンセルトークン発行
- **ビルドサイズ**：89.8 KB（esbuild 最適化済み）
- **メモリ管理**：キャッシュサイズはプロジェクト数に依存、明示的なクリア機能あり

## 実装の特徴

### コード品質

- TypeScript strict mode で型安全性を確保
- エラーメッセージは定数化して統一
- フィルタ状態管理は汎用メソッドで統一
- 不要な型変換を削除して可読性向上

### 公開 API

- `TreeDataProvider` パターンで VS Code の標準 API に準拠
- コマンド・コンテキストメニュー で操作可能
- Secrets Storage で安全に PAT 保管

## 制限事項・今後の改善案

### 現在の制限

- WIQL クエリ制限：最大 50 アイテムまでを詳細フェッチ
- ブランチ表示：heads（ローカル・リモート）のみ、タグなし
- PR 表示：基本情報のみ、詳細は Integrated Browser 確認が必要

### 今後の改善案

- タグのサポート追加
- PR レビューコメント表示
- Work Item リンク（関連アイテム）の表示
- キャッシュの TTL 設定
- バッチ操作（複数 Work Item の一括編集）
