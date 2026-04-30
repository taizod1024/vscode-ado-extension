import * as vscode from "vscode";
import { AdoTreeItem, AdoProject, AdoItemType, AdoRepository, AdoWorkItem, AdoBranch, AdoPullRequest } from "./types";
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
   * 汎用キャッシュ: key ベースで任意の子配列を保持する。
   */
  private childrenCache: { [key: string]: any[] } = {};

  /**
   * 汎用 in-flight promise マップ（重複リクエスト合流用）。
   */
  private childrenFetchPromises: { [key: string]: Promise<any[]> } = {};

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
    const t = element.itemType;

    // organization の子: projects（汎用 lazy loader を利用）
    if (t === "organization" && element.organization) {
      const org = element.organization as string;
      const key = `projects:${org}`;
      return this.lazyLoadChildren<AdoProject>(
        key,
        element,
        async () => await this.fetchProjects(org),
        projects =>
          projects.map(p => {
            const it = new AdoTreeItem(p.name, vscode.TreeItemCollapsibleState.Collapsed);
            it.itemType = "project";
            it.organization = org;
            it.projectId = p.id;
            it.id = `proj:${org}:${p.id}`;
            it.contextValue = "project";
            it.iconPath = new vscode.ThemeIcon("repo");
            it.url = p.url;
            it.tooltip = p.description || p.url;
            return it;
          }),
        "Loading projects...",
      );
    }

    // project の子: work items / repositories のフォルダを返す
    if (t === "project") {
      const org = element.organization as string | undefined;
      const projectId = element.projectId;
      const workFolder = new AdoTreeItem("Work items", vscode.TreeItemCollapsibleState.Collapsed);
      workFolder.itemType = "workItemsFolder";
      workFolder.organization = org;
      workFolder.projectId = projectId;
      workFolder.id = `workitems:${org}:${projectId}`;
      workFolder.contextValue = "workItemsFolder";
      workFolder.iconPath = new vscode.ThemeIcon("list-unordered");

      const repoFolder = new AdoTreeItem("Repositories", vscode.TreeItemCollapsibleState.Collapsed);
      repoFolder.itemType = "repositoriesFolder";
      repoFolder.organization = org;
      repoFolder.projectId = projectId;
      repoFolder.id = `repos:${org}:${projectId}`;
      repoFolder.contextValue = "repositoriesFolder";
      repoFolder.iconPath = new vscode.ThemeIcon("repo");

      return [workFolder, repoFolder];
    }

    // workItemsFolder の子: recent work items
    if (t === "workItemsFolder" && element.organization && element.projectId) {
      const org = element.organization as string;
      const pid = element.projectId as string;
      const key = `workitems:${org}:${pid}`;
      return this.lazyLoadChildren<AdoWorkItem>(
        key,
        element,
        async () => await this.fetchWorkItems(org, pid),
        items =>
          items.map(w => {
            const it = new AdoTreeItem(`#${w.id} ${w.title}`, vscode.TreeItemCollapsibleState.None);
            it.itemType = "workItem";
            it.organization = org;
            it.id = `work:${org}:${w.id}`;
            it.contextValue = "workItem";
            it.url = w.url;
            it.tooltip = w.url || w.title;
            return it;
          }),
        "Loading work items...",
      );
    }

    // repositoriesFolder の子: repositories
    if (t === "repositoriesFolder" && element.organization && element.projectId) {
      const org = element.organization as string;
      const pid = element.projectId as string;
      const key = `repos:${org}:${pid}`;
      return this.lazyLoadChildren<AdoRepository>(
        key,
        element,
        async () => await this.fetchRepositories(org, pid),
        repos =>
          repos.map(r => {
            const it = new AdoTreeItem(r.name, vscode.TreeItemCollapsibleState.Collapsed);
            it.itemType = "repository";
            it.organization = org;
            it.id = `repo:${org}:${r.id}`;
            it.contextValue = "repository";
            it.iconPath = new vscode.ThemeIcon("repo");
            it.url = r.url;
            it.tooltip = r.url;
            return it;
          }),
        "Loading repositories...",
      );
    }

    // repository の子: Branches / Pull Requests フォルダ
    if (t === "repository" && element.organization) {
      const org = element.organization as string;
      // repo id は element.id の一部ではあるが、リポジトリIDを識別子として利用
      const repoIdMatch = String(element.id || "").split(":");
      const repoId = repoIdMatch.length >= 3 ? repoIdMatch[2] : undefined;
      const branchesFolder = new AdoTreeItem("Branches", vscode.TreeItemCollapsibleState.Collapsed);
      branchesFolder.itemType = "branchesFolder";
      branchesFolder.organization = org;
      branchesFolder.projectId = element.projectId;
      branchesFolder.id = `branches:${org}:${repoId}`;
      branchesFolder.contextValue = "branchesFolder";
      branchesFolder.iconPath = new vscode.ThemeIcon("git-branch");

      const prsFolder = new AdoTreeItem("Pull Requests", vscode.TreeItemCollapsibleState.Collapsed);
      prsFolder.itemType = "pullRequestsFolder";
      prsFolder.organization = org;
      prsFolder.projectId = element.projectId;
      prsFolder.id = `prs:${org}:${repoId}`;
      prsFolder.contextValue = "pullRequestsFolder";
      prsFolder.iconPath = new vscode.ThemeIcon("git-merge");

      return [branchesFolder, prsFolder];
    }

    // branchesFolder の子: ブランチ一覧
    if (t === "branchesFolder" && element.organization) {
      const org = element.organization as string;
      const parts = String(element.id).split(":");
      const repoId = parts.length >= 3 ? parts[2] : "";
      const key = `branches:${org}:${repoId}`;
      return this.lazyLoadChildren<AdoBranch>(
        key,
        element,
        async () => await this.fetchBranches(org, repoId),
        branches =>
          branches.map(b => {
            const name = String(b.name).replace(/^refs\/heads\//, "");
            const it = new AdoTreeItem(name, vscode.TreeItemCollapsibleState.None);
            it.itemType = "branch";
            it.organization = org;
            it.id = `branch:${org}:${repoId}:${name}`;
            it.contextValue = "branch";
            it.iconPath = new vscode.ThemeIcon("git-branch");
            return it;
          }),
        "Loading branches...",
      );
    }

    // pullRequestsFolder の子: PR 一覧
    if (t === "pullRequestsFolder" && element.organization) {
      const org = element.organization as string;
      const parts = String(element.id).split(":");
      const repoId = parts.length >= 3 ? parts[2] : "";
      const key = `prs:${org}:${repoId}`;
      return this.lazyLoadChildren<AdoPullRequest>(
        key,
        element,
        async () => await this.fetchPullRequests(org, repoId),
        prs =>
          prs.map(pr => {
            const label = `!${pr.pullRequestId} ${pr.title}`;
            const it = new AdoTreeItem(label, vscode.TreeItemCollapsibleState.None);
            it.itemType = "pullRequest";
            it.organization = org;
            it.id = `pr:${org}:${repoId}:${pr.pullRequestId}`;
            it.contextValue = "pullRequest";
            it.iconPath = new vscode.ThemeIcon("git-merge");
            it.url = pr.url;
            it.tooltip = pr.title;
            return it;
          }),
        "Loading pull requests...",
      );
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
   * 汎用遅延ローダー。
   * - キャッシュ確認、in-flight 合流、未ロード時は非同期 fetch を開始してプレースホルダを返す。
   */
  private lazyLoadChildren<T>(key: string, element: AdoTreeItem, fetchFn: () => Promise<T[]>, toItems: (arr: T[]) => AdoTreeItem[], placeholderLabel: string = "Loading..."): AdoTreeItem[] {
    const cached = this.childrenCache[key];
    if (cached && Array.isArray(cached)) {
      return toItems(cached as T[]);
    }

    if (this.childrenFetchPromises[key]) {
      const ph = new AdoTreeItem(placeholderLabel, vscode.TreeItemCollapsibleState.None);
      ph.iconPath = new vscode.ThemeIcon("sync~spin");
      return [ph];
    }

    // 開始してプレースホルダを返す
    this.childrenFetchPromises[key] = (async () => {
      try {
        const res = await fetchFn();
        this.childrenCache[key] = res || [];
        return res || [];
      } catch (err) {
        this.childrenCache[key] = [];
        return [];
      } finally {
        delete this.childrenFetchPromises[key];
        try {
          this._onDidChangeTreeData.fire(element);
        } catch (e) {}
      }
    })();

    const ph = new AdoTreeItem(placeholderLabel, vscode.TreeItemCollapsibleState.None);
    ph.iconPath = new vscode.ThemeIcon("sync~spin");
    return [ph];
  }

  /**
   * 指定プロジェクトのリポジトリ一覧を取得します。
   */
  private async fetchRepositories(organization: string, projectIdOrName: string, pat?: string): Promise<AdoRepository[]> {
    // 既存の fetchProjects と同様に PAT を解決して httpRequest を利用する
    const key = this.patKeyForOrg(organization);
    let usePat = pat;
    if (!usePat && this.context) usePat = (await this.context.secrets.get(key)) || undefined;
    const url = `https://dev.azure.com/${encodeURIComponent(organization)}/${encodeURIComponent(projectIdOrName)}/_apis/git/repositories?api-version=6.0`;
    let data: any;
    if (usePat) {
      data = await httpRequest("GET", url, usePat);
    } else {
      const entered = await this.promptAndStorePat(organization);
      if (!entered) return [];
      usePat = entered;
      data = await httpRequest("GET", url, usePat);
    }
    const repos: AdoRepository[] = [];
    if (data && Array.isArray(data.value)) {
      for (const r of data.value) {
        const name = String(r.name || r.repositoryName || "");
        const id = String(r.id || r.repositoryId || "");
        const web = r._links?.web?.href || r.remoteUrl || "";
        const defaultBranch = r.defaultBranch || undefined;
        repos.push({ id, name, url: String(web || ""), defaultBranch });
      }
    }
    return repos;
  }

  /**
   * 指定プロジェクトの Recent work items を取得します（簡易実装）。
   */
  private async fetchWorkItems(organization: string, projectIdOrName: string, pat?: string): Promise<AdoWorkItem[]> {
    const key = this.patKeyForOrg(organization);
    let usePat = pat;
    if (!usePat && this.context) usePat = (await this.context.secrets.get(key)) || undefined;
    // WIQL を使って recent work items を取得（最大 20 件）
    // projectIdOrName が ID の場合はプロジェクト名を解決して WHERE 句で絞る
    let projectName = projectIdOrName;
    if (!this.projectsByOrg[organization] || this.projectsByOrg[organization].length === 0) {
      try {
        await this.fetchProjects(organization);
      } catch (e) {}
    }
    const proj = (this.projectsByOrg[organization] || []).find(p => p.id === projectIdOrName || p.name === projectIdOrName);
    if (proj && proj.name) projectName = proj.name;
    const wiqlUrl = `https://dev.azure.com/${encodeURIComponent(organization)}/_apis/wit/wiql?api-version=6.0`;
    const safeName = String(projectName).replace(/'/g, "''");
    const query = { query: `Select [System.Id], [System.Title] From WorkItems Where [System.TeamProject] = '${safeName}' Order By [System.ChangedDate] Desc` };
    let wiqlResult: any;
    if (usePat) {
      wiqlResult = await httpRequest("POST", wiqlUrl, usePat, query);
    } else {
      const entered = await this.promptAndStorePat(organization);
      if (!entered) return [];
      usePat = entered;
      wiqlResult = await httpRequest("POST", wiqlUrl, usePat, query);
    }
    const ids = (wiqlResult?.workItems || [])
      .slice(0, 20)
      .map((w: any) => w.id)
      .filter(Boolean);
    if (ids.length === 0) return [];
    const idsStr = ids.join(",");
    const detailsUrl = `https://dev.azure.com/${encodeURIComponent(organization)}/_apis/wit/workitems?ids=${encodeURIComponent(idsStr)}&api-version=6.0`;
    const details = await httpRequest("GET", detailsUrl, usePat || "");
    const items: AdoWorkItem[] = [];
    if (details && Array.isArray(details.value)) {
      for (const d of details.value) {
        items.push({ id: Number(d.id), title: String(d.fields?.["System.Title"] || d.fields?.["Title"] || "(no title)"), url: d.url });
      }
    }
    return items;
  }

  /**
   * 指定リポジトリのブランチ一覧を取得します。
   */
  private async fetchBranches(organization: string, repoIdOrName: string, pat?: string): Promise<AdoBranch[]> {
    const key = this.patKeyForOrg(organization);
    let usePat = pat;
    if (!usePat && this.context) usePat = (await this.context.secrets.get(key)) || undefined;
    // refs API を使って heads を取得
    const url = `https://dev.azure.com/${encodeURIComponent(organization)}/_apis/git/repositories/${encodeURIComponent(repoIdOrName)}/refs?filter=heads&api-version=6.0`;
    let data: any;
    if (usePat) {
      data = await httpRequest("GET", url, usePat);
    } else {
      const entered = await this.promptAndStorePat(organization);
      if (!entered) return [];
      usePat = entered;
      data = await httpRequest("GET", url, usePat);
    }
    const out: AdoBranch[] = [];
    if (data && Array.isArray(data.value)) {
      for (const r of data.value) {
        // name may be refs/heads/main
        const name = String(r.name || r.ref || "");
        out.push({ name });
      }
    }
    return out;
  }

  /**
   * 指定リポジトリのプルリクエスト一覧を取得します。
   */
  private async fetchPullRequests(organization: string, repoIdOrName: string, pat?: string): Promise<AdoPullRequest[]> {
    const key = this.patKeyForOrg(organization);
    let usePat = pat;
    if (!usePat && this.context) usePat = (await this.context.secrets.get(key)) || undefined;
    // Pull Requests API: filter by repositoryId if provided
    const url = `https://dev.azure.com/${encodeURIComponent(organization)}/_apis/git/pullrequests?searchCriteria.repositoryId=${encodeURIComponent(repoIdOrName)}&api-version=6.0`;
    let data: any;
    if (usePat) {
      data = await httpRequest("GET", url, usePat);
    } else {
      const entered = await this.promptAndStorePat(organization);
      if (!entered) return [];
      usePat = entered;
      data = await httpRequest("GET", url, usePat);
    }
    const out: AdoPullRequest[] = [];
    if (data && Array.isArray(data.value)) {
      for (const pr of data.value) {
        out.push({ pullRequestId: Number(pr.pullRequestId || pr.id), title: String(pr.title || ""), url: pr._links?.web?.href || pr.url || "", status: pr.status });
      }
    }
    return out;
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
