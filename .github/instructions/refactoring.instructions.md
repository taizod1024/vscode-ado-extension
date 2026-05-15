---
description: "Use when refactoring TypeScript source files: removing dead code, deduplicating logic, fixing inconsistencies, and renaming symbols to match their role."
applyTo: "src/**/*.ts"
---

> リファクタ後は `APP_SPEC.md` への影響がないか確認すること（詳細は `app-spec-sync.instructions.md` 参照）。

# リファクタリング規約

## 1. 不要コード・変数の削除

- 参照されていない変数・関数・インポートは削除する。
- コメントアウトされたコードは削除する（バージョン管理は Git に任せる）。
- 条件分岐で到達不能なブランチは削除する。
- 使用されていない `catch` バインディングは `catch` のみ（変数なし）に変更する。

```ts
// NG
const unused = "never used";

// OK: 不要変数を削除
```

## 2. 重複コードの共通化

- 同じロジックが 2 箇所以上に現れる場合は共通関数・ヘルパーに抽出する。
- ただし、1 回しか使わない処理をわざわざ関数化しない（過剰抽象化を避ける）。
- 既存の共通ヘルパー（例：`extractContext()`、`handlePatValidationAndSave()`）を活用し、重複実装しない。

```ts
// NG: 同じ URL 構築ロジックが複数箇所に散在
const url1 = `https://dev.azure.com/${org}/${proj}/_git/${repo}/xxx`;
const url2 = `https://dev.azure.com/${org}/${proj}/_git/${repo}/yyy`;

// OK: 共通部分を変数化
const baseUrl = `https://dev.azure.com/${encodeURIComponent(org)}/${encodeURIComponent(proj)}/_git/${encodeURIComponent(repo)}`;
const url1 = `${baseUrl}/xxx`;
const url2 = `${baseUrl}/yyy`;
```

## 3. 一貫性のないコードの修正

- 同種の処理は同じパターンで書く。
  - エラーログ：`channel.appendLine(\`Error: ${msg}\`)` に統一
  - エラー変数名：`err` → `const msg = err instanceof Error ? err.message : String(err)` に統一
  - URL エンコード：`encodeURIComponent()` を必ず使う
- `async/await` と `.then()` を混在させない。`async/await` に統一する。
- オブジェクトアクセスのオプショナルチェイン（`?.`）を一貫して使う。

```ts
// NG: エラーハンドリングが不統一
} catch (e) { console.error(e); }
} catch (err) { vscode.window.showErrorMessage(err); }

// OK: 統一パターン
} catch (err) {
  const msg = err instanceof Error ? err.message : String(err);
  channel.appendLine(`Error: ${msg}`);
  vscode.window.showErrorMessage("...: " + msg);
}
```

## 4. 関数名・変数名のリネーム

- 名前は**役割・意図**を表す。省略しすぎない。
- ブール値には `is` / `has` / `can` プレフィックスを付ける。
- イベントハンドラには `handle` / `on` プレフィックスを付ける。
- 一時変数 `tmp`、`data`、`result` など意味の薄い名前は避ける。

| 悪い例 | 良い例 | 理由 |
| --- | --- | --- |
| `p` | `projectList` | 何のプロミスか不明 |
| `it` | `orgItem` / `projectItem` | ノード種別が不明 |
| `pick` | `selectedOrg` | 何を選択したか不明 |
| `data` | `apiResponse` | 何のデータか不明 |
| `flag` | `isPatValid` | 真偽値の意味が不明 |

## チェックリスト

リファクタ完了前に以下を確認する。

- [ ] `npx tsc --noEmit` でコンパイルエラーがないか
- [ ] コマンド ID・contextValue など公開 API の名前を変えていないか
- [ ] `APP_SPEC.md` に影響する変更（コマンド・エラーメッセージ等）がないか
