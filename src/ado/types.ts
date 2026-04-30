import * as vscode from "vscode";

/**
 * 注意: `AdoTreeItem` は `vscode.TreeItem` を継承しています。
 * 継承される主なプロパティ（例）：
 * - `label`: 表示ラベル (string | TreeItemLabel)
 * - `collapsibleState`: 折りたたみ状態 (TreeItemCollapsibleState)
 * - `iconPath`: アイコン (ThemeIcon | Uri | { light, dark })
 * - `tooltip`: ツールチップ (string)
 * - `contextValue`: コンテキスト値（コンテキストメニュー）(string)
 * - `command`: クリック時のコマンド (Command)
 * - `resourceUri`: リソース URI (Uri)
 * - `description`: 追加の説明 (string)
 * これらは `AdoTreeItem` 側で再宣言する必要はありません。固有プロパティのみ本クラスで定義します。
 */

/**
 * Ado のツリー要素で許容される種別のリテラル型。
 * 必要に応じて値を追加してください。
 */
export type AdoItemType = "organization" | "project" | "workItemsFolder" | "branchesFolder" | "pullRequestsFolder" | "workItem" | "repositoriesFolder" | "repository" | "branch" | "pullRequest" | "placeholder";

/**
 * ADO ツリーで使うカスタム TreeItem。
 * 各フィールドはツリーのノード種別に応じて設定されます。
 */
export class AdoTreeItem extends vscode.TreeItem {
  /**
   * 要素の一意 ID（例: `org:myorg`）。全ノード共通プロパティ。
   */
  id?: string;
  /**
   * 要素の種別（リテラル型で制約）。全ノード共通プロパティ。
   */
  itemType?: AdoItemType;
  /**
   * 組織固有プロパティ：組織ノード時に設定されます（`organization`）。
   */
  organization?: string;
  /**
   * プロジェクト固有プロパティ：プロジェクトノード時に設定されるプロジェクト ID（`projectId`）。
   */
  projectId?: string;
  /**
   * リポジトリ固有プロパティ：リポジトリノードで使用する ID（`repoId`）。
   */
  repoId?: string;
  /**
   * リポジトリ固有プロパティ：表示用のリポジトリ名（`repoName`）。
   */
  repoName?: string;
  /**
   * Web への URL（任意）。ノード種別に依らずクリックで開けるリンクを保持できます。
   */
  url?: string;

  /**
   * AdoTreeItem のコンストラクタ。
   * @param label ツリーに表示するラベル
   * @param collapsibleState 折りたたみ状態（デフォルトは None）
   */
  constructor(label: string, collapsibleState: vscode.TreeItemCollapsibleState = vscode.TreeItemCollapsibleState.None) {
    super(label, collapsibleState);
  }
}

/**
 * ADO のプロジェクト情報を表す型。
 */
export interface AdoProject {
  /** プロジェクトの一意 ID */
  id: string;
  /** プロジェクト名 */
  name: string;
  /** プロジェクトの Web URL */
  url: string;
  /** 任意の説明 */
  description?: string;
}

/** Git リポジトリ情報 */
export interface AdoRepository {
  id: string;
  name: string;
  url: string;
  defaultBranch?: string;
}

/** Work item の簡易表現 */
export interface AdoWorkItem {
  id: number;
  title: string;
  url?: string;
  /** 状態ラベル（例: "New", "Active", "Closed"） */
  status?: string;
}

/** ブランチ情報の簡易表現 */
export interface AdoBranch {
  name: string; // ブランチ名（例: refs/heads/main または main）
}

/** プルリクエストの簡易表現 */
export interface AdoPullRequest {
  pullRequestId: number;
  title: string;
  url?: string;
  status?: string;
}
