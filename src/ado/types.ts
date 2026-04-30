import * as vscode from "vscode";

export class AdoTreeItem extends vscode.TreeItem {
  id?: string;
  itemType?: string;
  organization?: string;
  projectId?: string;
  repoId?: string;
  repoName?: string;
  url?: string;

  constructor(label: string, collapsibleState: vscode.TreeItemCollapsibleState = vscode.TreeItemCollapsibleState.None) {
    super(label, collapsibleState);
  }
}

export interface AdoProject {
  id: string;
  name: string;
  url: string;
  description?: string;
}
