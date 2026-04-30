import * as vscode from "vscode";
import { AdoTreeItem, AdoProject, AdoItemType } from "./types";
import { httpRequest } from "./api";

export function createTreeProvider(context?: vscode.ExtensionContext): AdoTreeProvider {
  /**
   * AdoTreeProvider のファクトリ。
   * @param context 拡張の `ExtensionContext`（省略可）
   * @returns `AdoTreeProvider` インスタンス
   */
  return new AdoTreeProvider(context);
}

/**
 * ADO 用の TreeDataProvider 実装。
 * - このクラスは `vscode.TreeDataProvider<AdoTreeItem>` を実装します。
 * - 以下のメンバは TreeDataProvider インターフェースで必須/推奨されるものです（明示的にマークしています）。
 * @implements {vscode.TreeDataProvider<AdoTreeItem>}
 */
export class AdoTreeProvider implements vscode.TreeDataProvider<AdoTreeItem> {
  /**
   * TreeDataProvider 必須: ツリー変更用イベントエミッタ。
   */
  private _onDidChangeTreeData: vscode.EventEmitter<AdoTreeItem | undefined | null | void> = new vscode.EventEmitter();

  /**
   * TreeDataProvider 必須メンバ: `onDidChangeTreeData`。
   */
  readonly onDidChangeTreeData: vscode.Event<AdoTreeItem | undefined | null | void> = this._onDidChangeTreeData.event;

  /**
   * 拡張の `ExtensionContext`（VS Code 提供）。重要度高：workspaceState / secrets 関連で使用。
   */
  private context: vscode.ExtensionContext | undefined;

  /**
   * 重要: ツリーのルートに表示する組織名の配列（workspaceState に永続化）。
   */
  private organizations: string[] = [];

  /**
   * 重要: 組織ごとのプロジェクト配列（メモリ内キャッシュ。永続化しない）。
   */
  private projectsByOrg: { [org: string]: AdoProject[] } = {};

  /**
   * in-flight promise マップ：同一組織への重複リクエストを合流させる（重複防止）。
   */
  private projectsFetchPromises: { [org: string]: Promise<AdoProject[]> } = {};

  /**
   * 組織ごとのエラーメッセージを保持（workspaceState に保存）。
   */
  private errorsByOrg: { [org: string]: string } = {};

  /**
   * 読み込み中の組織名（UI 表示補助）。
   */
  private loadingOrg?: string;

  /**
   * 読み込み表示用フラグ（ノード単位）。キーは `AdoTreeItem.id`。
   */
  private loadingNodes: { [id: string]: boolean } = {};

  /**
   * 読み込みタイマー（視覚フィードバック管理）。
   */
  private loadingTimers: { [id: string]: NodeJS.Timeout } = {};

  /**
   * 読み込み開始時に一時保存するアイコン。
   */
  private loadingIconBackup: { [id: string]: vscode.ThemeIcon | any } = {};

  /**
   * 読み込み時に変更した collapsibleState を復元するためのバックアップ。
   */
  private loadingCollapsibleBackup: { [id: string]: vscode.TreeItemCollapsibleState } = {};

  /**
   * コンストラクタ。
   * @param context 拡張の `ExtensionContext`（省略可）
   */
  constructor(context?: vscode.ExtensionContext) {
    this.context = context;
    if (this.context) {
      const orgs = this.context.workspaceState.get<string[]>("azuredevops.organizations");
      if (orgs) this.organizations = orgs;
      const errs = this.context.workspaceState.get<{ [org: string]: string }>("azuredevops.errorsByOrg");
      if (errs) this.errorsByOrg = errs;
    }
  }

  // -----------------------
  // TreeDataProvider 必須実装（公開 API）
  // -----------------------
  /**
   * TreeItem 表現を返す。TreeDataProvider 必須メソッド。
   */
  getTreeItem(element: AdoTreeItem): vscode.TreeItem {
    return element;
  }

  /**
   * 指定要素の子要素を返す（ルート時に組織リストを返す）。TreeDataProvider 必須メソッド。
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

  // -----------------------
  // 公開ヘルパー（拡張コマンドなどから利用される API）
  // -----------------------
  /**
   * ツリー全体を更新するヘルパー。
   */
  refresh(): void {
    this._onDidChangeTreeData.fire();
  }

  /**
   * 指定ノード（または全体）をリフレッシュする公開 API。
   * @param element 更新対象のノード（未指定で全体）
   */
  async refreshNode(element?: AdoTreeItem): Promise<void> {
    if (!element) {
      this.refresh();
      return;
    }
    try {
      const t: AdoItemType | undefined = element.itemType;
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
        const t2: AdoItemType | undefined = element.itemType;
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

  // -----------------------
  // コマンド実装（組織管理）
  // -----------------------
  /**
   * 組織を追加します（重複無視）。workspaceState に永続化。
   */
  addOrganization(org: string) {
    if (!org) return;
    if (!this.organizations.includes(org)) {
      this.organizations.push(org);
      if (this.context) this.context.workspaceState.update("azuredevops.organizations", this.organizations);
      this.refresh();
    }
  }

  /**
   * 組織を削除します。workspaceState を更新し、関連データを消去。
   */
  removeOrganization(org: string) {
    if (!org) return;
    this.organizations = this.organizations.filter(o => o !== org);
    if (this.context) this.context.workspaceState.update("azuredevops.organizations", this.organizations);
    delete this.projectsByOrg[org];
    this.refresh();
  }

  /**
   * すべての組織情報と関連データをクリアします。
   */
  clearOrganizations(): void {
    this.organizations = [];
    if (this.context) this.context.workspaceState.update("azuredevops.organizations", this.organizations);
    this.projectsByOrg = {};
    this.projectsFetchPromises = {};
    this.refresh();
  }

  // -----------------------
  // 内部ヘルパー（ネットワーク / 認証）
  // -----------------------
  /**
   * 組織のプロジェクトを取得します（in-flight dedupe 適用）。
   */
  async fetchProjects(organization: string, pat?: string): Promise<AdoProject[]> {
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

  /**
   * ユーザーに PAT 入力を促し、入力があれば secrets に保存します（内部ヘルパー）。
   */
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

  /**
   * 指定した組織に対応する secrets のキーを返します（内部ヘルパー）。
   */
  private patKeyForOrg(org: string) {
    return `ado-assist.pat.${org}`;
  }
}
