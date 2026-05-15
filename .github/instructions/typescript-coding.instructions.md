---
description: "Use when writing or modifying TypeScript files in this VS Code extension. Covers coding conventions, patterns for VS Code API usage, error handling, caching, and JSDoc style."
applyTo: "**/*.ts"
---

> コードを変更したら `.github/APP_SPEC.md` の対応箇所も更新すること（詳細は `app-spec-sync.instructions.md` 参照）。

# TypeScript コーディング規約

## セクションコメント

クラス内のプロパティ・メソッドのグループをセクションコメントで区切る。

```ts
// -----------------------
// Section Name
// -----------------------
```

## JSDoc コメント

- クラス・メソッド・プロパティの説明は日本語で記述する。
- パラメータ・戻り値は `@param`・`@returns` タグで明記する。

```ts
/**
 * PAT の検証と保存を行う共通ハンドラー。
 * @param org 組織名
 * @param pat Personal Access Token
 * @returns 成功時は true、失敗時は false
 */
```

## エラーハンドリング

- API 呼び出しは必ず try-catch で囲み、`channel.appendLine()` でログを出力する。
- ユーザーへのエラー表示は `vscode.window.showErrorMessage()` を使う。
- 秘密情報（PAT）はログに出力しない。

```ts
try {
  channel.appendLine(`Starting PAT verification for organization: ${org}`);
  // ...
} catch (err) {
  channel.appendLine(`Error: ${err}`);
  await vscode.window.showErrorMessage("...");
}
```

## キャッシング

- 非同期データは Promise を変数に保持して重複リクエストを防ぐ。
- キャッシュキーの命名：`{entity}:{org}:{id}` の形式。

```ts
if (this.fetchPromises[key]) {
  return this.fetchPromises[key];
}
const p = (async () => {
  try {
    // ...
  } finally {
    delete this.fetchPromises[key];
  }
})();
this.fetchPromises[key] = p;
return p;
```

## 認証・Secret Storage

- PAT は必ず `context.secrets.store()` / `context.secrets.get()` で管理する。
- キー形式：`ado-ext.pat.{org}`

## VS Code TreeItem

- `AdoTreeItem` は `vscode.TreeItem` を継承するため、`label`・`collapsibleState`・`iconPath`・`contextValue`・`command` 等を再宣言しない。
- `itemType` プロパティで種別を識別する（`AdoItemType` リテラル型）。

## ファクトリ関数

クラスのインスタンス生成はファクトリ関数で包んで公開する。

```ts
export function createTreeProvider(context?: vscode.ExtensionContext, channel?: vscode.LogOutputChannel): AdoTreeProvider {
  return new AdoTreeProvider(context, channel);
}
```

## 型安全

- 配列は `Array.isArray()` でチェックしてから反復する。
- 外部 API の戻り値は `any` で受け取り、必要な型にキャストする際に値の存在を確認する。
