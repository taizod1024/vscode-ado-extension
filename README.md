[ENGLISH](#azure-devops-extension-en) | [日本語](#azure-devops-extension-jp)

---

# Azure DevOps Extension EN

A VS Code extension to interact with Azure DevOps from the sidebar.

## Key Features

- Browse organizations, projects, sprints, work items, and repositories in the sidebar
- View work items in a parent-child hierarchy (Epic → Feature → Story → Task) with filter support
- Create work items (Epic / Issue / Task) directly from the sprint context
- Clone repositories with automatic PAT embedding
- View branches and pull requests per repository with filter support
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
4. Copy the token

### Step 2: Add an Organization

1. Click the Azure DevOps icon in the VS Code sidebar
2. Run "Add Organization" from the Command Palette (Ctrl+Shift+P)
3. Enter your organization name and PAT

## Usage

### Browse in the Sidebar

- Expand an organization to see its Projects
- Each Project contains:
  - Sprints: work items in each sprint
  - Repositories: Git repositories
- Right-click any node to perform actions

### View Work Items

1. Expand Sprints and select a sprint
2. Work items are displayed in a parent-child hierarchy
3. Click the filter button to change the view:
   - all: show everything
   - assigned: items assigned to you
   - myactivity: items you created or edited
   - active: incomplete items

### Create Work Items

Run from the Command Palette (Ctrl+Shift+P):

- Create Epic
- Create Issue
- Create Task

When run from a sprint context, the sprint is automatically set.

### Repository Operations

1. Expand Repositories to view repos
2. Right-click a repo to:
   - Open URL: open the Web UI in the integrated browser
   - Clone Repository: clone locally (PAT is embedded automatically)
3. Expand Branches to view the branch list

### View Pull Requests

1. Expand Pull Requests under a repository
2. Click the filter button to change the view:
   - mine: PRs you created
   - active: open PRs
   - completed: merged PRs
   - abandoned: abandoned PRs

### Refresh the Tree

Run "Refresh Node" from the Command Palette, or right-click a node and select Refresh.

## Commands

| Command                     | Description                              |
| --------------------------- | ---------------------------------------- |
| Add Organization            | Add an organization                      |
| Enter PAT for Org           | Update PAT for a specific org            |
| Remove Organization         | Remove an organization                   |
| Remove All Organizations    | Remove all organizations                 |
| Create Epic                 | Create an Epic work item                 |
| Create Issue                | Create an Issue work item                |
| Create Task                 | Create a Task work item                  |
| Create Pull Request         | Create a pull request                    |
| Clone Repository            | Clone a repository                       |
| Refresh Node                | Refresh the tree                         |
| Open Work Items             | Open the work items list                 |
| Open URL                    | Open in the integrated browser           |
| Send Work Item to Copilot   | Send a work item to GitHub Copilot       |
| Create Branch for Work Item | Create/checkout a branch for a work item |
| Open Settings               | Open extension settings                  |

## Troubleshooting

### Check Logs

1. Open View > Output
2. Select "Azure DevOps Extension" from the dropdown
3. Review API call and error logs

### PAT Error

- Error: "Authentication failed. The PAT is invalid or has expired."
- Fix: Run "Enter PAT for Org" from the Command Palette to reset the PAT

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

VS Code から Azure DevOps を操作する拡張機能です。

## 主要機能

- サイドバーで組織・プロジェクト・スプリント・ワークアイテム・リポジトリを参照
- ワークアイテムを親子階層（Epic → Feature → Story → Task）でフィルタ付きで表示
- スプリントコンテキストからワークアイテム（Epic / Issue / Task）を直接作成
- PAT 自動埋め込みでリポジトリをクローン
- リポジトリごとのブランチ・PR をフィルタ付きで表示
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

| コマンド                    | 説明                                          |
| --------------------------- | --------------------------------------------- |
| Add Organization            | 組織を追加                                    |
| Enter PAT for Org           | 特定組織の PAT を更新                         |
| Remove Organization         | 組織を削除                                    |
| Remove All Organizations    | すべての組織を削除                            |
| Create Epic                 | Epic を作成                                   |
| Create Issue                | Issue を作成                                  |
| Create Task                 | Task を作成                                   |
| Create Pull Request         | PR を作成                                     |
| Clone Repository            | リポジトリをクローン                          |
| Refresh Node                | ツリーをリフレッシュ                          |
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
