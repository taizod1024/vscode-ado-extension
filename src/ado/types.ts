import * as vscode from "vscode";

/**
 * ADO ツリーで使うカスタム TreeItem。
 * 各フィールドはツリーのノード種別に応じて設定されます。
 */
export class AdoTreeItem extends vscode.TreeItem {
  /** 要素の一意 ID（例: `org:myorg`） */
  id?: string;
  /** 要素の種別（例: 'organization' / 'project'） */
  itemType?: string;
  /** 組織名（organization ノード時に設定） */
  organization?: string;
  /** プロジェクト ID（project ノード時に設定） */
  projectId?: string;
  /** リポジトリ ID（必要なら設定） */
  repoId?: string;
  /** リポジトリ名（必要なら設定） */
  repoName?: string;
  /** Web への URL（クリック時に開く等） */
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
