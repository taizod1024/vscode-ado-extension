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
export type AdoItemType = "organization" | "project" | "boardsFolder" | "boardsCategory" | "boardsFilter" | "boardsIteration" | "branchesFolder" | "pullRequestsFolder" | "pullRequestsFilter" | "workItem" | "reposFolder" | "repository" | "branch" | "pullRequest" | "pipelinesFolder" | "pipelinesFilter" | "pipeline" | "pipelineRun" | "placeholder" | "error";

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
   * フィルタボタンノードが参照する親フォルダノード（boardsFilter / pullRequestsFilter 専用）。
   */
  folderRef?: AdoTreeItem;
  /**
   * イテレーションパス（boardsIteration ノード専用）。
   */
  iterationPath?: string;
  /**
   * ブランチ名（branch ノード専用）。
   */
  branchName?: string;
  /**
   * リポジトリのデフォルトブランチ名（repository / branchesFolder / branch ノード専用）。
   */
  defaultBranch?: string;
  /**
   * Work Item の ID（workItem ノード専用、子アイテム探索に使用）。
   */
  workItemId?: number;
  /**
   * パイプライン ID（pipeline ノード専用）。
   */
  pipelineId?: number;
  /**
   * イテレーションキャッシュキー（workItem ノード専用、子 Work Item 探索に使用）。
   */
  iterationCacheKey?: string;

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
  /** 表示用の担当者（短縮済み） */
  assignee?: string;
  /** 説明のプレーンテキスト（短縮済み） */
  description?: string;
  /** イテレーションパス（例: "MyProject\\Sprint 1"） */
  iterationPath?: string;
  /** 親 Work Item の ID */
  parentId?: number;
}

/** ADO イテレーション（スプリント）の簡易表現 */
export interface AdoIteration {
  /** イテレーションの一意 ID */
  id: string;
  /** 表示名（例: "Sprint 1"） */
  name: string;
  /** フルパス（例: "MyProject\\Sprint 1"） */
  path: string;
  /** 開始日（ISO8601 文字列） */
  startDate?: string;
  /** 終了日（ISO8601 文字列） */
  finishDate?: string;
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
  createdBy?: any;
  webUrl?: string;
}

/** パイプライン（定義）の簡易表現 */
export interface AdoPipeline {
  /** パイプライン ID */
  id: number;
  /** パイプライン名 */
  name: string;
  /** Web URL */
  url?: string;
}

/** パイプラインの実行結果の簡易表現 */
export interface AdoPipelineRun {
  /** ラン ID */
  id: number;
  /** パイプライン ID */
  pipelineId?: number;
  /** ラン名（例: "20240101.1"） */
  name: string;
  /** 実行状態: "inProgress" | "completed" | "canceling" | "unknown" */
  state?: string;
  /** 実行結果: "succeeded" | "failed" | "canceled" | "partiallySucceeded" | "none" */
  result?: string;
  /** Web URL */
  url?: string;
  /** 実行開始日時（ISO 8601） */
  createdDate?: string;
  /** 実行完了日時（ISO 8601） */
  finishedDate?: string;
  /** ソースブランチ（例: refs/heads/main, refs/pull/4/merge） */
  sourceBranch?: string;
}
