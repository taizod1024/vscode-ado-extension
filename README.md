[ENGLISH](#azure-devops-extension-en) | [日本語](#azure-devops-extension-jp)

---

# Azure DevOps Extension EN

> **Note** This extension is under active development.

A VS Code extension to interact with Azure DevOps from the sidebar.

![](https://github.com/taizod1024/vscode-ado-extension/blob/main/images/adoext.png?raw=true)

## Key Features

- Browse organizations, projects, sprints, work items, and repositories in the sidebar
- View work items in a parent-child hierarchy (Epic → Feature → Story → Task) with filter support
- Clone repositories with automatic PAT embedding
- View branches and pull requests per repository with filter support
- View pipeline run history per repository with filter support (All / Running / Failed / Succeeded)
- Create a pull request from a branch with source branch pre-filled
- Send work items to GitHub Copilot Chat
- Create branches for work items automatically from the tree view
- PAT is stored securely in VS Code Secret Storage

## Installation

1. Open Extensions in VS Code (Ctrl+Shift+X)
2. Search for "Azure DevOps Extension" and click Install

## Setup

### Step 1: Get a PAT

1. Go to [dev.azure.com](https://dev.azure.com)
2. User settings > Personal access tokens > New Token
3. Select the following scopes:
   - Project and Team (Read)
   - Work Items (Read)
   - Code (Read)
   - Build (Read)
4. Copy the token

### Step 2: Add an Organization

1. Click the Azure DevOps Extension icon in the VS Code sidebar
2. Click the `+` icon at the top of the panel
3. Enter your organization name and PAT

## Usage

### Browse in the Sidebar

1. Expand an organization to see its Projects
2. Each Project contains:
   - Boards: work items in each sprint
   - Repos: Git repositories
3. Each Repository contains:
   - Branches: branch list
   - Pull Requests: PR list with filter
   - Pipelines: pipeline run history with filter
4. Right-click any node to perform actions

### View Work Items

1. Expand Sprints and select a sprint
2. Work items are displayed in a parent-child hierarchy
3. Right-click the filter icon to change the view:
   - all: show everything
   - assigned: items assigned to you
   - myactivity: items you created or edited
   - active: incomplete items
4. Click the refresh icon on the sprint to reload

### Create Work Items

- Open the Azure DevOps web UI from the Sprints page (`Open Sprints` icon) to create Epic / Issue / Task.

### View Pull Requests

1. Expand Pull Requests under a repository
2. Right-click the filter icon to change the view:
   - mine: PRs you created
   - active: open PRs
   - completed: merged PRs
   - abandoned: abandoned PRs
3. Click the refresh icon on the PR list to reload

### View Pipeline Runs

1. Expand Pipelines under a repository
2. Right-click the filter icon to change the view:
   - all: show all runs
   - running: in-progress runs
   - failed: failed / partially succeeded runs
   - succeeded: successful runs
3. Click the refresh icon on the pipeline list to reload

### Repository Operations

1. Expand Repositories to view repos
2. Click the icon buttons next to the repo to:
   - Open URL: open the Web UI in the integrated browser
   - Clone Repository: clone locally (PAT is embedded automatically)
   - Open Git Graph: open Git Graph for the locally cloned repository
3. Expand Branches to view the branch list
4. Click the refresh icon on Branches to reload
5. Click the `$(git-pull-request)` icon on a branch to open the PR creation page with the source branch pre-filled

### Refresh the Tree

- Click the refresh icon next to the organization node.

## Commands

| Command                     | Description                                             |
| --------------------------- | ------------------------------------------------------- |
| Add Organization            | Add an organization                                     |
| Enter PAT for Org           | Update PAT for a specific org                           |
| Remove Organization         | Remove an organization                                  |
| Remove All Organizations    | Remove all organizations                                |
| Open Sprints                | Open the sprints page in the browser                    |
| Create Pull Request         | Open PR creation page with source branch                |
| Clone Repository            | Clone a repository                                      |
| Open Git Graph              | Open Git Graph for the repository                       |
| Refresh Node                | Refresh the tree                                        |
| Refresh Branches            | Refresh the branch list                                 |
| Refresh PR Items            | Refresh pull request list (keep filter)                 |
| Refresh Pipelines           | Refresh pipeline run list (keep filter)                 |
| Open Work Items             | Open the work items list                                |
| Open URL                    | Open in the integrated browser                          |
| Send Work Item to Copilot   | Send a work item to GitHub Copilot                      |
| Create Branch for Work Item | Create/checkout a branch for a work item                |
| Open Settings               | Open extension settings                                 |

## Troubleshooting

### Check Logs

1. Open View > Output
2. Select "Azure DevOps Extension" from the dropdown
3. Review API call and error logs

### PAT Error

- Error: "Authentication failed. The PAT is invalid or has expired."
- Fix: Right-click the organization node and select "Enter PAT for Org" to reset the PAT

### Repositories Not Shown

- Fetching sprint data may take a moment
- Run "Refresh Node" to reload

## Security

- PAT is encrypted and stored in VS Code Secret Storage
- PAT is never written to logs (only the hostname is logged)
- When cloning, the PAT is passed to git and is not stored locally

## Detailed Specification

See [.github/APP_SPEC.md](./.github/APP_SPEC.md) for the full specification.

---

# Azure DevOps Extension JP

> **注意** この拡張機能は開発中です。

VS Code から Azure DevOps を操作する拡張機能です。

![](https://github.com/taizod1024/vscode-ado-extension/blob/main/images/adoext.png?raw=true)

## 主要機能

- サイドバーで組織・プロジェクト・スプリント・ワークアイテム・リポジトリを参照
- ワークアイテムを親子階層（Epic → Feature → Story → Task）でフィルタ付きで表示
- PAT 自動埋め込みでリポジトリをクローン
- リポジトリごとのブランチ・PR をフィルタ付きで表示
- リポジトリごとのパイプライン実行履歴をフィルタ付きで表示（All / Running / Failed / Succeeded）
- ブランチからソースブランチ自動入力で PR 作成ページを開く
- ワークアイテムを GitHub Copilot Chat に送信
- ツリービューからワークアイテムに対応するブランチを自動作成
- PAT は VS Code の Secret Storage に安全に保存

## インストール

1. VS Code の Extensions を開く（Ctrl+Shift+X）
2. "Azure DevOps Extension" を検索して Install

## セットアップ

### ステップ 1: PAT を取得

1. [dev.azure.com](https://dev.azure.com) にアクセス
2. User settings > Personal access tokens > New Token
3. 以下のスコープを選択:
   - Project and Team (Read)
   - Work Items (Read)
   - Code (Read)
   - Build (Read)
4. トークンをコピー

### ステップ 2: 組織を追加

1. VS Code のサイドバーで Azure DevOps Extension のアイコンをクリック
2. パネル上部の `+` アイコンをクリック
3. 組織名と PAT を入力

## 使い方

### サイドバーで参照

1. Organizations を展開すると、Projects が表示される
2. 各 Project の下に以下が表示される:
   - Boards: スプリント内のワークアイテム
   - Repos: Git リポジトリ
3. 各 Repository の下に以下が表示される:
   - Branches: ブランチ一覧
   - Pull Requests: PR 一覧（フィルタ付き）
   - Pipelines: パイプライン実行履歴（フィルタ付き）
4. 各ノードを右クリックしてアクション実行

### ワークアイテム参照

1. Sprints を展開して目的のスプリントを選択
2. ワークアイテムが親子階層で表示される
3. フィルタアイコンを右クリックして表示内容を変更:
   - all: すべて表示
   - assigned: 自分に割り当てられたアイテム
   - myactivity: 自分が作成・編集したアイテム
   - active: 完了していないアイテム
4. スプリントのリフレッシュアイコンをクリックして再表示

### ワークアイテム作成

- Sprints ページ（`Open Sprints` アイコン）から Azure DevOps の Web UI を開いて Epic / Issue / Task を作成

### Pull Request 参照

1. Repository の下の Pull Requests を展開
2. フィルタアイコンを右クリックして表示内容を変更:
   - mine: 自分が作成した PR
   - active: オープンしている PR
   - completed: マージ済み PR
   - abandoned: 破棄された PR
3. PRのリフレッシュアイコンをクリックして再表示

### パイプライン実行履歴参照

1. Repository の下の Pipelines を展開
2. フィルタアイコンを右クリックして表示内容を変更:
   - all: すべての実行を表示
   - running: 実行中
   - failed: 失敗・部分成功
   - succeeded: 成功
3. リフレッシュアイコンをクリックして再表示

### リポジトリ操作

1. Repositories を展開してリポジトリを表示
2. リポジトリ横のアイコンをクリックして以下を実行:
   - Open URL: Web UI をブラウザで開く
   - Clone Repository: ローカルにクローン（PAT 自動埋め込み）
   - Open Git Graph: ローカルにクローン済みのリポジトリの Git Graph を開く
3. Branches を展開してブランチ一覧を表示
4. Branches のリフレッシュアイコンをクリックして再表示
5. ブランチの `$(git-pull-request)` アイコンをクリックするとソースブランチが自動入力された PR 作成ページを開く

### ツリーをリフレッシュ

- 組織ノード横のリフレッシュアイコンをクリックする

## コマンド一覧

| コマンド                    | 説明                                          |
| --------------------------- | --------------------------------------------- |
| Add Organization            | 組織を追加                                    |
| Enter PAT for Org           | 特定組織の PAT を更新                         |
| Remove Organization         | 組織を削除                                    |
| Remove All Organizations    | すべての組織を削除                            |
| Open Sprints                | スプリント管理ページを開く                    |
| Create Pull Request         | ソースブランチ自動入力で PR 作成ページを開く  |
| Clone Repository            | リポジトリをクローン                          |
| Open Git Graph              | リポジトリの Git Graph を開く                 |
| Refresh Node                | ツリーをリフレッシュ                          |
| Refresh Branches            | ブランチ一覧を再読み込み                      |
| Refresh PR Items            | PR 一覧を再読み込み（フィルタ維持）               |
| Refresh Pipelines           | パイプライン実行履歴を再読み込み（フィルタ維持）    |
| Open Work Items             | ワークアイテム一覧を表示                      |
| Open URL                    | Web UI をブラウザで開く                       |
| Send Work Item to Copilot   | ワークアイテムを GitHub Copilot に送信        |
| Create Branch for Work Item | ワークアイテムのブランチを作成/チェックアウト |
| Open Settings               | 設定を開く                                    |

## トラブルシューティング

### ログ確認

1. View > Output を開く
2. ドロップダウンから "Azure DevOps Extension" を選択
3. API 呼び出しやエラーのログを確認

### PAT エラー

- エラーメッセージ: "Authentication failed. The PAT is invalid or has expired."
- 対応: 組織ノードを右クリックして「Enter PAT for Org」を選択して PAT を再設定

### リポジトリが表示されない

- スプリント情報の取得に時間がかかる場合がある
- 「Refresh Node」を実行して再読み込み

## セキュリティ

- PAT は VS Code の Secret Storage に暗号化して保存
- ログには PAT は出力されない（ホスト名のみ）
- リポジトリクローン時、PAT は git に引き渡されローカルに保存されない

## 詳細仕様

詳しい仕様については [.github/APP_SPEC.md](./.github/APP_SPEC.md) を参照
