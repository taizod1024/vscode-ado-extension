# Azure DevOps 拡張 — アプリケーション仕様

## 概要

VS Code から Azure DevOps を操作する拡張機能である。サイドパネルで組織・プロジェクト・リポジトリ・ワークアイテムを参照し、コマンドパレットから操作を実行できる。

## 主な機能

### 認証・組織管理

- **組織追加** (`ado-assist.addOrganization`)
  - 新しい Azure DevOps 組織を追加する
  - PAT（Personal Access Token）の入力が必要な場合はプロンプトで入力

- **PAT 入力** (`ado-assist.enterPatForOrg`)
  - 指定した組織の PAT を設定・更新する
  - Secrets に保存され、以後の API 呼び出しに利用される

- **組織削除** (`ado-assist.removeOrganization`)
  - 指定した組織と関連する PAT を削除する

- **すべてクリア** (`ado-assist.removeAllOrganizations`)
  - すべての組織情報と保存済み PAT を一括クリアする
  - PAT キャッシュもクリアされるため、新規に組織を追加する際は PAT 入力から始まる

### ワークアイテム管理

- **Epic 作成** (`ado-assist.createEpic`)
  - 新しい Epic を作成する

- **Issue 作成** (`ado-assist.createIssue`)
  - 新しい Issue を作成する

- **Task 作成** (`ado-assist.createTask`)
  - 新しい Task を作成する

### リポジトリ操作

- **Pull Request 作成** (`ado-assist.createPullRequest`)
  - 新しい Pull Request を作成する
  - コメント参照も可能である

- **リポジトリクローン** (`ado-assist.cloneRepo`)
  - リポジトリをローカルにクローンする

### UI・その他

- **URL を開く** (`ado-assist.openUrl`)
  - パネル内のアイテムから Web ページを開く

- **ノード更新** (`ado-assist.refreshNode`)
  - ツリービューの指定ノードをリフレッシュする

## UI レイアウト

- **サイドパネル**（Activity Bar）
  - 組織一覧を表示する
  - 各組織下にプロジェクト、リポジトリ、ワークアイテムのツリーを表示する
  - エラー状態を表示する

- **コマンドパレット**
  - 上記の各操作をコマンドで実行可能である
