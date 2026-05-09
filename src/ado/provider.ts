import * as vscode from "vscode";
import { AdoTreeItem, AdoProject, AdoItemType, AdoRepository, AdoWorkItem, AdoBranch, AdoPullRequest } from "./types";
import { AdoApiClient } from "./adoApiClient";

export function createTreeProvider(context?: vscode.ExtensionContext, channel?: vscode.LogOutputChannel): AdoTreeProvider {
  /**
   * AdoTreeProvider のファクトリ。
   * @param context 拡張の `ExtensionContext`（省略可）
   * @param channel ロギング用の OutputChannel（省略可）
   * @returns `AdoTreeProvider` インスタンス
   */
  return new AdoTreeProvider(context, channel);
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
  private channel?: vscode.LogOutputChannel;
  private apiClient: AdoApiClient;
  private organizations: string[] = [];
  private treeView?: vscode.TreeView<AdoTreeItem>;

  // -----------------------
  // Caching & Error Handling
  // -----------------------
  private childrenCache: { [key: string]: any[] } = {};
  private childrenFetchPromises: { [key: string]: Promise<any[]> } = {};
  private errorsByOrg: { [org: string]: string } = {};
  private nodeIdGen: { [key: string]: number } = {};
  private childrenFetchTokens: { [key: string]: number } = {};

  // -----------------------
  // Filter State
  // -----------------------
  private workItemFilterState: { [folderId: string]: number } = {};
  private prFilterState: { [folderId: string]: number } = {};

  // -----------------------
  // Authentication State
  // -----------------------
  private authFailedOrgs = new Set<string>();

  // -----------------------
  // Constructor
  // -----------------------
  /**
   * コンストラクタ。
   * @param context 拡張の `ExtensionContext`（省略可）
   * @param channel ロギング用の OutputChannel（省略可）
   */
  constructor(context?: vscode.ExtensionContext, channel?: vscode.LogOutputChannel) {
    this.context = context;
    this.channel = channel;
    this.apiClient = new AdoApiClient(context, channel);
    if (this.context) {
      const orgs = this.context.globalState.get<string[]>("azuredevops.organizations");
      if (orgs) this.organizations = orgs;
      const errs = this.context.globalState.get<{ [org: string]: string }>("azuredevops.errorsByOrg");
      if (errs) this.errorsByOrg = errs;
    }
  }

  /** Called from extension activation to provide the TreeView instance */
  setTreeView(tv: vscode.TreeView<AdoTreeItem>) {
    this.treeView = tv;
  }

  /**
   * API クライアントを取得します。
   */
  getClient(): AdoApiClient {
    return this.apiClient;
  }

  /**
   * 指定組織のキャッシュをクリアします。
   * @param organization 組織名
   */
  clearCacheForOrganization(organization: string): void {
    this.authFailedOrgs.delete(organization);
    delete this.errorsByOrg[organization];
    if (this.context) this.context.globalState.update("azuredevops.errorsByOrg", this.errorsByOrg);
    const prefixes = [`projects:${organization}`, `workitems:${organization}:`, `repos:${organization}:`, `branches:${organization}:`, `prs:${organization}:`];
    for (const k of Object.keys(this.childrenCache)) {
      if (prefixes.some(p => k === p || k.startsWith(p))) delete this.childrenCache[k];
    }
    for (const k of Object.keys(this.childrenFetchPromises)) {
      if (prefixes.some(p => k === p || k.startsWith(p))) {
        delete this.childrenFetchPromises[k];
        this.childrenFetchTokens[k] = (this.childrenFetchTokens[k] || 0) + 1;
      }
    }
    this.channel?.appendLine(`Cleared cache for organization: ${organization}`);
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
   * 親要素を返す。treeView.reveal を使うために必要。
   * 組織ノードはルート直下のため undefined を返す。
   */
  getParent(element: AdoTreeItem): vscode.ProviderResult<AdoTreeItem> {
    if (element.itemType === "organization") return undefined;
    return undefined;
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
        it.iconPath = new vscode.ThemeIcon("organization", new vscode.ThemeColor("charts.blue"));
        it.url = `https://dev.azure.com/${encodeURIComponent(o)}`;
        it.tooltip = it.url;
        orgItems.push(it);

        // エラーがある場合は表示
        if (this.errorsByOrg[o]) {
          const errItem = new AdoTreeItem(`${this.errorsByOrg[o]}`, vscode.TreeItemCollapsibleState.None);
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

      // PAT が未設定の場合は「Enter PAT」アイテムを表示
      const storedPat = await this.context?.secrets.get(`ado-assist.pat.${org}`);
      if (!storedPat) {
        const enterPatItem = new AdoTreeItem("Enter PAT to connect...", vscode.TreeItemCollapsibleState.None);
        enterPatItem.itemType = "error";
        enterPatItem.organization = org;
        enterPatItem.id = `enter-pat:${org}`;
        enterPatItem.contextValue = "enterPat";
        enterPatItem.iconPath = new vscode.ThemeIcon("key", new vscode.ThemeColor("charts.yellow"));
        enterPatItem.command = { command: "ado-assist.enterPatForOrg", title: "Enter PAT", arguments: [org] };
        return [enterPatItem];
      }

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
            it.iconPath = new vscode.ThemeIcon("repo", new vscode.ThemeColor("charts.blue"));
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
      const workGenKey = `workitems:${org}:${projectId}:category:`;
      const workGen = this.nodeIdGen[workGenKey] || 0;
      const workFolder = new AdoTreeItem("Work items", vscode.TreeItemCollapsibleState.Expanded);
      workFolder.itemType = "workItemsFolder";
      workFolder.organization = org;
      workFolder.projectId = projectId;
      workFolder.id = `workitems:${org}:${projectId}:gen:${workGen}`;
      workFolder.contextValue = "workItemsFolder";
      // set Work Items web page for this project (recently updated view)
      try {
        const projNameForUrl = projectId || "";
        if (projNameForUrl) {
          workFolder.url = `https://dev.azure.com/${encodeURIComponent(org)}/${encodeURIComponent(projNameForUrl)}/_workitems/recentlyupdated/`;
        }
      } catch (e) {}

      const repoGenKey = `repos:${org}:${projectId}`;
      const repoGen = this.nodeIdGen[repoGenKey] || 0;
      const repoFolder = new AdoTreeItem("Repositories", vscode.TreeItemCollapsibleState.Collapsed);
      repoFolder.itemType = "repositoriesFolder";
      repoFolder.organization = org;
      repoFolder.projectId = projectId;
      repoFolder.id = `repos:${org}:${projectId}:gen:${repoGen}`;
      repoFolder.contextValue = "repositoriesFolder";

      return [workFolder, repoFolder];
    }

    // workItemsFolder の子: フィルタボタン＋現在フィルタの work item を直接表示する
    if (t === "workItemsFolder" && element.organization && element.projectId) {
      const org = element.organization as string;
      const pid = element.projectId as string;
      const workItemCategories = [
        { key: "assigned", label: "Assigned to me" },
        { key: "following", label: "Following" },
        { key: "mentioned", label: "Mentioned" },
        { key: "myactivity", label: "My activity" },
        { key: "recentlyUpdated", label: "Recently updated" },
        { key: "recentlyCompleted", label: "Recently completed" },
        { key: "recentlyCreated", label: "Recently created" },
      ];
      const filterKey = `${org}:${pid}`;
      const filterIdx = (this.workItemFilterState[filterKey] || 0) % workItemCategories.length;
      const currentCat = workItemCategories[filterIdx];

      // フィルタボタンノード
      const filterBtn = new AdoTreeItem(currentCat.label, vscode.TreeItemCollapsibleState.None);
      filterBtn.itemType = "workItemsFilter";
      filterBtn.organization = org;
      filterBtn.projectId = pid;
      filterBtn.id = `workitems-filter:${org}:${pid}`;
      filterBtn.contextValue = "workItemsFilter";
      filterBtn.folderRef = element;
      filterBtn.iconPath = new vscode.ThemeIcon("filter", new vscode.ThemeColor("charts.blue"));
      filterBtn.tooltip = "クリックしてフィルタを切り替える（右クリックで選択）";
      filterBtn.command = { command: "ado-assist.cycleWorkItemFilter", title: "フィルタを切り替える", arguments: [element] };

      // 現在フィルタの work item をフェッチ
      let fetchFn: () => Promise<AdoWorkItem[]> = async () => [];
      switch (currentCat.key) {
        case "assigned":       fetchFn = async () => await this.apiClient.fetchAssignedToMe(org, pid); break;
        case "following":      fetchFn = async () => await this.apiClient.fetchFollowing(org, pid); break;
        case "mentioned":      fetchFn = async () => await this.apiClient.fetchMentioned(org, pid); break;
        case "myactivity":     fetchFn = async () => await this.apiClient.fetchMyActivity(org, pid); break;
        case "recentlyUpdated":   fetchFn = async () => await this.apiClient.fetchRecentlyUpdated(org, pid); break;
        case "recentlyCompleted": fetchFn = async () => await this.apiClient.fetchRecentlyCompleted(org, pid); break;
        case "recentlyCreated":   fetchFn = async () => await this.apiClient.fetchRecentlyCreated(org, pid); break;
      }
      const cacheKey = `workitems:${org}:${pid}:category:${currentCat.key}`;
      const items = this.lazyLoadChildren<AdoWorkItem>(cacheKey, element, fetchFn, ws => ws.map(w => this.makeWorkItemTreeItem(w, org, pid)), "Loading work items...");
      return [filterBtn, ...items];
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

      return this.lazyLoadChildren<AdoWorkItem>(cacheKey, element, fetchFn, items => items.map(w => this.makeWorkItemTreeItem(w, org, pid)), "Loading work items...");
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
      const branchesGenKey = `branches:${org}:${repoId}`;
      const branchesGen = this.nodeIdGen[branchesGenKey] || 0;
      const branchesFolder = new AdoTreeItem("Branches", vscode.TreeItemCollapsibleState.Collapsed);
      branchesFolder.itemType = "branchesFolder";
      branchesFolder.organization = org;
      branchesFolder.projectId = element.projectId;
      branchesFolder.repoId = element.repoId || (repoId as string);
      branchesFolder.repoName = element.repoName || "";
      branchesFolder.id = `branches:${org}:${repoId}:gen:${branchesGen}`;
      branchesFolder.contextValue = "branchesFolder";

      const prsFolder = new AdoTreeItem("Pull Requests", vscode.TreeItemCollapsibleState.Collapsed);
      prsFolder.itemType = "pullRequestsFolder";
      prsFolder.organization = org;
      prsFolder.projectId = element.projectId;
      prsFolder.repoId = element.repoId || (repoId as string);
      prsFolder.repoName = element.repoName || "";
      const prsGenKey = `prs:${org}:${repoId}:category:`;
      const prsGen = this.nodeIdGen[prsGenKey] || 0;
      prsFolder.id = `prs:${org}:${repoId}:gen:${prsGen}`;
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

    // pullRequestsFolder の子: フィルタボタン＋現在フィルタの PR を直接表示する
    if (t === "pullRequestsFolder" && element.organization) {
      const org = element.organization as string;
      const parts = String(element.id).split(":");
      const repoId = parts.length >= 3 ? parts[2] : "";
      const prCategories = [
        { key: "mine", label: "Mine" },
        { key: "active", label: "Active" },
        { key: "completed", label: "Completed" },
        { key: "abandoned", label: "Abandoned" },
      ];
      const filterKey = `${org}:${repoId}`;
      const filterIdx = (this.prFilterState[filterKey] || 0) % prCategories.length;
      const currentCat = prCategories[filterIdx];

      // フィルタボタンノード
      const filterBtn = new AdoTreeItem(currentCat.label, vscode.TreeItemCollapsibleState.None);
      filterBtn.itemType = "pullRequestsFilter";
      filterBtn.organization = org;
      filterBtn.projectId = element.projectId;
      filterBtn.repoId = repoId;
      filterBtn.repoName = (element as any).repoName || "";
      filterBtn.id = `prs-filter:${org}:${repoId}`;
      filterBtn.contextValue = "pullRequestsFilter";
      filterBtn.folderRef = element;
      filterBtn.iconPath = new vscode.ThemeIcon("filter", new vscode.ThemeColor("charts.blue"));
      filterBtn.tooltip = "クリックしてフィルタを切り替える（右クリックで選択）";
      filterBtn.command = { command: "ado-assist.cyclePrFilter", title: "フィルタを切り替える", arguments: [element] };

      // 現在フィルタの PR をフェッチ
      let fetchFn: () => Promise<AdoPullRequest[]> = async () => [];
      switch (currentCat.key) {
        case "mine":      fetchFn = async () => await this.apiClient.fetchPullRequestsMine(org, repoId); break;
        case "active":    fetchFn = async () => await this.apiClient.fetchPullRequestsByStatus(org, repoId, "active"); break;
        case "completed": fetchFn = async () => await this.apiClient.fetchPullRequestsByStatus(org, repoId, "completed"); break;
        case "abandoned": fetchFn = async () => await this.apiClient.fetchPullRequestsByStatus(org, repoId, "abandoned"); break;
      }
      const cacheKey = `prs:${org}:${repoId}:category:${currentCat.key}`;
      const resolvedProjForPrs = await this.apiClient.resolveProjectName(org, element.projectId as string | undefined);
      const items = this.lazyLoadChildren<AdoPullRequest>(cacheKey, element, fetchFn, prs => prs.map(pr => this.makePullRequestTreeItem(pr, org, repoId, (element as any).repoName || "", resolvedProjForPrs)), "Loading pull requests...");
      return [filterBtn, ...items];
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
   * Work Items フォルダのフィルタを次へ進める。
   * @param folderElement workItemsFolder の AdoTreeItem
   */
  cycleWorkItemFilter(folderElement: AdoTreeItem): void {
    const org = folderElement.organization;
    const pid = folderElement.projectId;
    if (!org || !pid) return;
    const key = `${org}:${pid}`;
    const categoryCount = 7;
    this.workItemFilterState[key] = ((this.workItemFilterState[key] || 0) + 1) % categoryCount;
    this._onDidChangeTreeData.fire(folderElement);
  }

  /**
   * Work Items フォルダのフィルタを指定インデックスに設定する。
   * @param folderElement workItemsFolder の AdoTreeItem
   * @param index フィルタのインデックス（0 始まり）
   */
  setWorkItemFilter(folderElement: AdoTreeItem, index: number): void {
    const org = folderElement.organization;
    const pid = folderElement.projectId;
    if (!org || !pid) return;
    const key = `${org}:${pid}`;
    this.workItemFilterState[key] = index;
    this._onDidChangeTreeData.fire(folderElement);
  }

  /**
   * Pull Requests フォルダのフィルタを次へ進める。
   * @param folderElement pullRequestsFolder の AdoTreeItem
   */
  cyclePrFilter(folderElement: AdoTreeItem): void {
    const org = folderElement.organization;
    const repoId = folderElement.repoId;
    if (!org || !repoId) return;
    const key = `${org}:${repoId}`;
    const categoryCount = 4;
    this.prFilterState[key] = ((this.prFilterState[key] || 0) + 1) % categoryCount;
    this._onDidChangeTreeData.fire(folderElement);
  }

  /**
   * Pull Requests フォルダのフィルタを指定インデックスに設定する。
   * @param folderElement pullRequestsFolder の AdoTreeItem
   * @param index フィルタのインデックス（0 始まり）
   */
  setPrFilter(folderElement: AdoTreeItem, index: number): void {
    const org = folderElement.organization;
    const repoId = folderElement.repoId;
    if (!org || !repoId) return;
    const key = `${org}:${repoId}`;
    this.prFilterState[key] = index;
    this._onDidChangeTreeData.fire(folderElement);
  }

  /**
   * ツリー全体を更新するヘルパー。
   */
  refresh(): void {
    this._onDidChangeTreeData.fire();
  }

  /**
   * 指定ノード（または全体）をリフレッシュする公開 API。
   * キャッシュをクリアして tree data change を一度だけ発火する。
   * @param element 更新対象のノード（未指定で全体）
   */
  async refreshNode(element?: AdoTreeItem): Promise<void> {
    const org = element?.organization as string | undefined;
    if (org) {
      this.clearCacheForOrganization(org);
      // 対象 org のサブツリーだけ再描画（他 org に影響しない）
      this._onDidChangeTreeData.fire(element);
    } else {
      this.childrenCache = {};
      this.childrenFetchPromises = {};
      this.childrenFetchTokens = {};
      this.errorsByOrg = {};
      if (this.context) this.context.globalState.update("azuredevops.errorsByOrg", this.errorsByOrg);
      this.refresh();
    }
  }

  /**
   * 指定組織のプロジェクトを先行フェッチし、ツリーで組織ノードを展開する。
   * PAT 入力成功後に呼び出す。
   */
  async revealOrganization(org: string): Promise<void> {
    // プロジェクトをキャッシュに乗せておく
    try {
      await this.apiClient.fetchProjects(org);
    } catch (e) {
      this.channel?.appendLine(`prefetch projects failed for ${org}: ${e}`);
    }
    this.refresh();

    if (!this.treeView) return;
    // getChildren(undefined) が返す組織ノードと同じ id を持つアイテムで reveal する
    const orgItem = new AdoTreeItem(org, vscode.TreeItemCollapsibleState.Collapsed);
    orgItem.id = `org:${org}`;
    orgItem.itemType = "organization";
    orgItem.organization = org;
    orgItem.contextValue = "organization";
    try {
      await this.treeView.reveal(orgItem, { expand: true, select: true, focus: false });
    } catch (e) {
      this.channel?.appendLine(`reveal failed for ${org}: ${e}`);
    }
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
  async removeAllOrganizations(): Promise<void> {
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
    // assign a token so that if refresh clears the cache we won't write stale results
    const token = (this.childrenFetchTokens[key] || 0) + 1;
    this.childrenFetchTokens[key] = token;
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
          // only fire update if this fetch was not invalidated
          if (this.childrenFetchTokens[key] === token) this._onDidChangeTreeData.fire(element);
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
  private makeWorkItemTreeItem(w: AdoWorkItem, org: string, projectId?: string): AdoTreeItem {
    const it = new AdoTreeItem(`#${w.id} ${w.title}`, vscode.TreeItemCollapsibleState.None);
    it.itemType = "workItem";
    it.organization = org;
    it.projectId = projectId;
    it.id = `work:${org}:${w.id}`;
    it.contextValue = "workitem";
    try {
      const st = (w as any).status ? String((w as any).status).toLowerCase() : "";
      const isDone = st.includes("done") || st.includes("closed") || st.includes("resolved") || st.includes("complete");
      // DONE以外のチケットには workitem_active を追加
      if (!isDone) {
        it.contextValue = "workitem_active";
      }
      if (isDone) {
        // DONE状態: checkアイコン（青色）
        it.iconPath = new vscode.ThemeIcon("check", new vscode.ThemeColor("charts.blue"));
      } else if (st.includes("active") || st.includes("in progress") || st.includes("doing")) {
        // DOING状態: 黄色
        it.iconPath = new vscode.ThemeIcon("run", new vscode.ThemeColor("charts.yellow"));
      } else {
        // TODO・新規・その他: 緑色
        it.iconPath = new vscode.ThemeIcon("issues", new vscode.ThemeColor("charts.green"));
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
    it.iconPath = new vscode.ThemeIcon("repo", new vscode.ThemeColor("charts.blue"));
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
    it.iconPath = new vscode.ThemeIcon("git-branch", new vscode.ThemeColor("charts.blue"));
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
    it.iconPath = new vscode.ThemeIcon("git-merge", new vscode.ThemeColor("charts.blue"));
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
  private patKeyForOrg(org: string): string {
    return `ado-assist.pat.${org}`;
  }
}
