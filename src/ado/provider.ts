import * as vscode from "vscode";
import { AdoTreeItem, AdoProject } from "./types";
import { httpRequest } from "./api";

export class AdoTreeProvider implements vscode.TreeDataProvider<AdoTreeItem> {
  // --- TreeDataProvider イベントと API（実装） ---
  /**
   * ツリー変更用のイベントエミッタ。TreeDataProvider の契約の一部です。
   * VS Code は `onDidChangeTreeData` を監視してビューを更新します。
   */
  private _onDidChangeTreeData: vscode.EventEmitter<AdoTreeItem | undefined | null | void> = new vscode.EventEmitter();
  /**
   * VS Code API が要求する TreeDataProvider のイベント。
   * インターフェースを満たすために公開の読み取り専用プロパティとして実装しています。
   */
  readonly onDidChangeTreeData: vscode.Event<AdoTreeItem | undefined | null | void> = this._onDidChangeTreeData.event;
  private projectsByOrg: { [org: string]: AdoProject[] } = {};
  private loadingNodes: { [id: string]: boolean } = {};
  private context: vscode.ExtensionContext | undefined;
  private loadingOrg?: string;
  private errorsByOrg: { [org: string]: string } = {};
  private projectsFetchPromises: { [org: string]: Promise<AdoProject[]> } = {};
  private loadingTimers: { [id: string]: NodeJS.Timeout } = {};
  private loadingIconBackup: { [id: string]: vscode.ThemeIcon | any } = {};
  private loadingCollapsibleBackup: { [id: string]: vscode.TreeItemCollapsibleState } = {};

  constructor(context?: vscode.ExtensionContext) {
    this.context = context;
    if (this.context) {
      const orgs = this.context.workspaceState.get<string[]>("azuredevops.organizations");
      if (orgs) this.organizations = orgs;
      const errs = this.context.workspaceState.get<{ [org: string]: string }>("azuredevops.errorsByOrg");
      if (errs) this.errorsByOrg = errs;
    }
  }

  private patKeyForOrg(org: string) {
    return `ado-assist.pat.${org}`;
  }

  private async promptAndStorePat(org: string): Promise<string | undefined> {
    const pat = await vscode.window.showInputBox({ prompt: `Personal Access Token (PAT) for organization ${org}`, password: true });
    if (!pat || !this.context) return undefined;
    try {
      await this.context.secrets.store(this.patKeyForOrg(org), pat);
      vscode.window.showInformationMessage(`PAT saved for ${org}`);
      return pat;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      vscode.window.showErrorMessage(`Failed to save PAT for ${org}: ${msg}`);
      return undefined;
    }
  }

  private organizations: string[] = [];

  // --- TreeDataProvider のメソッド（VS Code が要求） ---
  /**
   * 要素の TreeItem 表現を返します。（TreeDataProvider）
   */
  getTreeItem(element: AdoTreeItem): vscode.TreeItem {
    return element;
  }

  /**
   * 指定された要素の子要素を返します。要素が未指定の場合はルートの子を返します。
   * （TreeDataProvider）
   */
  async getChildren(element?: AdoTreeItem): Promise<AdoTreeItem[]> {
    if (!element) {
      const actions: AdoTreeItem[] = [];
      const orgItems: AdoTreeItem[] = [];
      for (const o of this.organizations) {
        const it = new AdoTreeItem(o, vscode.TreeItemCollapsibleState.Collapsed);
        it.itemType = "organization";
        it.organization = o;
        it.id = `org:${o}`;
        it.contextValue = "organization";
        it.iconPath = new vscode.ThemeIcon("organization");
        it.url = `https://dev.azure.com/${encodeURIComponent(o)}`;
        it.tooltip = it.url;
        orgItems.push(it);
      }
      if (orgItems.length === 0) return actions.concat([new AdoTreeItem("(no organizations)")]);
      return actions.concat(orgItems);
    }
    return [];
  }

