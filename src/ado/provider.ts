import * as vscode from "vscode";
import { AdoTreeItem, AdoProject, AdoItemType, AdoRepository, AdoWorkItem, AdoBranch, AdoPullRequest } from "./types";
import { AdoApiClient } from "./adoApiClient";

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
  // -----------------------
  // TreeDataProvider Required Members
  // -----------------------
  private _onDidChangeTreeData: vscode.EventEmitter<AdoTreeItem | undefined | null | void> = new vscode.EventEmitter();
  readonly onDidChangeTreeData: vscode.Event<AdoTreeItem | undefined | null | void> = this._onDidChangeTreeData.event;

  // -----------------------
  // Core State
  // -----------------------
  private context: vscode.ExtensionContext | undefined;
  private apiClient: AdoApiClient;
  private organizations: string[] = [];

  // -----------------------
  // Caching & Error Handling
  // -----------------------
  private childrenCache: { [key: string]: any[] } = {};
  private childrenFetchPromises: { [key: string]: Promise<any[]> } = {};
  private errorsByOrg: { [org: string]: string } = {};

  // -----------------------
  // Loading UI State
  // -----------------------
  private loadingOrg?: string;
  private loadingNodes: { [id: string]: boolean } = {};
  private loadingTimers: { [id: string]: NodeJS.Timeout } = {};
  private loadingIconBackup: { [id: string]: vscode.ThemeIcon | any } = {};

  // -----------------------
  // Constructor
  // -----------------------
  /**
   * コンストラクタ。
   * @param context 拡張の `ExtensionContext`（省略可）
   */
  constructor(context?: vscode.ExtensionContext) {
    this.context = context;
    this.apiClient = new AdoApiClient(context);
    // PAT プロンプト用コールバックを設定
    this.apiClient.setPatPromptCallback(org => this.promptAndStorePat(org));
    if (this.context) {
      const orgs = this.context.globalState.get<string[]>("azuredevops.organizations");
      if (orgs) this.organizations = orgs;
      const errs = this.context.globalState.get<{ [org: string]: string }>("azuredevops.errorsByOrg");
      if (errs) this.errorsByOrg = errs;
    }
  }

  // -----------------------
  // TreeDataProvider Implementation
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
        it.itemType = "organization"; // Updated itemType to "organization"
        it.organization = o;
        it.id = `org:${o}`;
        it.contextValue = "organization";
        it.iconPath = new vscode.ThemeIcon("organization", new vscode.ThemeColor("charts.green"));
        it.url = `https://dev.azure.com/${encodeURIComponent(o)}`;
        it.tooltip = it.url;
        orgItems.push(it);

        // エラーがある場合は表示
        if (this.errorsByOrg[o]) {
          const errItem = new AdoTreeItem(`⚠️ ${this.errorsByOrg[o]}`, vscode.TreeItemCollapsibleState.None);
          errItem.itemType = "error";
          errItem.id = `error:${o}`;
          errItem.contextValue = "error";
          errItem.tooltip = this.errorsByOrg[o];
          errItem.iconPath = new vscode.ThemeIcon("error", new vscode.ThemeColor("charts.red"));
          orgItems.push(errItem);
        }
      }
      if (orgItems.length === 0) {
        const noOrgItem = new AdoTreeItem("no organizations");
        noOrgItem.itemType = "error";
        noOrgItem.id = "no-organizations";
        noOrgItem.contextValue = "error";
        noOrgItem.iconPath = new vscode.ThemeIcon("stop", new vscode.ThemeColor("charts.red"));
        return actions.concat([noOrgItem]);
      }
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
        async () => await this.apiClient.fetchProjects(org),
        projects =>
          projects.map(p => {
            const it = new AdoTreeItem(p.name, vscode.TreeItemCollapsibleState.Collapsed);
            it.itemType = "project";
            it.organization = org;
            // store project name as projectId to ensure downstream WIQL uses project name
            it.projectId = p.name;
            it.id = `proj:${org}:${p.id}`;
            it.contextValue = "adoProject";
            it.iconPath = new vscode.ThemeIcon("repo", new vscode.ThemeColor("charts.green"));
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
      // set Work Items web page for this project (recently updated view)
      try {
        const projNameForUrl = projectId || "";
        if (projNameForUrl) {
          workFolder.url = `https://dev.azure.com/${encodeURIComponent(org)}/${encodeURIComponent(projNameForUrl)}/_workitems/recentlyupdated/`;
        }
      } catch (e) {}

      const repoFolder = new AdoTreeItem("Repositories", vscode.TreeItemCollapsibleState.Collapsed);
      repoFolder.itemType = "repositoriesFolder";
      repoFolder.organization = org;
      repoFolder.projectId = projectId;
      repoFolder.id = `repos:${org}:${projectId}`;
      repoFolder.contextValue = "repositoriesFolder";

      return [workFolder, repoFolder];
    }

    // workItemsFolder の子: カテゴリ別フォルダを表示する
    if (t === "workItemsFolder" && element.organization && element.projectId) {
      const org = element.organization as string;
      const pid = element.projectId as string;
      const categories = [
        { key: "assigned", label: "Assigned to me" },
        { key: "following", label: "Following" },
        { key: "mentioned", label: "Mentioned" },
        { key: "myactivity", label: "My activity" },
        { key: "recentlyUpdated", label: "Recently updated" },
        { key: "recentlyCompleted", label: "Recently completed" },
        { key: "recentlyCreated", label: "Recently created" },
      ];
      return categories.map(c => {
        const it = new AdoTreeItem(c.label, vscode.TreeItemCollapsibleState.Collapsed);
        it.itemType = "workItemsCategory";
        it.organization = org;
        it.projectId = pid;
        it.id = `workitems:${org}:${pid}:category:${c.key}`;
        it.contextValue = "workItemsCategory";
        it.tooltip = c.label;
        return it;
      });
    }

    // workItemsCategory の子: 実際の Work Item をカテゴリに応じて取得して表示
    if (t === "workItemsCategory" && element.organization) {
      const org = element.organization as string;
      const pid = element.projectId as string | undefined;
      const parts = String(element.id || "").split(":");
      const catKey = parts.length >= 5 ? parts[4] : "";
      const cacheKey = `workitems:${org}:${pid}:category:${catKey}`;

      let fetchFn: () => Promise<AdoWorkItem[]> = async () => [];
      switch (catKey) {
        case "assigned":
          fetchFn = async () => await this.apiClient.fetchAssignedToMe(org, pid);
          break;
        case "following":
          fetchFn = async () => await this.apiClient.fetchFollowing(org, pid);
          break;
        case "mentioned":
          fetchFn = async () => await this.apiClient.fetchMentioned(org, pid);
          break;
        case "myactivity":
          fetchFn = async () => await this.apiClient.fetchMyActivity(org, pid);
          break;
        case "recentlyUpdated":
          fetchFn = async () => await this.apiClient.fetchRecentlyUpdated(org, pid);
          break;
        case "recentlyCompleted":
          fetchFn = async () => await this.apiClient.fetchRecentlyCompleted(org, pid);
          break;
        case "recentlyCreated":
          fetchFn = async () => await this.apiClient.fetchRecentlyCreated(org, pid);
          break;
        default:
          fetchFn = async () => [];
      }

      return this.lazyLoadChildren<AdoWorkItem>(cacheKey, element, fetchFn, items => items.map(w => this.makeWorkItemTreeItem(w, org)), "Loading work items...");
    }

    // repositoriesFolder の子: repositories
    if (t === "repositoriesFolder" && element.organization && element.projectId) {
      const org = element.organization as string;
      const pid = element.projectId as string;
      const key = `repos:${org}:${pid}`;
      const resolvedProjForRepos = await this.apiClient.resolveProjectName(org, pid);
      return this.lazyLoadChildren<AdoRepository>(
        key,
        element,
        async () => await this.apiClient.fetchRepositories(org, pid),
        repos => repos.map(r => this.makeRepositoryTreeItem(r, org, pid, resolvedProjForRepos)),
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
      branchesFolder.repoId = element.repoId || (repoId as string);
      branchesFolder.repoName = element.repoName || "";
      branchesFolder.id = `branches:${org}:${repoId}`;
      branchesFolder.contextValue = "branchesFolder";

      const prsFolder = new AdoTreeItem("Pull Requests", vscode.TreeItemCollapsibleState.Collapsed);
      prsFolder.itemType = "pullRequestsFolder";
      prsFolder.organization = org;
      prsFolder.projectId = element.projectId;
      prsFolder.repoId = element.repoId || (repoId as string);
      prsFolder.repoName = element.repoName || "";
      prsFolder.id = `prs:${org}:${repoId}`;
      prsFolder.contextValue = "pullRequestsFolder";

      // set Pull Requests web page URL (showing 'mine' by default)
      try {
        const projNameForUrl = element.projectId || "";
        const repoNameForUrl = prsFolder.repoName || (repoId as string) || "";
        try {
          const resolved = await this.apiClient.resolveProjectName(org, projNameForUrl);
          const url = this.apiClient.buildWebUrl(org, resolved || projNameForUrl, repoNameForUrl, "prsFolder");
          if (url) prsFolder.url = url;
        } catch (e) {}
      } catch (e) {}

      return [branchesFolder, prsFolder];
    }

    // branchesFolder の子: ブランチ一覧
    if (t === "branchesFolder" && element.organization) {
      const org = element.organization as string;
      const parts = String(element.id).split(":");
      const repoId = parts.length >= 3 ? parts[2] : "";
      const repoName = (element as any).repoName || "";
      const key = `branches:${org}:${repoId}`;
      const resolvedProjForBranches = await this.apiClient.resolveProjectName(org, element.projectId as string | undefined);
      return this.lazyLoadChildren<AdoBranch>(
        key,
        element,
        async () => await this.apiClient.fetchBranches(org, repoId),
        branches => branches.map(b => this.makeBranchTreeItem(b, org, repoId, repoName, resolvedProjForBranches, element.projectId as string | undefined)),
        "Loading branches...",
      );
    }

    // pullRequestsFolder の子: カテゴリ別フォルダを表示する
    if (t === "pullRequestsFolder" && element.organization) {
      const org = element.organization as string;
      const parts = String(element.id).split(":");
      const repoId = parts.length >= 3 ? parts[2] : "";
      const categories = [
        { key: "mine", label: "Mine" },
        { key: "active", label: "Active" },
        { key: "completed", label: "Completed" },
        { key: "abandoned", label: "Abandoned" },
      ];
      return categories.map(c => {
        const it = new AdoTreeItem(c.label, vscode.TreeItemCollapsibleState.Collapsed);
        it.itemType = "pullRequestsCategory";
        it.organization = org;
        it.projectId = element.projectId;
        it.repoId = repoId;
        it.repoName = (element as any).repoName || "";
        it.id = `prs:${org}:${repoId}:category:${c.key}`;
        it.contextValue = "pullRequestsCategory";
        it.tooltip = c.label;
        return it;
      });
    }

    // pullRequestsCategory の子: カテゴリに応じて PR を取得して表示
    if (t === "pullRequestsCategory" && element.organization) {
      const org = element.organization as string;
      const pid = element.projectId as string | undefined;
      const repoId = (element as any).repoId || "";
      const parts = String(element.id || "").split(":");
      const catKey = parts.length >= 5 ? parts[4] : "";
      const cacheKey = `prs:${org}:${repoId}:category:${catKey}`;

      let fetchFn: () => Promise<AdoPullRequest[]> = async () => [];
      switch (catKey) {
        case "mine":
          fetchFn = async () => await this.apiClient.fetchPullRequestsMine(org, repoId);
          break;
        case "active":
          fetchFn = async () => await this.apiClient.fetchPullRequestsByStatus(org, repoId, "active");
          break;
        case "completed":
          fetchFn = async () => await this.apiClient.fetchPullRequestsByStatus(org, repoId, "completed");
          break;
        case "abandoned":
          fetchFn = async () => await this.apiClient.fetchPullRequestsByStatus(org, repoId, "abandoned");
          break;
        default:
          fetchFn = async () => [];
      }

      const resolvedProjForPrs = await this.apiClient.resolveProjectName(org, pid);
      return this.lazyLoadChildren<AdoPullRequest>(cacheKey, element, fetchFn, prs => prs.map(pr => this.makePullRequestTreeItem(pr, org, repoId, (element as any).repoName || "", resolvedProjForPrs)), "Loading pull requests...");
    }

    return [];
  }

  // -----------------------
  // Public API
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
    // refresh は組織単位のみで行う（それ以外は無視）
    try {
      const t: AdoItemType | undefined = element.itemType;
      if (t !== "organization") return;

      const org = element.organization as string | undefined;
      if (!org) {
        this.refresh();
        return;
      }

      if (element.id) {
        this.beginLoading(element);
      }

      // 組織の children キャッシュ／in-flight を削除して再フェッチ
      const prefixes = [`projects:${org}`, `workitems:${org}:`, `repos:${org}:`, `branches:${org}:`, `prs:${org}:`];
      try {
        for (const k of Object.keys(this.childrenCache)) {
          for (const p of prefixes) {
            if (k === p || k.startsWith(p)) {
              delete this.childrenCache[k];
              break;
            }
          }
        }
      } catch (e) {}
      try {
        for (const k of Object.keys(this.childrenFetchPromises)) {
          for (const p of prefixes) {
            if (k === p || k.startsWith(p)) {
              delete this.childrenFetchPromises[k];
              break;
            }
          }
        }
      } catch (e) {}
      this._onDidChangeTreeData.fire(element);

      // エラーをクリア
      delete this.errorsByOrg[org];
      if (this.context) this.context.globalState.update("azuredevops.errorsByOrg", this.errorsByOrg);

      try {
        await this.apiClient.fetchProjects(org);
      } catch (e) {}

      if (element.id) {
        this.endLoading(element);
      }
      return;
    } catch (err) {
      if (element?.id) this.endLoading(element);
      this.refresh();
    }
  }

  private beginLoading(element: AdoTreeItem) {
    if (!element.id) return;
    try {
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
        if (!this.loadingIconBackup[element.id]) {
          this.loadingIconBackup[element.id] = element.iconPath;
          element.iconPath = new vscode.ThemeIcon("sync~spin");
        }
      } catch (e) {}
      this._onDidChangeTreeData.fire(element);
    } catch (e) {}
  }

  private endLoading(element: AdoTreeItem) {
    if (!element.id) return;
    try {
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
      this._onDidChangeTreeData.fire(element);
    } catch (e) {}
  }

  // -----------------------
  // Organization Commands
  // -----------------------
  /**
   * 組織を追加します（重複無視）。workspaceState に永続化。
   */
  addOrganization(org: string) {
    if (!org) return;
    if (!this.organizations.includes(org)) {
      this.organizations.push(org);
      if (this.context) this.context.globalState.update("azuredevops.organizations", this.organizations);
      this.refresh();
    }
  }

  /**
   * 組織を削除します。workspaceState を更新し、関連データを消去。
   */
  removeOrganization(org: string) {
    if (!org) return;
    this.organizations = this.organizations.filter(o => o !== org);
    if (this.context) this.context.globalState.update("azuredevops.organizations", this.organizations);
    this.refresh();
  }

  /**
   * すべての組織情報と関連データをクリアします。
   */
  async clearOrganizations(): Promise<void> {
    // delete stored PATs for known organizations
    const orgs = Array.from(this.organizations || []);
    if (this.context) {
      for (const o of orgs) {
        try {
          await this.context.secrets.delete(this.patKeyForOrg(o));
        } catch (e) {}
      }
    }
    this.organizations = [];
    if (this.context) this.context.globalState.update("azuredevops.organizations", this.organizations);
    this.apiClient.clearPatCache();
    this.childrenCache = {};
    this.childrenFetchPromises = {};
    this.refresh();
  }

  // -----------------------
  // Private Utilities - Lazy Loading
  // -----------------------
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
        // エラーをクリア
        const orgMatch = key.match(/^[^:]+:(.+?):/);
        if (orgMatch) {
          const org = orgMatch[1];
          delete this.errorsByOrg[org];
          if (this.context) this.context.globalState.update("azuredevops.errorsByOrg", this.errorsByOrg);
        }
        return res || [];
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        this.childrenCache[key] = [];
        // エラーを記録
        const orgMatch = key.match(/^[^:]+:(.+?):/);
        if (orgMatch) {
          const org = orgMatch[1];
          this.errorsByOrg[org] = msg;
          if (this.context) this.context.globalState.update("azuredevops.errorsByOrg", this.errorsByOrg);
        }
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

  // -----------------------
  // Private Utilities - TreeItem Factories
  // -----------------------
  private makeWorkItemTreeItem(w: AdoWorkItem, org: string): AdoTreeItem {
    const it = new AdoTreeItem(`#${w.id} ${w.title}`, vscode.TreeItemCollapsibleState.None);
    it.itemType = "workItem";
    it.organization = org;
    it.id = `work:${org}:${w.id}`;
    it.contextValue = "workitem";
    try {
      const st = (w as any).status ? String((w as any).status).toLowerCase() : "";
      if (st.includes("done") || st.includes("closed") || st.includes("resolved") || st.includes("complete")) {
        it.iconPath = new vscode.ThemeIcon("check", new vscode.ThemeColor("charts.green"));
      } else if (st.includes("active") || st.includes("in progress") || st.includes("doing")) {
        it.iconPath = new vscode.ThemeIcon("run", new vscode.ThemeColor("charts.green"));
      } else {
        it.iconPath = new vscode.ThemeIcon("issues", new vscode.ThemeColor("charts.red"));
      }
    } catch (e) {}
    it.url = w.url;
    it.tooltip = w.url || w.title;
    try {
      it.description = (w as any).assignee || "";
    } catch (e) {}
    return it;
  }

  private makeRepositoryTreeItem(r: AdoRepository, org: string, pid: string | undefined, resolvedProj: string | undefined): AdoTreeItem {
    const it = new AdoTreeItem(r.name, vscode.TreeItemCollapsibleState.Collapsed);
    it.itemType = "repository";
    it.organization = org;
    it.repoId = r.id;
    it.repoName = r.name;
    it.id = `repo:${org}:${r.id}`;
    it.contextValue = "repo";
    it.projectId = pid;
    it.iconPath = new vscode.ThemeIcon("repo", new vscode.ThemeColor("charts.green"));
    try {
      const url = this.apiClient.buildWebUrl(org, resolvedProj || pid || "", r.name || "", "repo");
      if (url) {
        it.url = url;
        it.tooltip = url;
      } else {
        it.url = r.url || "";
        it.tooltip = r.url || "";
      }
    } catch (e) {
      it.url = r.url || "";
      it.tooltip = r.url || "";
    }
    return it;
  }

  private makeBranchTreeItem(b: AdoBranch, org: string, repoId: string, repoName: string, resolvedProj: string | undefined, pid?: string): AdoTreeItem {
    const name = String(b.name).replace(/^refs\/heads\//, "");
    const it = new AdoTreeItem(name, vscode.TreeItemCollapsibleState.None);
    it.itemType = "branch";
    it.organization = org;
    it.id = `branch:${org}:${repoId}:${name}`;
    it.contextValue = "branch";
    it.iconPath = new vscode.ThemeIcon("git-branch", new vscode.ThemeColor("charts.green"));
    try {
      const projNameFallback = pid && typeof pid === "string" ? pid : resolvedProj || "";
      const url = this.apiClient.buildWebUrl(org, resolvedProj || projNameFallback, repoName || repoId || "", "branch", name);
      if (url) it.url = url;
    } catch (e) {}
    return it;
  }

  private makePullRequestTreeItem(pr: AdoPullRequest, org: string, repoId: string, repoName: string, resolvedProj: string | undefined): AdoTreeItem {
    const label = `!${pr.pullRequestId} ${pr.title}`;
    const it = new AdoTreeItem(label, vscode.TreeItemCollapsibleState.None);
    it.itemType = "pullRequest";
    it.organization = org;
    it.id = `pr:${org}:${repoId}:${pr.pullRequestId}`;
    it.contextValue = "pullrequest";
    it.iconPath = new vscode.ThemeIcon("git-merge", new vscode.ThemeColor("charts.green"));
    const candidate = pr.webUrl || pr.url || "";
    if (candidate && candidate.includes("/_apis/")) {
      if (resolvedProj && repoName) {
        try {
          const url = this.apiClient.buildWebUrl(org, resolvedProj, repoName, "pr", pr.pullRequestId);
          it.url = url || candidate;
        } catch (e) {
          it.url = candidate;
        }
      } else {
        it.url = candidate;
      }
    } else {
      it.url = candidate;
    }
    it.tooltip = pr.title;
    try {
      it.description = this.apiClient.extractPerson((pr as any).createdBy || {});
    } catch (e) {}
    return it;
  }

  // -----------------------
  // Private Utilities - Authentication
  // -----------------------
  /**
   * ユーザーに PAT 入力を促し、入力があれば secrets に保存します。
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
   * 指定した組織に対応する secrets のキーを返します。
   */
  private patKeyForOrg(org: string) {
    return `ado-assist.pat.${org}`;
  }
}
