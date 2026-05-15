# Azure DevOps 拡張 — アプリケーション仕様

## 概要

VS Code から Azure DevOps を操作する拡張機能。サイドパネルで組織・プロジェクト・スプリント・ワークアイテム・リポジトリを参照し、コマンドパレットから各種操作を実行できる。

## 主な機能

### 認証・組織管理

- **組織追加** (`ado-ext.addOrganization`)
  - 新しい Azure DevOps 組織を追加する
  - 組織名と PAT（Personal Access Token）の入力が必要
  - 同じ組織名が既に登録済みの場合はエラーを表示して処理を中断する
  - PAT は VS Code の Secret Storage に暗号化して保存される
  - PAT が未設定の場合、ツリーに「Enter PAT to connect...」アイテムを表示し、クリックで PAT 入力へ誘導する

- **PAT 入力/更新** (`ado-ext.enterPatForOrg`)
  - 指定した組織の PAT を設定または更新する
  - 検証後、Secret Storage に保存される
  - 以後の API 呼び出しに自動的に利用される

- **組織削除** (`ado-ext.removeOrganization`)
  - 指定した組織と関連する PAT を削除する
  - 削除前に「REMOVE {org}」/「CANCEL」の確認ダイアログを表示する
  - 組織の全キャッシュがクリアされる

- **すべてクリア** (`ado-ext.removeAllOrganizations`)
  - すべての組織情報と保存済み PAT を一括クリアする
  - キャッシュ・エラー状態も完全にクリアされる

### スプリント・ワークアイテム管理

- **スプリント表示** (`sprintsFolder`)
  - プロジェクト下のすべてのスプリント（イテレーション）を表示
  - カレンダーアイコンで視覚的に識別
  - 各スプリントのワークアイテムを遅延ロードで取得

- **ワークアイテム一覧表示** (`ado-ext.openWorkItems`)
  - Azure DevOps の最近更新されたワークアイテムページ（`/_workitems/recentlyupdated/`）を Integrated Browser で開く
  - スプリントノードの右クリックメニューから実行

- **ワークアイテム一覧更新** (`ado-ext.refreshIterationItems`)
  - イテレーション内のワークアイテムを再取得してツリーを更新する
  - 現在のフィルタ状態を維持したまま更新する

- **ワークアイテムフィルタ**
  - **全件表示** (`ado-ext.setIterationItemFilter.all`)：全ワークアイテムを表示
  - **割り当て済み** (`ado-ext.setIterationItemFilter.assigned`)：自分に割り当てられたアイテム
  - **マイアクティビティ** (`ado-ext.setIterationItemFilter.myactivity`)：自分が作成・編集したアイテム
  - **アクティブ** (`ado-ext.setIterationItemFilter.active`)：完了していないアイテム

- **ワークアイテム状態変更**
  - **To Do に変更** (`ado-ext.setWorkItemTodo`)：Work Item を「To Do / New」状態に変更する
  - **進行中に変更** (`ado-ext.setWorkItemDoing`)：Work Item を「Active / In Progress / Doing」状態に変更する
  - **完了に変更** (`ado-ext.setWorkItemDone`)：Work Item を「Done / Closed / Resolved」状態に変更する

- **ワークアイテムを自分にアサイン** (`ado-ext.assignWorkItemToMe`)
  - Work Item の担当者を自分（現在の Azure DevOps ユーザー）に変更する

### Sprint フォルダ操作

- **スプリント管理ページを開く** (`ado-ext.openSprints`)
  - Azure DevOps のスプリントディレクトリページ（`/_sprints/directory`）を Integrated Browser で開く
  - `sprintsFolder` のインラインアクションとして表示

- **スプリント設定ページを開く** (`ado-ext.openSprintSettings`)
  - Azure DevOps のイテレーション設定ページ（`/_settings/work-team?_a=iterations`）を Integrated Browser で開く
  - スプリントノードのコンテキストメニューから実行

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
    - **マイ PR** (`ado-ext.setPrFilter.mine`)：自分が作成した PR
    - **アクティブ** (`ado-ext.setPrFilter.active`)：レビュー待ち・ドラフト中の PR
    - **完了** (`ado-ext.setPrFilter.completed`)：マージ済みの PR
    - **破棄** (`ado-ext.setPrFilter.abandoned`)：破棄された PR

- **Git Graph を開く** (`ado-ext.openGitGraph`)
  - リポジトリノードに対応するローカル Git リポジトリを Git Graph 拡張で開く
  - git remote URL のサフィックス（`/_git/<name>` または `/<name>`）でローカルリポジトリを検索してマッチさせる
  - ローカルに存在しない場合は「先にクローンしてください」メッセージを表示

- **リポジトリクローン** (`ado-ext.cloneRepo`)
  - リポジトリをローカルにクローン
  - クローン前に git remote URL のサフィックス（`/_git/<name>` または `/<name>`）でローカルリポジトリを検索し、既にワークスペースに開いている場合はエクスプローラーを表示して処理を終了
  - 保存済み PAT を自動埋め込み（Basic 認証で HTTPS クローン時）
  - エラー時は PAT 埋め込みをスキップして処理継続

- **Pull Request 作成** (`ado-ext.openCreatePullRequest`)
  - ブランチノードのインラインアクション（`$(git-pull-request)` アイコン）として表示
  - クリックしたブランチを `sourceRef` に自動セット
  - `targetRef` は `(select branch)` として ADO UI 上でユーザーが選択する
  - URL 形式：`/_git/{repo}/pullrequestcreate?sourceRef={branch}&targetRef=(select%20branch)`

