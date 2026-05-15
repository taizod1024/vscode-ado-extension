import * as vscode from "vscode";
import { AdoTreeItem, AdoProject, AdoItemType, AdoRepository, AdoWorkItem, AdoBranch, AdoPullRequest, AdoIteration } from "./types";
import { AdoApiClient } from "./adoApiClient";

/**
 * VS Code Git 拡張から、指定リポジトリ名に一致するローカルパスを返す。
 * リモートURL末尾（`/_git/<name>` or `/<name>`）またはフォルダ名で照合する。
 * @param repoName リポジトリ名
 * @returns 見つかった場合はルートパス、見つからない場合は undefined
 */
export function findLocalRepo(repoName: string): string | undefined {
  const gitExt = vscode.extensions.getExtension<any>("vscode.git")?.exports;
  const gitAPI = gitExt?.getAPI(1);
  const repos: any[] = gitAPI?.repositories ?? [];
  const lowerName = repoName.toLowerCase();
  for (const repo of repos) {
    const rootPath: string = repo.rootUri?.fsPath ?? "";
    const remotes: any[] = repo.state?.remotes ?? [];
    const isRemoteMatch = remotes.some((r: any) => {
      const url: string = (r.fetchUrl ?? r.pushUrl ?? "").replace(/\.git$/i, "").toLowerCase();
      return url.endsWith("/_git/" + lowerName) || url.endsWith("/" + lowerName);
    });
    const isFolderMatch = rootPath
      .replace(/\\/g, "/")
      .toLowerCase()
      .endsWith("/" + lowerName);
    if (isRemoteMatch || isFolderMatch) {
      return rootPath;
    }
  }
  return undefined;
}

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
  private childrenFetchTokens: { [key: string]: number } = {};
  /** イテレーション内 Work Item の親子マップ（key: iterationCacheKey, value: parentId → [子 WorkItem]） */
  private workItemChildrenMaps: { [key: string]: Map<number, AdoWorkItem[]> } = {};
  /** Work Item の状態上書きマップ（key: "org:workItemId", value: 新しい状態文字列）。キャッシュが古くても正しいアイコンを表示するために使う */
  private workItemStateOverrides: Map<string, string> = new Map();

  // -----------------------
  // Filter State
  // -----------------------
  private iterationItemFilterState: { [iterKey: string]: number } = {};
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
    for (const k of this.workItemStateOverrides.keys()) {
      if (k.startsWith(`${organization}:`)) this.workItemStateOverrides.delete(k);
    }
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
    for (const k of Object.keys(this.workItemChildrenMaps)) {
      if (k.startsWith(`workitems:${organization}:`)) delete this.workItemChildrenMaps[k];
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
  getParent(_element: AdoTreeItem): vscode.ProviderResult<AdoTreeItem> {
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
        it.itemType = "organization";
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
      const storedPat = await this.context?.secrets.get(`ado-ext.pat.${org}`);
      if (!storedPat) {
        const enterPatItem = new AdoTreeItem("Enter PAT to connect...", vscode.TreeItemCollapsibleState.None);
        enterPatItem.itemType = "error";
        enterPatItem.organization = org;
        enterPatItem.id = `enter-pat:${org}`;
        enterPatItem.contextValue = "enterPat";
        enterPatItem.iconPath = new vscode.ThemeIcon("key", new vscode.ThemeColor("charts.yellow"));
        enterPatItem.command = { command: "ado-ext.enterPatForOrg", title: "Enter PAT", arguments: [org] };
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
      const boardsFolder = new AdoTreeItem("Boards", vscode.TreeItemCollapsibleState.Collapsed);
      boardsFolder.itemType = "boardsFolder";
      boardsFolder.organization = org;
      boardsFolder.projectId = projectId;
      boardsFolder.id = `workitems:${org}:${projectId}:gen:0`;
      boardsFolder.contextValue = "boardsFolder";
      boardsFolder.iconPath = new vscode.ThemeIcon("calendar", new vscode.ThemeColor("foreground"));
      // set Boards web page for this project
      try {
        const projNameForUrl = projectId || "";
        if (projNameForUrl) {
          boardsFolder.url = `https://dev.azure.com/${encodeURIComponent(org)}/${encodeURIComponent(projNameForUrl)}/_sprints/directory`;
        }
      } catch (e) {}

      const reposFolder = new AdoTreeItem("Repos", vscode.TreeItemCollapsibleState.Collapsed);
      reposFolder.itemType = "reposFolder";
      reposFolder.organization = org;
      reposFolder.projectId = projectId;
      reposFolder.id = `repos:${org}:${projectId}:gen:0`;
      reposFolder.contextValue = "reposFolder";
      reposFolder.iconPath = new vscode.ThemeIcon("repo", new vscode.ThemeColor("foreground"));
      // set Repos web page for this project
      try {
        const projNameForUrl = projectId || "";
        if (projNameForUrl) {
          reposFolder.url = this.apiClient.buildWebUrl(org, projNameForUrl, undefined, "reposFolder");
        }
      } catch (e) {}

      return [boardsFolder, reposFolder];
    }

    // boardsFolder の子: イテレーション一覧を直接表示する
    if (t === "boardsFolder" && element.organization && element.projectId) {
      const org = element.organization as string;
      const pid = element.projectId as string;
      // ルートイテレーション（スプリント未割り当て）用の Backlog ノードを先頭に追加
      const projName = await this.apiClient.resolveProjectName(org, pid);
      const rootIterPath = projName || pid;
      const backlogNode = this.makeIterationTreeItem({ id: `${pid}:backlog`, name: "(No Sprint)", path: rootIterPath }, org, pid);
      backlogNode.contextValue = "boardsBacklog";

      const key = `workitems:${org}:${pid}:iterations`;
      return this.lazyLoadChildren<AdoIteration>(
        key,
        element,
        async () => await this.apiClient.fetchIterations(org, pid),
        iters => [backlogNode, ...iters.map(iter => this.makeIterationTreeItem(iter, org, pid))],
        "Loading iterations...",
      );
    }

    // boardsCategory の子: 実際の Work Item をカテゴリに応じて取得して表示
    if (t === "boardsCategory" && element.organization) {
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

    // boardsIteration の子: フィルタボタン＋イテレーション内の Work Item を親子階層で返す
    if (t === "boardsIteration" && element.organization && element.projectId && element.iterationPath !== undefined) {
      const org = element.organization as string;
      const pid = element.projectId as string;
      const iterPath = element.iterationPath;
      const iterationItemCategories = [
        { key: "all", label: "All" },
        { key: "assigned", label: "Assigned to me" },
        { key: "myactivity", label: "My activity" },
        { key: "active", label: "Active" },
      ];
      const filterStateKey = `${org}:${pid}:${iterPath}`;
      const filterIdx = (this.iterationItemFilterState[filterStateKey] || 0) % iterationItemCategories.length;
      const currentCat = iterationItemCategories[filterIdx];

      // フィルタボタンノード
      const filterBtn = new AdoTreeItem(currentCat.label, vscode.TreeItemCollapsibleState.None);
      filterBtn.itemType = "boardsFilter";
      filterBtn.organization = org;
      filterBtn.projectId = pid;
      filterBtn.iterationPath = iterPath;
      filterBtn.id = `iter-filter:${org}:${pid}:${iterPath}`;
      filterBtn.contextValue = `boardsIterationFilter_${currentCat.key}`;
      filterBtn.folderRef = element;
      filterBtn.iconPath = new vscode.ThemeIcon("filter");
      filterBtn.tooltip = "右クリックでフィルタを選択";

      const cacheKey = `workitems:${org}:${pid}:iter:${iterPath}:${currentCat.key}`;
      const items = this.lazyLoadChildren<AdoWorkItem>(
        cacheKey,
        element,
        async () => await this.apiClient.fetchWorkItemsForIteration(org, pid, iterPath, currentCat.key),
        ws => this.buildWorkItemHierarchy(ws, org, pid, cacheKey),
        "Loading work items...",
      );
      return this.isLoaded(cacheKey) ? [filterBtn, ...items] : items;
    }

    // workItem の子: イテレーション内連携で亲子関係がある場合に子要素を返す
    if (t === "workItem" && element.workItemId !== undefined && element.iterationCacheKey) {
      const childrenMap = this.workItemChildrenMaps[element.iterationCacheKey];
      if (!childrenMap) return [];
      const children = childrenMap.get(element.workItemId) || [];
      return children.map(w => this.makeWorkItemHierarchyItem(w, element.organization!, element.projectId, element.iterationCacheKey!, childrenMap));
    }

    // reposFolder の子: repositories
    if (t === "reposFolder" && element.organization && element.projectId) {
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
      branchesFolder.defaultBranch = element.defaultBranch;
      branchesFolder.id = `branches:${org}:${repoId}:gen:0`;
      branchesFolder.contextValue = "branchesFolder";
      branchesFolder.iconPath = new vscode.ThemeIcon("git-branch");

      const prsFolder = new AdoTreeItem("Pull Requests", vscode.TreeItemCollapsibleState.Collapsed);
      prsFolder.itemType = "pullRequestsFolder";
      prsFolder.organization = org;
      prsFolder.projectId = element.projectId;
      prsFolder.repoId = element.repoId || (repoId as string);
      prsFolder.repoName = element.repoName || "";
      prsFolder.id = `prs:${org}:${repoId}:gen:0`;
      prsFolder.contextValue = "pullRequestsFolder";
      prsFolder.iconPath = new vscode.ThemeIcon("git-pull-request", new vscode.ThemeColor("foreground"));

      // set Pull Requests web page URL (showing 'mine' by default)
      try {
        const projNameForUrl = element.projectId || "";
        const repoNameForUrl = prsFolder.repoName || (repoId as string) || "";
        const resolved = await this.apiClient.resolveProjectName(org, projNameForUrl);
        const url = this.apiClient.buildWebUrl(org, resolved || projNameForUrl, repoNameForUrl, "prsFolder");
        if (url) prsFolder.url = url;
      } catch (e) {}

      return [prsFolder, branchesFolder];
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
        branches => branches.map(b => this.makeBranchTreeItem(b, org, repoId, repoName, resolvedProjForBranches, element.projectId as string | undefined, element.defaultBranch)),
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
      filterBtn.contextValue = `pullRequestsFilter_${currentCat.key}`;
      filterBtn.folderRef = element;
      filterBtn.iconPath = new vscode.ThemeIcon("filter");
      filterBtn.tooltip = "右クリックでフィルタを選択";

      // 現在フィルタの PR をフェッチ
      const fetchFn = this.buildPrFetchFn(org, repoId, currentCat.key);
      const cacheKey = `prs:${org}:${repoId}:category:${currentCat.key}`;
      const resolvedProjForPrs = await this.apiClient.resolveProjectName(org, element.projectId as string | undefined);
      const items = this.lazyLoadChildren<AdoPullRequest>(cacheKey, element, fetchFn, prs => prs.map(pr => this.makePullRequestTreeItem(pr, org, repoId, (element as any).repoName || "", resolvedProjForPrs)), "Loading pull requests...");
      return this.isLoaded(cacheKey) ? [filterBtn, ...items] : items;
    }

    return [];
  }

  // -----------------------
  // Public API
  // -----------------------
  /**
   * イテレーション内 Work Item を再取得する（現在のフィルタを維持）。
   * @param filterElement boardsFilter の AdoTreeItem
   */
  refreshIterationItems(filterElement: AdoTreeItem): void {
    const iterElement = filterElement.folderRef;
    if (!iterElement) return;
    const org = iterElement.organization;
    const pid = iterElement.projectId;
    const iterPath = iterElement.iterationPath;
    if (!org || !pid || iterPath === undefined) return;
    const categories = ["all", "assigned", "myactivity", "active"];
    const key = `${org}:${pid}:${iterPath}`;
    const idx = (this.iterationItemFilterState[key] || 0) % categories.length;
    const catKey = categories[idx];
    const cacheKey = `workitems:${org}:${pid}:iter:${iterPath}:${catKey}`;
    delete this.childrenCache[cacheKey];
    delete this.workItemChildrenMaps[cacheKey];
    delete this.childrenFetchPromises[cacheKey];
    this.childrenFetchTokens[cacheKey] = (this.childrenFetchTokens[cacheKey] || 0) + 1;
    this._onDidChangeTreeData.fire(iterElement);
  }

  /**
   * Pull Requests フィルタ行のリフレッシュ（現在のフィルタを維持）。
   * @param filterElement pullRequestsFilter の AdoTreeItem
   */
  refreshPrItems(filterElement: AdoTreeItem): void {
    const folderElement = filterElement.folderRef;
    if (!folderElement) return;
    const org = folderElement.organization;
    const repoId = folderElement.repoId;
    if (!org || !repoId) return;
    const prCategories = ["mine", "active", "completed", "abandoned"];
    const key = `${org}:${repoId}`;
    const idx = (this.prFilterState[key] || 0) % prCategories.length;
    const catKey = prCategories[idx];
    const cacheKey = `prs:${org}:${repoId}:category:${catKey}`;
    delete this.childrenCache[cacheKey];
    delete this.childrenFetchPromises[cacheKey];
    this.childrenFetchTokens[cacheKey] = (this.childrenFetchTokens[cacheKey] || 0) + 1;
    this._onDidChangeTreeData.fire(folderElement);
  }

  /**
   * イテレーション内 Work Item フィルタを次へ進める。
   * @param iterElement workItemsIteration の AdoTreeItem
   */
  cycleIterationItemFilter(iterElement: AdoTreeItem): void {
    const org = iterElement.organization;
    const pid = iterElement.projectId;
    const iterPath = iterElement.iterationPath;
    if (!org || !pid || iterPath === undefined) return;
    const key = `${org}:${pid}:${iterPath}`;
    const categoryCount = 4;
    this.iterationItemFilterState[key] = ((this.iterationItemFilterState[key] || 0) + 1) % categoryCount;
    this._onDidChangeTreeData.fire(iterElement);
  }

  /**
   * フィルタ状態を設定する汎用メソッド。キャッシュをクリアして再構成をトリガーする。
   * @param element フィルタ対象のツリーノード
   * @param index フィルタのインデックス（0 始まり）
   * @param filterState フィルタ状態を保持するオブジェクト
   * @param categories フィルタのカテゴリーリスト
   * @param buildCacheKey キャッシュキーを生成する関数
   * @returns キー文字列、または取得失敗時は null
   */
  private setFilter(element: AdoTreeItem, index: number, filterState: { [key: string]: number }, categories: string[], buildStateKey: () => string | null, buildCacheKey: (catKey: string) => string): void {
    const stateKey = buildStateKey();
    if (!stateKey) return;
    filterState[stateKey] = index;
    const catKey = categories[index];
    if (catKey) {
      const cacheKey = buildCacheKey(catKey);
      delete this.childrenCache[cacheKey];
      delete this.childrenFetchPromises[cacheKey];
      this.childrenFetchTokens[cacheKey] = (this.childrenFetchTokens[cacheKey] || 0) + 1;
    }
    this._onDidChangeTreeData.fire(element);
  }

  /**
   * イテレーション内 Work Item フィルタを指定インデックスに設定する。
   * @param iterElement workItemsIteration の AdoTreeItem
   * @param index フィルタのインデックス（0 始まり）
   */
  setIterationItemFilter(iterElement: AdoTreeItem, index: number): void {
    const org = iterElement.organization;
    const pid = iterElement.projectId;
    const iterPath = iterElement.iterationPath;
    const categories = ["all", "assigned", "myactivity", "active"];

    this.setFilter(
      iterElement,
      index,
      this.iterationItemFilterState,
      categories,
      () => (!org || !pid || iterPath === undefined ? null : `${org}:${pid}:${iterPath}`),
      catKey => `workitems:${org}:${pid}:iter:${iterPath}:${catKey}`,
    );
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
    const prCategories = ["mine", "active", "completed", "abandoned"];

    this.setFilter(
      folderElement,
      index,
      this.prFilterState,
      prCategories,
      () => (!org || !repoId ? null : `${org}:${repoId}`),
      catKey => `prs:${org}:${repoId}:category:${catKey}`,
    );
  }

  /**
   * 指定 Work Item ノードのアイコンと contextValue を新しいステート文字列で更新し、
   * そのノードだけ再描画する（ツリー全体の再取得は行わない）。
   */
  updateWorkItemNode(item: AdoTreeItem, newState: string): void {
    // オーバーライドを保存しておくことで、子ノードが再生成されてもキャッシュの古い状態で上書きされない
    const workItemId = item.workItemId ?? (item.id ? Number(String(item.id).split(":")[2]) : undefined);
    if (item.organization && workItemId && !isNaN(workItemId)) {
      this.workItemStateOverrides.set(`${item.organization}:${workItemId}`, newState);
    }
    const st = newState.toLowerCase();
    const isDone = st.includes("done") || st.includes("closed") || st.includes("resolved") || st.includes("complete");
    const isDoing = !isDone && (st.includes("active") || st.includes("in progress") || st.includes("doing"));
    if (isDone) {
      item.contextValue = "workitem_done";
      item.iconPath = new vscode.ThemeIcon("check", new vscode.ThemeColor("charts.blue"));
    } else if (isDoing) {
      item.contextValue = "workitem_doing";
      item.iconPath = new vscode.ThemeIcon("run", new vscode.ThemeColor("charts.red"));
    } else {
      item.contextValue = "workitem_todo";
      item.iconPath = new vscode.ThemeIcon("issues", new vscode.ThemeColor("charts.yellow"));
    }
    this._onDidChangeTreeData.fire(item);
  }

  /**
   * 指定 Work Item ノードの description（担当者）をその場で更新する。
   */
  updateWorkItemDescription(item: AdoTreeItem, description: string): void {
    item.description = description;
    this._onDidChangeTreeData.fire(item);
  }

  /**
   * ツリー全体を更新するヘルパー。
   */
  refresh(): void {
    this.workItemStateOverrides.clear();
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
      // ルートレベルのエラーシブリングも含めてツリー全体を再描画
      this._onDidChangeTreeData.fire(undefined);
    } else {
      this.childrenCache = {};
      this.childrenFetchPromises = {};
      this.childrenFetchTokens = {};
      this.workItemChildrenMaps = {};
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
   * 登録済み組織名の一覧を返します。
   */
  getOrganizations(): string[] {
    return [...this.organizations];
  }

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
  // Private Utilities - PR Fetch
  // -----------------------
  private buildPrFetchFn(org: string, repoId: string, catKey: string): () => Promise<AdoPullRequest[]> {
    switch (catKey) {
      case "mine":
        return () => this.apiClient.fetchPullRequestsMine(org, repoId);
      case "active":
        return () => this.apiClient.fetchPullRequestsByStatus(org, repoId, "active");
      case "completed":
        return () => this.apiClient.fetchPullRequestsByStatus(org, repoId, "completed");
      case "abandoned":
        return () => this.apiClient.fetchPullRequestsByStatus(org, repoId, "abandoned");
      default:
        return () => Promise.resolve([]);
    }
  }

  // -----------------------
  // Private Utilities - Lazy Loading
  // -----------------------
  /**
   * 汎用遅延ローダー。
   * - キャッシュ確認、in-flight 合流、未ロード時は非同期 fetch を開始してプレースホルダを返す。
   */
  private isLoaded(key: string): boolean {
    return this.childrenCache[key] !== undefined;
  }

  private lazyLoadChildren<T>(key: string, _element: AdoTreeItem, fetchFn: () => Promise<T[]>, toItems: (arr: T[]) => AdoTreeItem[], placeholderLabel: string = "Loading..."): AdoTreeItem[] {
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
        const orgMatch = key.match(/^[^:]+:([^:]+)/);
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
        const orgMatch = key.match(/^[^:]+:([^:]+)/);
        if (orgMatch) {
          const org = orgMatch[1];
          this.errorsByOrg[org] = msg;
          if (this.context) this.context.globalState.update("azuredevops.errorsByOrg", this.errorsByOrg);
        }
        return [];
      } finally {
        delete this.childrenFetchPromises[key];
        try {
          if (this.childrenFetchTokens[key] === token) {
            // ルートレベルのエラーシブリングも更新するため全体を再描画
            this._onDidChangeTreeData.fire(undefined);
          }
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
  /**
   * Work Item のステータスに基づいてアイコン設定と contextValue を適用します。
   * @param item 対象の AdoTreeItem
   * @param w Work Item データ
   */
  private applyWorkItemStyling(item: AdoTreeItem, w: AdoWorkItem): void {
    try {
      const overrideKey = `${item.organization}:${w.id}`;
      const override = this.workItemStateOverrides.get(overrideKey);
      const st = override ? override.toLowerCase() : (w as any).status ? String((w as any).status).toLowerCase() : "";
      const isDone = st.includes("done") || st.includes("closed") || st.includes("resolved") || st.includes("complete");
      const isDoing = !isDone && (st.includes("active") || st.includes("in progress") || st.includes("doing"));
      if (isDone) {
        item.contextValue = "workitem_done";
        item.iconPath = new vscode.ThemeIcon("check", new vscode.ThemeColor("charts.blue"));
      } else if (isDoing) {
        item.contextValue = "workitem_doing";
        item.iconPath = new vscode.ThemeIcon("run", new vscode.ThemeColor("charts.red"));
      } else {
        item.contextValue = "workitem_todo";
        item.iconPath = new vscode.ThemeIcon("issues", new vscode.ThemeColor("charts.yellow"));
      }
    } catch (e) {}
  }

  private makeWorkItemTreeItem(w: AdoWorkItem, org: string, projectId?: string): AdoTreeItem {
    const it = new AdoTreeItem(`#${w.id} ${w.title}`, vscode.TreeItemCollapsibleState.None);
    it.itemType = "workItem";
    it.organization = org;
    it.projectId = projectId;
    it.id = `work:${org}:${w.id}`;
    it.contextValue = "workitem";
    this.applyWorkItemStyling(it, w);
    it.url = w.url;
    it.tooltip = w.url || w.title;
    try {
      it.description = (w as any).assignee || "";
    } catch (e) {}
    return it;
  }

  /** イテレーション内の親子階層で使う Work Item ノードを作成する */
  private makeWorkItemHierarchyItem(w: AdoWorkItem, org: string, projectId: string | undefined, iterCacheKey: string, childrenMap: Map<number, AdoWorkItem[]>): AdoTreeItem {
    const children = childrenMap.get(w.id) || [];
    const state = children.length > 0 ? vscode.TreeItemCollapsibleState.Collapsed : vscode.TreeItemCollapsibleState.None;
    const it = new AdoTreeItem(`#${w.id} ${w.title}`, state);
    it.itemType = "workItem";
    it.organization = org;
    it.projectId = projectId;
    it.id = `work:${org}:${w.id}:iter:${iterCacheKey}`;
    it.workItemId = w.id;
    it.iterationCacheKey = iterCacheKey;
    it.contextValue = "workitem";
    this.applyWorkItemStyling(it, w);
    it.url = w.url;
    it.tooltip = w.url || w.title;
    try {
      it.description = w.assignee || "";
    } catch (e) {}
    return it;
  }

  /** Work Item リストを親子階層に変換し、ルートノードの配列を返す */
  private buildWorkItemHierarchy(workItems: AdoWorkItem[], org: string, projectId: string | undefined, cacheKey: string): AdoTreeItem[] {
    const itemMap = new Map<number, AdoWorkItem>();
    for (const w of workItems) itemMap.set(w.id, w);

    const childrenMap = new Map<number, AdoWorkItem[]>();
    const roots: AdoWorkItem[] = [];
    for (const w of workItems) {
      if (w.parentId && itemMap.has(w.parentId)) {
        // 親がこのリスト内に存在する場合のみ、子として登録
        if (!childrenMap.has(w.parentId)) childrenMap.set(w.parentId, []);
        childrenMap.get(w.parentId)!.push(w);
      } else {
        // 親がない場合、またはリスト内に親が存在しない場合、ルートとして登録
        roots.push(w);
      }
    }
    // デバッグ情報をログ出力
    if (roots.length > 0) {
      const rootIds = roots.map(r => `#${r.id}(parent:${r.parentId})`).join(", ");
      this.channel?.appendLine(`buildWorkItemHierarchy: ${roots.length} roots: [${rootIds}], total items: ${workItems.length}, children: ${childrenMap.size}`);
    }
    // ショートカットで一応イテレーション内の全 WorkItem分 childrenMap を保存（子層ノードの getChildren で使う）
    this.workItemChildrenMaps[cacheKey] = childrenMap;
    return roots.map(w => this.makeWorkItemHierarchyItem(w, org, projectId, cacheKey, childrenMap));
  }

  /** イテレーションノードを作成する */
  private makeIterationTreeItem(iter: AdoIteration, org: string, projectId?: string): AdoTreeItem {
    const it = new AdoTreeItem(iter.name, vscode.TreeItemCollapsibleState.Collapsed);
    it.itemType = "boardsIteration";
    it.organization = org;
    it.projectId = projectId;
    it.id = `iteration:${org}:${projectId}:${iter.id}`;
    it.contextValue = "boardsIteration";
    it.iconPath = new vscode.ThemeIcon("calendar", new vscode.ThemeColor("charts.blue"));
    it.iterationPath = iter.path;
    if (iter.startDate && iter.finishDate) {
      const start = iter.startDate.slice(0, 10);
      const finish = iter.finishDate.slice(0, 10);
      it.tooltip = `${start} → ${finish}`;
      it.description = `${start} → ${finish}`;
    }
    try {
      if (org && projectId && iter.path) {
        const teamName = `${projectId} Team`;
        it.url = `https://dev.azure.com/${encodeURIComponent(org)}/${encodeURIComponent(projectId)}/_sprints/taskboard/${encodeURIComponent(teamName)}/${iter.path.split("\\").map(encodeURIComponent).join("/")}`;
      }
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
    it.defaultBranch = r.defaultBranch ? r.defaultBranch.replace(/^refs\/heads\//, "") : undefined;
    it.iconPath = new vscode.ThemeIcon("repo", new vscode.ThemeColor(this.isRepoInWorkspace(r.name) ? "charts.green" : "charts.blue"));
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

  private makeBranchTreeItem(b: AdoBranch, org: string, repoId: string, repoName: string, resolvedProj: string | undefined, pid?: string, defaultBranch?: string): AdoTreeItem {
    const name = String(b.name).replace(/^refs\/heads\//, "");
    const it = new AdoTreeItem(name, vscode.TreeItemCollapsibleState.None);
    it.itemType = "branch";
    it.organization = org;
    it.id = `branch:${org}:${repoId}:${name}`;
    it.branchName = name;
    it.defaultBranch = defaultBranch;
    it.repoId = repoId;
    it.repoName = repoName;
    it.projectId = pid;
    it.contextValue = "branch";
    it.iconPath = new vscode.ThemeIcon("git-branch", new vscode.ThemeColor(this.isRepoInWorkspace(repoName) ? "charts.green" : "charts.blue"));
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
    it.iconPath = new vscode.ThemeIcon("git-merge", new vscode.ThemeColor(this.isRepoInWorkspace(repoName) ? "charts.green" : "charts.blue"));
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
    return `ado-ext.pat.${org}`;
  }

  // -----------------------
  // Private Utilities - Local Repo Check
  // -----------------------
  private isRepoInWorkspace(repoName: string): boolean {
    return findLocalRepo(repoName) !== undefined;
  }
}
