---
description: "Use when modifying TypeScript source files or APP_SPEC.md. Ensures code and design document stay in sync: update APP_SPEC.md when changing code behavior, and update code when changing APP_SPEC.md."
applyTo: ["src/**/*.ts", ".github/APP_SPEC.md"]
---

# コードと設計書の双方向同期ルール

`.github/APP_SPEC.md` はこの拡張の唯一の設計書である。コードと設計書は常に一致させる。

## TypeScript ファイルを変更した場合

以下に該当する変更を行ったら、`APP_SPEC.md` の対応箇所を必ず更新する。

| 変更内容                                            | APP_SPEC.md の更新対象                                   |
| --------------------------------------------------- | -------------------------------------------------------- |
| コマンド追加・削除・ID 変更                         | 「主な機能」セクションの該当コマンド定義                 |
| コマンドの動作変更（入力・バリデーション・副作用）  | 該当コマンドの説明・箇条書き                             |
| 新しい TreeItem 種別追加                            | 「UI レイアウト」→「ツリーアイテムの種類と表現」テーブル |
| UI 階層構造の変更（サイドパネルのツリー構造）       | 「UI レイアウト」→「サイドパネル」のアスキーアート       |
| エラーメッセージ文言変更・追加                      | 「エラーハンドリング」→「統一されたエラーメッセージ」    |
| キャッシュキーの追加・変更                          | 「キャッシング戦略」セクション                           |
| 設定項目（`contributes.configuration`）の追加・変更 | 「設定項目」テーブル                                     |
| PAT スコープ変更                                    | 「認証・セキュリティ」→「必要な PAT スコープ」テーブル   |

## APP_SPEC.md を変更した場合

以下に該当する変更を行ったら、対応するコードを必ず更新する。

| 変更内容                             | コードの更新対象                                                                |
| ------------------------------------ | ------------------------------------------------------------------------------- |
| コマンド追加（新しい `ado-ext.xxx`） | `package.json` の `contributes.commands`、`extension.ts` のコマンドハンドラ登録 |
| コマンド削除                         | 上記の逆。`package.json` とハンドラを削除                                       |
| コマンドの動作仕様変更               | 該当コマンドの実装（`extension.ts` 内のハンドラ）                               |
| TreeItem 種別追加                    | `types.ts` の `AdoItemType`、`provider.ts` のノード生成ロジック                 |
| エラーメッセージ変更                 | `adoApiClient.ts` または `extension.ts` の `ERROR_MESSAGES` 定数                |
| 設定項目追加                         | `package.json` の `contributes.configuration`、設定を参照するコード             |
| キャッシング戦略変更                 | `provider.ts` のキャッシュロジック                                              |

## チェックリスト

変更を完了する前に以下を確認する。

- [ ] `APP_SPEC.md` の変更内容はコードの実際の動作と一致しているか
- [ ] コードの変更内容は `APP_SPEC.md` に反映されているか
- [ ] `README.md` にも影響する公開 API 変更（コマンド・設定）の場合、`README.md` も更新したか