### ブランチ表示

- **ブランチ一覧表示**
  - リポジトリ下の heads（ローカル/リモート ブランチ）を表示
  - レイジーロード対応

### GitHub Copilot 連携

- **Work Item を Copilot に送信** (`ado-ext.sendWorkItemToCopilot`)
  - 選択した Work Item の番号・タイトル・説明を GitHub Copilot Chat に送信する
  - `workitem_todo` / `workitem_doing` コンテキストのインラインアクションとして表示（`$(copilot)` アイコン）
  - 説明文は API から取得（`System.Description` フィールド）し、HTML タグを除去して送信
  - Copilot Chat のクエリ形式：`**work item**: #N\n**title**: ...\n**description**: ...`

### ブランチ操作

- **Work Item に対応するブランチを作成** (`ado-ext.createBranchForWorkItem`)
  - Work Item の ID・タイトルからブランチ名を自動生成してチェックアウトする
  - `workitem_todo` / `workitem_doing` コンテキストのインラインアクションとして表示（`$(git-branch)` アイコン）
  - ブランチ名の形式：`{branchPrefix}/{gitUsername}/#{workItemNum}_{sanitizedTitle}`
    - `branchPrefix`：設定 `adoExt.branchPrefix` の値（デフォルト: `"working"`）
    - `gitUsername`：`git config user.name` の値
    - `sanitizedTitle`：タイトルを小文字・英数字・アンダースコアのみに変換
  - ブランチが既に存在する場合は `git checkout`、新規の場合は `git checkout -b` を実行
  - 実行前に、現在のワークスペースの `git remote -v` から組織・プロジェクトを抽出し、選択したワークアイテムの組織・プロジェクトと照合する（不一致の場合はエラー）
  - コマンドはアクティブターミナル（なければ新規作成した「Azure DevOps」ターミナル）に送信する

### その他操作

- **設定を開く** (`ado-ext.openSettings`)
  - VS Code の設定画面を `adoExt.` スコープでフィルタして開く
  - ビュータイトルのアクションバーに表示（`$(gear)` アイコン）

- **URL を開く** (`ado-ext.openUrl`)
  - パネル内のアイテムから Web ページを Integrated Browser で開く
  - URL 取得時に複数フォールバック手段を試行：
    1. `_links?.web?.href`（Web UI リンク）
    2. `url`（API リンク）
    3. `webUrl`（代替 Web リンク）

- **ノード更新** (`ado-ext.refreshNode`)
  - ツリービューの指定ノード（またはツリー全体）をリフレッシュ
  - キャッシュをクリアして最新状態を取得

- **PR アイテム更新** (`ado-ext.refreshPrItems`)
  - PR フォルダ内の Pull Request を再取得してツリーを更新する
  - 現在のフィルタ状態を維持したまま更新する

## 設定項目

| 設定キー              | 型     | デフォルト値 | 説明                                                                                    |
| --------------------- | ------ | ------------ | --------------------------------------------------------------------------------------- |
| `adoExt.branchPrefix` | string | `"working"`  | Work Item からブランチ作成時のプレフィックス（例: `working/username/#id_title` となる） |

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

| Type               | Icon               | Collapsible | Context                       |
| ------------------ | ------------------ | ----------- | ----------------------------- |
| organization       | 🏢 (blue)          | Yes         | organization                  |
| project            | 📂 (blue repo)     | Yes         | adoProject                    |
| sprintsFolder      | 📅 (calendar)      | Yes         | sprintsFolder                 |
| sprintsIteration   | ▶ / ▼              | Yes         | sprintsIteration              |
| sprintsFilter      | 🔽 (filter)        | No          | sprintsIterationFilter\_{key} |
| workItem (todo)    | 🟡 (yellow issues) | Conditional | workitem_todo                 |
| workItem (doing)   | 🔴 (red run)       | Conditional | workitem_doing                |
| workItem (done)    | ✅ (blue check)    | Conditional | workitem_done                 |
| workItem (other)   | 🟡 (yellow issues) | Conditional | workitem                      |
| repositoriesFolder | 📦 (repo)          | Yes         | repositoriesFolder            |
| repository         | 📂                 | Yes         | repo                          |
| branches           | 🌿                 | Yes         | branchesFolder                |
| branch             | —                  | No          | branch                        |
| pullRequestsFolder | 🔗                 | Yes         | pullRequestsFolder            |
| pullRequestsFilter | 🔽 (filter)        | No          | pullRequestsFilter\_{key}     |
| pullRequest        | —                  | No          | pullrequest                   |
| enterPat           | 🔑 (yellow key)    | No          | enterPat                      |

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

### 必要な PAT スコープ

| スコープ         | 権限 | 用途                                                |
| ---------------- | ---- | --------------------------------------------------- |
| Project and Team | Read | プロジェクト一覧取得（`_apis/projects`）            |
| Work Items       | Read | WIQL クエリ・ワークアイテム詳細・イテレーション取得 |
| Code             | Read | リポジトリ一覧・ブランチ一覧・PR 一覧取得           |

> PAT 作成時は上記 3 スコープを `Read` で付与すれば最小権限で動作する。

### PAT 保管

- VS Code の `context.secrets` に PAT を暗号化保存
- キー形式：`ado-ext.pat.{organizationName}`
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