  refresh(): void {
    // 公開ヘルパー: ツリー全体を更新する
    this._onDidChangeTreeData.fire();
  }

  // --- 公開コマンド / ヘルパー（TreeDataProvider インターフェース外） ---
  /**
   * 特定ノード（または element 未指定でツリー全体）を更新します。
   * 登録されたコマンドから呼ばれる公開ヘルパーです。
   */
  async refreshNode(element?: AdoTreeItem): Promise<void> {
    if (!element) {
      this.refresh();
      return;
    }
    try {
      const t = element.itemType;
      if (element.id) {
        this.loadingNodes[element.id] = true;
        try {
          if (this.loadingTimers[element.id]) clearTimeout(this.loadingTimers[element.id]);
        } catch (e) {}
        this.loadingTimers[element.id] = setTimeout(() => {
          try {
            if (this.loadingNodes[element.id]) {
              try {
                if (this.loadingIconBackup[element.id] !== undefined) {
                  element.iconPath = this.loadingIconBackup[element.id];
                  delete this.loadingIconBackup[element.id];
                }
              } catch (e) {}
              delete this.loadingNodes[element.id];
              delete this.loadingTimers[element.id];
              this._onDidChangeTreeData.fire(element);
            }
          } catch (e) {}
        }, 10000);
        try {
          if (!this.loadingCollapsibleBackup[element.id]) {
            this.loadingCollapsibleBackup[element.id] = element.collapsibleState;
          }
          element.collapsibleState = vscode.TreeItemCollapsibleState.None;
        } catch (e) {}
        try {
          if (!this.loadingIconBackup[element.id]) {
            this.loadingIconBackup[element.id] = element.iconPath;
            element.iconPath = new vscode.ThemeIcon("sync~spin");
          }
        } catch (e) {}
        const t2 = element.itemType;
        if (t2 === "organization" && element.organization) {
          delete this.projectsByOrg[element.organization];
        }
        this._onDidChangeTreeData.fire(element);
      }
      if (t === "organization") {
        const org = element.organization as string | undefined;
        if (!org) {
          this.refresh();
          return;
        }
        delete this.projectsByOrg[org];
        this._onDidChangeTreeData.fire(element);
        try {
          await this.fetchProjects(org);
        } catch (e) {}
        if (element.id) {
          try {
            if (this.loadingTimers[element.id]) clearTimeout(this.loadingTimers[element.id]);
          } catch (e) {}
          delete this.loadingTimers[element.id];
          try {
            if (this.loadingIconBackup[element.id] !== undefined) {
              element.iconPath = this.loadingIconBackup[element.id];
              delete this.loadingIconBackup[element.id];
            }
          } catch (e) {}
          try {
            if (this.loadingCollapsibleBackup[element.id] !== undefined) {
              element.collapsibleState = this.loadingCollapsibleBackup[element.id];
              delete this.loadingCollapsibleBackup[element.id];
            }
          } catch (e) {}
          delete this.loadingNodes[element.id];
          this._onDidChangeTreeData.fire(element);
        }
        return;
      }
      return;
    } catch (err) {
      if (element?.id) {
        try {
          if (this.loadingTimers[element.id]) clearTimeout(this.loadingTimers[element.id]);
        } catch (e) {}
        delete this.loadingTimers[element.id];
        try {
          if (this.loadingIconBackup[element.id] !== undefined) {
            element.iconPath = this.loadingIconBackup[element.id];
            delete this.loadingIconBackup[element.id];
          }
        } catch (e) {}
        delete this.loadingNodes[element.id];
      }
      this.refresh();
    }
  }

