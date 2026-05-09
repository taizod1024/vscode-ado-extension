# Azure DevOps Assist

VS Code から Azure DevOps を効率的に操作する拡張機能です。

## 🚀 機能

### 📊 ワークアイテム管理
- **スプリント表示**：プロジェクト内のすべてのスプリント（イテレーション）を参照
- **親子階層表示**：Epic → Feature → Story → Task の階層構造を視覚化
- **フィルタリング**：全件・割り当て・マイアクティビティ・アクティブの 4 種類
- **ステータス表示**：Done（青✅）・In Progress（赤🔴）・その他（黄🟡）

### 🔧 操作
- Epic / Issue / Task 作成
- ワークアイテム詳細の Web UI 表示（Integrated Browser）

### 🌳 リポジトリ管理
- **リポジトリ表示**：プロジェクト内のすべての Git リポジトリを参照
- **ブランチ表示**：各リポジトリの heads（ブランチ）を表示
- **Pull Request 管理**：PR をステータス別にフィルタリング表示
- **リポジトリクローン**：PAT を自動埋め込みして HTTPS クローン

### 🔐 認証
- **複数組織対応**：複数の Azure DevOps 組織を同時管理
- **PAT 管理**：Personal Access Token を VS Code Secret Storage に暗号化保存
- **自動埋め込み**：リポジトリクローン時、保存済み PAT を自動利用

## 📦 インストール

### VS Code Marketplace
1. VS Code を起動
2. Extensions タブを開く（Ctrl+Shift+X / Cmd+Shift+X）
3. "Azure DevOps Assist" を検索
4. **Install** をクリック

### ローカルビルド
```bash
# リポジトリをクローン
git clone https://github.com/taizod1024/vscode-ado-assist-extension.git
cd vscode-ado-assist-extension

# 依存関係をインストール
npm install

# ビルド
npm run esbuild

# 拡張機能をテスト
npm run dev  # or F5 in VS Code
```

## 🔑 セットアップ

### 1. Azure DevOps から PAT を取得

1. [dev.azure.com](https://dev.azure.com) にアクセス
2. **User settings** → **Personal access tokens**
3. **New Token** をクリック
4. 以下のスコープを選択：
   - ✅ Work Items (Read)
   - ✅ Code (Read)
   - ✅ Pull Request (Read)
5. トークンをコピー

### 2. 拡張機能で組織を追加

1. VS Code のサイドバーで **Azure DevOps** アイコンをクリック
2. 右下の **+** をクリックして **Add Organization**
3. 組織名（例：`myorgname`）と PAT を入力

### 3. 完了

プロジェクト・スプリント・リポジトリが自動的に表示されます。

## 📋 使い方

### サイドバーで参照
- **Organizations** を展開して階層を確認
- 各ノードを右クリックしてコンテキストメニューで操作

### コマンドパレットで操作
1. **Ctrl+Shift+P** / **Cmd+Shift+P** でコマンドパレットを開く
2. コマンド名の一部を入力して検索

#### 主なコマンド

| コマンド | 説明 |
|---------|------|
| `ado-assist: Add Organization` | 新しい組織を追加 |
| `ado-assist: Enter PAT for Org` | 特定組織の PAT を更新 |
| `ado-assist: Create Epic` | Epic を作成 |
| `ado-assist: Create Issue` | Issue を作成 |
| `ado-assist: Create Task` | Task を作成 |
| `ado-assist: Create Pull Request` | Pull Request を作成 |
| `ado-assist: Clone Repository` | リポジトリをクローン |
| `ado-assist: Refresh Node` | ツリーをリフレッシュ |
| `ado-assist: Remove Organization` | 組織を削除 |
| `ado-assist: Remove All Organizations` | すべての組織を削除 |

### ワークアイテムフィルタリング
スプリント上で以下のいずれかをクリック：
- **all**：全ワークアイテムを表示
- **assigned**：自分に割り当てられたアイテム
- **myactivity**：自分が作成・編集したアイテム
- **active**：完了していないアイテム

### PR フィルタリング
Pull Requests フォルダ上で以下のいずれかをクリック：
- **mine**：自分が作成した PR
- **active**：レビュー待ちのオープン PR
- **completed**：マージ済み PR
- **abandoned**：破棄された PR

## 🔒 セキュリティ

### PAT の保管
- PAT は **VS Code Secret Storage** に暗号化して保存
- ローカルのみ保管（クラウド同期されない）
- 組織削除時に自動削除

### ログ出力
- 出力チャネルにはホスト名のみ表示（PAT は出力されない）
- エラーメッセージは簡潔でセキュアに設計

### リポジトリクローン
- PAT は `PAT:password@host` 形式で git に引き渡し
- ローカルファイルには書き込まれない
- git コマンドは VS Code が管理

## 📝 ログ確認

トラブルシューティングの際は、出力チャネルでログを確認：

1. **View** → **Output** を開く
2. ドロップダウンから **Azure DevOps Assist** を選択
3. API 呼び出し・エラー・キャッシュ操作のログを表示

## 🐛 既知の問題・制限事項

### 制限
- WIQL クエリで最大 50 ワークアイテムまで詳細取得（Azure DevOps API の仕様）
- ブランチは heads（ローカル・リマース）のみ表示、タグ未対応
- PR の詳細情報は Web UI で確認が必要

### 既知の問題
- タイムゾーン表示が UTC で表示される場合がある

## 📚 仕様詳細

詳細な仕様・アーキテクチャについては [.github/APP_SPEC.md](./.github/APP_SPEC.md) を参照してください。

## 🔧 開発

### プロジェクト構成

```
src/
├── extension.ts          # 拡張アクティベーション、コマンド登録
├── ado/
│   ├── index.ts         # 公開 API
│   ├── api.ts           # HTTP リクエスト
│   ├── types.ts         # TypeScript インターフェース
│   ├── adoApiClient.ts  # Azure DevOps API クライアント
│   └── provider.ts      # TreeDataProvider 実装
```

### ビルド

```bash
# TypeScript 型チェック
npx tsc --noEmit

# esbuild でバンドル
npm run esbuild

# ウォッチモード（開発時）
npm run esbuild -- --watch
```

### テスト

現在、ユニットテストは実装されていません。
手動テストは VS Code Dev Host で実行できます（F5）。

## 📄 ライセンス

MIT License

## 👥 貢献

Issue・PR は GitHub リポジトリで受け付けています。

- **Issues**: [taizod1024/vscode-ado-assist-extension/issues](https://github.com/taizod1024/vscode-ado-assist-extension/issues)
- **Pull Requests**: [taizod1024/vscode-ado-assist-extension/pulls](https://github.com/taizod1024/vscode-ado-assist-extension/pulls)

## 🔗 リンク

- [VS Code Marketplace](https://marketplace.visualstudio.com/)
- [GitHub Repository](https://github.com/taizod1024/vscode-ado-assist-extension)
- [Azure DevOps](https://dev.azure.com/)