  // --- 内部ヘルパー（TreeDataProvider の一部ではない） ---
  /**
   * 組織のプロジェクトを取得します。重複リクエストは in-flight promise によって合流されます。
   */
  async fetchProjects(organization: string, pat?: string): Promise<AdoProject[]> {
    // キャッシュロジックは削除済み：常に最新を取得します（同時実行合流は維持）

    if (this.projectsFetchPromises[organization]) return this.projectsFetchPromises[organization];
    const p = (async () => {
      this.loadingOrg = organization;
      delete this.errorsByOrg[organization];
      if (this.context) this.context.workspaceState.update("azuredevops.errorsByOrg", this.errorsByOrg);
      this.refresh();
      try {
        const key = this.patKeyForOrg(organization);
        let usePat = pat;
        if (!usePat && this.context) {
          usePat = (await this.context.secrets.get(key)) || undefined;
        }
        const url = `https://dev.azure.com/${encodeURIComponent(organization)}/_apis/projects?api-version=6.0`;
        let data: any;
        if (usePat) {
          try {
            data = await httpRequest("GET", url, usePat);
          } catch (err) {
            const entered = await this.promptAndStorePat(organization);
            if (!entered) throw new Error("PAT not provided");
            usePat = entered;
            data = await httpRequest("GET", url, usePat);
          }
        } else {
          while (true) {
            const entered = await this.promptAndStorePat(organization);
            if (!entered) throw new Error("PAT not provided");
            try {
              data = await httpRequest("GET", url, entered);
              usePat = entered;
              break;
            } catch (err) {
              const retry = await vscode.window.showQuickPick(["Retry", "Cancel"], { placeHolder: "Failed to authenticate with provided PAT. Retry?" });
              if (retry !== "Retry") throw new Error("Authentication failed");
            }
          }
        }

        if (usePat && this.context) {
          try {
            await this.context.secrets.store(key, usePat);
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            this.errorsByOrg[organization] = `Failed to save PAT: ${msg}`;
            if (this.context) this.context.workspaceState.update("azuredevops.errorsByOrg", this.errorsByOrg);
            throw new Error(`Failed to save PAT for ${organization}: ${msg}`);
          }
        }

        // organization metadata not required for minimal provider; ignore

        const projects: AdoProject[] = [];
        if (data && Array.isArray(data.value)) {
          for (const p of data.value) {
            const projectName = String(p.name);
            const apiUrl = p._links?.web?.href;
            const canonical = `https://dev.azure.com/${encodeURIComponent(organization)}/${encodeURIComponent(projectName)}`;
            const desc = p.description || p.properties?.description || "";
            projects.push({ id: String(p.id), name: projectName, url: String(apiUrl || canonical), description: String(desc) });
          }
        }

        this.projectsByOrg[organization] = projects;
        delete this.errorsByOrg[organization];
        if (this.context) this.context.workspaceState.update("azuredevops.errorsByOrg", this.errorsByOrg);
        return projects;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        this.errorsByOrg[organization] = msg;
        if (this.context) this.context.workspaceState.update("azuredevops.errorsByOrg", this.errorsByOrg);
        return [];
      } finally {
        this.loadingOrg = undefined;
        this.refresh();
      }
    })();
    this.projectsFetchPromises[organization] = p;
    try {
      const res = await p;
      return res;
    } finally {
      delete this.projectsFetchPromises[organization];
    }
  }

  addOrganization(org: string) {
    if (!org) return;
    if (!this.organizations.includes(org)) {
      this.organizations.push(org);
      if (this.context) this.context.workspaceState.update("azuredevops.organizations", this.organizations);
      this.refresh();
    }
  }

  removeOrganization(org: string) {
    if (!org) return;
    this.organizations = this.organizations.filter(o => o !== org);
    if (this.context) this.context.workspaceState.update("azuredevops.organizations", this.organizations);
    delete this.projectsByOrg[org];
    this.refresh();
  }

  clearOrganizations(): void {
    // remove all organizations and cached data
    this.organizations = [];
    if (this.context) this.context.workspaceState.update("azuredevops.organizations", this.organizations);
    this.projectsByOrg = {};
    this.projectsFetchPromises = {};
    this.refresh();
  }
}

export function createTreeProvider(context?: vscode.ExtensionContext): AdoTreeProvider {
  return new AdoTreeProvider(context);
}
