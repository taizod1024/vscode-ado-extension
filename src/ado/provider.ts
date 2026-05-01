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
   * 現在のプロファイル情報を取得します（cache あり）。
   */
  private currentProfileCache: any | undefined;
  private async fetchCurrentProfile(organization: string, pat?: string): Promise<any> {
    if (this.currentProfileCache) return this.currentProfileCache;
    const key = this.patKeyForOrg(organization);
    let usePat = pat;
    if (!usePat && this.context) usePat = (await this.context.secrets.get(key)) || undefined;
    if (!usePat) {
      const entered = await this.promptAndStorePat(organization);
      if (!entered) return undefined;
      usePat = entered;
    }
    // profile API (global)
    const url = `https://app.vssps.visualstudio.com/_apis/profile/profiles/me?api-version=6.0`;
    try {
      const data = await httpRequest("GET", url, usePat);
      this.currentProfileCache = data;
      return data;
    } catch (e) {
      return undefined;
    }
  }

  private async fetchPullRequestsByStatus(organization: string, repoIdOrName: string, status: string, pat?: string): Promise<AdoPullRequest[]> {
    const key = this.patKeyForOrg(organization);
    let usePat = pat;
    if (!usePat && this.context) usePat = (await this.context.secrets.get(key)) || undefined;
    const url = `https://dev.azure.com/${encodeURIComponent(organization)}/_apis/git/pullrequests?searchCriteria.repositoryId=${encodeURIComponent(repoIdOrName)}&searchCriteria.status=${encodeURIComponent(status)}&api-version=6.0`;
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
        const web = pr._links?.web?.href || undefined;
        const apiUrl = pr.url || pr._links?.self?.href || "";
        out.push({ pullRequestId: Number(pr.pullRequestId || pr.id), title: String(pr.title || ""), url: apiUrl, webUrl: web, status: pr.status, createdBy: pr.createdBy });
      }
    }
    return out;
  }

  private async fetchPullRequestsMine(organization: string, repoIdOrName: string, pat?: string): Promise<AdoPullRequest[]> {
    // fetch all PRs for the repo (may be limited by API) and filter by createdBy == me
    const key = this.patKeyForOrg(organization);
    let usePat = pat;
    if (!usePat && this.context) usePat = (await this.context.secrets.get(key)) || undefined;
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
    const profile = await this.fetchCurrentProfile(organization, usePat);
    const myId = profile?.id || profile?.identifier || profile?.displayName || profile?.uniqueName;
    const out: AdoPullRequest[] = [];
    if (data && Array.isArray(data.value)) {
      for (const pr of data.value) {
        const createdBy = pr.createdBy || {};
        const createdId = createdBy.id || createdBy.uniqueName || createdBy.displayName || createdBy.descriptor;
        if (!myId || String(createdId) === String(myId) || String(createdBy.uniqueName || "").toLowerCase() === String(profile?.uniqueName || "").toLowerCase()) {
          const web = pr._links?.web?.href || undefined;
          const apiUrl = pr.url || pr._links?.self?.href || "";
          out.push({ pullRequestId: Number(pr.pullRequestId || pr.id), title: String(pr.title || ""), url: apiUrl, webUrl: web, status: pr.status, createdBy });
        }
      }
    }
    return out;
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
            // store project name as projectId to ensure downstream WIQL uses project name
            it.projectId = p.name;
            it.id = `proj:${org}:${p.id}`;
            it.contextValue = "adoProject";
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
          fetchFn = async () => await this.fetchAssignedToMe(org, pid);
          break;
        case "following":
          fetchFn = async () => await this.fetchFollowing(org, pid);
          break;
        case "mentioned":
          fetchFn = async () => await this.fetchMentioned(org, pid);
          break;
        case "myactivity":
          fetchFn = async () => await this.fetchMyActivity(org, pid);
          break;
        case "recentlyUpdated":
          fetchFn = async () => await this.fetchRecentlyUpdated(org, pid);
          break;
        case "recentlyCompleted":
          fetchFn = async () => await this.fetchRecentlyCompleted(org, pid);
          break;
        case "recentlyCreated":
          fetchFn = async () => await this.fetchRecentlyCreated(org, pid);
          break;
        default:
          fetchFn = async () => [];
      }

      return this.lazyLoadChildren<AdoWorkItem>(
        cacheKey,
        element,
        fetchFn,
        items =>
          items.map(w => {
            const it = new AdoTreeItem(`#${w.id} ${w.title}`, vscode.TreeItemCollapsibleState.None);
            it.itemType = "workItem";
            it.organization = org;
            it.id = `work:${org}:${w.id}`;
            it.contextValue = "workitem";
            try {
              const st = (w as any).status ? String((w as any).status).toLowerCase() : "";
              if (st.includes("done") || st.includes("closed") || st.includes("resolved") || st.includes("complete")) {
                it.iconPath = new vscode.ThemeIcon("check");
              } else if (st.includes("active") || st.includes("in progress") || st.includes("doing")) {
                it.iconPath = new vscode.ThemeIcon("run");
              } else {
                it.iconPath = new vscode.ThemeIcon("issues");
              }
            } catch (e) {}
            it.url = w.url;
            it.tooltip = w.url || w.title;
            // show work item description faintly after title when available
            try {
              it.description = (w as any).assignee || "";
            } catch (e) {}
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
            it.repoId = r.id;
            it.repoName = r.name;
            it.id = `repo:${org}:${r.id}`;
            it.contextValue = "repo";
            it.projectId = pid;
            it.iconPath = new vscode.ThemeIcon("repo");
            // prefer constructing a web URL with organization as username prefix and trailing '?' per user preference
            try {
              const projName = pid || "";
              const repoName = r.name || "";
              if (projName && repoName) {
                it.url = `https://dev.azure.com/${encodeURIComponent(org)}/${encodeURIComponent(projName)}/_git/${encodeURIComponent(repoName)}`;
                it.tooltip = it.url;
              } else {
                it.url = r.url || "";
                it.tooltip = r.url;
              }
            } catch (e) {
              it.url = r.url || "";
              it.tooltip = r.url;
            }
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
        if (projNameForUrl && repoNameForUrl) {
          prsFolder.url = `https://dev.azure.com/${encodeURIComponent(org)}/${encodeURIComponent(projNameForUrl)}/_git/${encodeURIComponent(repoNameForUrl)}/pullrequests?_a=mine`;
        }
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
            // construct branch web URL if possible
            let projName = "";
            if (element.projectId) {
              const projs = this.projectsByOrg[org] || [];
              const found = projs.find(pp => pp.id === element.projectId || pp.name === element.projectId);
              if (found) projName = found.name;
            }
            const repoNameForUrl = repoName || repoId || "";
            if (projName && repoNameForUrl) {
              it.url = `https://dev.azure.com/${encodeURIComponent(org)}/${encodeURIComponent(projName)}/_git/${encodeURIComponent(repoNameForUrl)}?version=GB${encodeURIComponent(name)}`;
            }
            return it;
          }),
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
          fetchFn = async () => await this.fetchPullRequestsMine(org, repoId);
          break;
        case "active":
          fetchFn = async () => await this.fetchPullRequestsByStatus(org, repoId, "active");
          break;
        case "completed":
          fetchFn = async () => await this.fetchPullRequestsByStatus(org, repoId, "completed");
          break;
        case "abandoned":
          fetchFn = async () => await this.fetchPullRequestsByStatus(org, repoId, "abandoned");
          break;
        default:
          fetchFn = async () => [];
      }

      return this.lazyLoadChildren<AdoPullRequest>(
        cacheKey,
        element,
        fetchFn,
        prs =>
          prs.map(pr => {
            const label = `!${pr.pullRequestId} ${pr.title}`;
            const it = new AdoTreeItem(label, vscode.TreeItemCollapsibleState.None);
            it.itemType = "pullRequest";
            it.organization = org;
            it.id = `pr:${org}:${repoId}:${pr.pullRequestId}`;
            it.contextValue = "pullrequest";
            it.iconPath = new vscode.ThemeIcon("git-merge");
            // Prefer webUrl from API; if absent and the stored url looks like an API endpoint, try to construct a web URL
            const candidate = pr.webUrl || pr.url || "";
            if (candidate && candidate.includes("/_apis/")) {
              // attempt to construct web link using project and repo name when available
              let projName = "";
              try {
                if (pid) {
                  const projs = this.projectsByOrg[org] || [];
                  const found = projs.find(pp => pp.id === pid || pp.name === pid || pp.name === String(pid));
                  if (found) projName = found.name;
                }
              } catch (e) {}
              const repoName = (element as any).repoName || "";
              if (projName && repoName) {
                it.url = `https://dev.azure.com/${encodeURIComponent(org)}/${encodeURIComponent(projName)}/_git/${encodeURIComponent(repoName)}/pullrequest/${encodeURIComponent(String(pr.pullRequestId))}`;
              } else {
                it.url = candidate;
              }
            } else {
              it.url = candidate;
            }
            it.tooltip = pr.title;
            try {
              const created = (pr as any).createdBy || {};
              let author = "";
              if (created) {
                if (typeof created === "string") author = created;
                else if ((created as any).displayName) author = String((created as any).displayName);
                else if ((created as any).uniqueName) author = String((created as any).uniqueName);
                else author = String(created);
              }
              it.description = author || "";
            } catch (e) {}
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

      // 組織のプロジェクトキャッシュと関連する children キャッシュ／in-flight を削除して再フェッチ
      delete this.projectsByOrg[org];
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
      try {
        await this.fetchProjects(org);
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

  /**
   * 共通: ノードのロード開始処理（アイコン差し替え・タイマー設定）
   */
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

  /**
   * 共通: ノードのロード終了処理（タイマー・アイコン復元）
   */
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
    if (this.context) this.context.workspaceState.update("azuredevops.organizations", this.organizations);
    this.projectsByOrg = {};
    this.projectsFetchPromises = {};
    this.childrenCache = {};
    this.childrenFetchPromises = {};
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
        // construct web URL for work item
        const wid = Number(d.id);
        let webUrl = d.url || "";
        if (projectName) {
          webUrl = `https://dev.azure.com/${encodeURIComponent(organization)}/${encodeURIComponent(projectName)}/_workitems/edit/${encodeURIComponent(String(wid))}`;
        }
        const state = String(d.fields?.["System.State"] || d.fields?.["State"] || "");
        // extract assignee
        let assignedField = d.fields?.["System.AssignedTo"] || d.fields?.["Assigned To"] || "";
        let assignee = "";
        try {
          if (assignedField) {
            if (typeof assignedField === "string") assignee = assignedField;
            else if ((assignedField as any).displayName) assignee = String((assignedField as any).displayName);
            else if ((assignedField as any).uniqueName) assignee = String((assignedField as any).uniqueName);
            else assignee = String(assignedField);
          }
        } catch (e) {
          assignee = "";
        }
        items.push({ id: wid, title: String(d.fields?.["System.Title"] || d.fields?.["Title"] || "(no title)"), url: webUrl, status: state, assignee });
      }
    }
    return items;
  }

  /**
   * 汎用: WIQL を実行して Work Items の詳細を取得します。
   * @param organization 組織名
   * @param wiql WIQL クエリ文字列（SELECT .. WHERE ..）
   * @param projectIdOrName プロジェクト名または ID（省略可）
   */
  private async fetchWorkItemsByWiql(organization: string, wiql: string, projectIdOrName?: string, pat?: string): Promise<AdoWorkItem[]> {
    const key = this.patKeyForOrg(organization);
    let usePat = pat;
    if (!usePat && this.context) usePat = (await this.context.secrets.get(key)) || undefined;

    // Resolve project name if possible. If given id is a GUID and resolution fails,
    // omit TeamProject filter because WIQL expects project name.
    let projectName = projectIdOrName || "";
    if (projectIdOrName) {
      const findProj = () => (this.projectsByOrg[organization] || []).find(p => p.id === projectIdOrName || p.name === projectIdOrName);
      let proj = findProj();
      if (!proj) {
        try {
          await this.fetchProjects(organization);
        } catch (e) {}
        proj = findProj();
      }
      if (proj && proj.name) {
        projectName = proj.name;
      } else {
        // if looks like GUID, log and clear projectName so caller omits TeamProject filter
        if (/^[0-9a-fA-F-]{32,36}$/.test(String(projectIdOrName))) {
          console.log(`ado-assist: provided project identifier appears to be GUID and could not be resolved to name: ${projectIdOrName}`);
          projectName = "";
        }
      }
    }

    const wiqlUrl = `https://dev.azure.com/${encodeURIComponent(organization)}/_apis/wit/wiql?api-version=6.0`;
    const queryBody = { query: wiql };
    let wiqlResult: any;
    if (usePat) {
      wiqlResult = await httpRequest("POST", wiqlUrl, usePat, queryBody);
    } else {
      const entered = await this.promptAndStorePat(organization);
      if (!entered) return [];
      usePat = entered;
      wiqlResult = await httpRequest("POST", wiqlUrl, usePat, queryBody);
    }

    const ids = (wiqlResult?.workItems || [])
      .slice(0, 50)
      .map((w: any) => w.id)
      .filter(Boolean);
    if (ids.length === 0) return [];
    const idsStr = ids.join(",");
    const detailsUrl = `https://dev.azure.com/${encodeURIComponent(organization)}/_apis/wit/workitems?ids=${encodeURIComponent(idsStr)}&api-version=6.0`;
    const details = await httpRequest("GET", detailsUrl, usePat || "");
    const items: AdoWorkItem[] = [];
    if (details && Array.isArray(details.value)) {
      for (const d of details.value) {
        const wid = Number(d.id);
        let webUrl = d.url || "";
        if (projectName) {
          webUrl = `https://dev.azure.com/${encodeURIComponent(organization)}/${encodeURIComponent(projectName)}/_workitems/edit/${encodeURIComponent(String(wid))}`;
        }
        const state = String(d.fields?.["System.State"] || d.fields?.["State"] || "");
        let rawDesc = d.fields?.["System.Description"] || d.fields?.["Description"] || "";
        if (rawDesc && typeof rawDesc === "string") {
          rawDesc = rawDesc.replace(/<[^>]*>/g, "").replace(/\s+/g, " ").trim();
        } else {
          rawDesc = "";
        }
        const shortDesc = rawDesc.length > 200 ? rawDesc.slice(0, 197) + "..." : rawDesc;
        // extract assignee
        let assignedField = d.fields?.["System.AssignedTo"] || d.fields?.["Assigned To"] || "";
        let assignee = "";
        try {
          if (assignedField) {
            if (typeof assignedField === "string") assignee = assignedField;
            else if ((assignedField as any).displayName) assignee = String((assignedField as any).displayName);
            else if ((assignedField as any).uniqueName) assignee = String((assignedField as any).uniqueName);
            else assignee = String(assignedField);
          }
        } catch (e) {
          assignee = "";
        }
        items.push({ id: wid, title: String(d.fields?.["System.Title"] || d.fields?.["Title"] || "(no title)"), url: webUrl, status: state, assignee, description: shortDesc });
      }
    }
    return items;
  }

  // -----------------------
  // 高レベル: ユーザーが求めるカテゴリ別 Work Item 抽出
  // -----------------------
  async fetchAssignedToMe(organization: string, projectIdOrName?: string, pat?: string): Promise<AdoWorkItem[]> {
    let projName = projectIdOrName || "";
    if (projectIdOrName && (!this.projectsByOrg[organization] || this.projectsByOrg[organization].length === 0)) {
      try {
        await this.fetchProjects(organization);
      } catch (e) {}
      const proj = (this.projectsByOrg[organization] || []).find(p => p.id === projectIdOrName || p.name === projectIdOrName);
      if (proj && proj.name) projName = proj.name;
    }
    const clauses: string[] = [];
    if (projName) clauses.push(`[System.TeamProject] = '${String(projName).replace(/'/g, "''")}'`);
    clauses.push(`[System.AssignedTo] = @Me`);
    const where = clauses.length ? `Where ${clauses.join(" AND ")}` : "";
    const q = `Select [System.Id], [System.Title] From WorkItems ${where} Order By [System.ChangedDate] Desc`;
    const res = await this.fetchWorkItemsByWiql(organization, q, projName, pat);
    if (!res || res.length === 0) console.log(`ado-assist: WIQL assigned result empty for org=${organization} proj=${projName} query=${q}`);
    return res;
  }

  async fetchFollowing(organization: string, projectIdOrName?: string, pat?: string): Promise<AdoWorkItem[]> {
    // ADO には WIQL で「followed」を直接検索する明確なフィールドがないため、代替としてタグに "follow" を含むものを取得する試みを行う。
    let projName = projectIdOrName || "";
    if (projectIdOrName && (!this.projectsByOrg[organization] || this.projectsByOrg[organization].length === 0)) {
      try {
        await this.fetchProjects(organization);
      } catch (e) {}
      const proj = (this.projectsByOrg[organization] || []).find(p => p.id === projectIdOrName || p.name === projectIdOrName);
      if (proj && proj.name) projName = proj.name;
    }
    const clauses: string[] = [];
    if (projName) clauses.push(`[System.TeamProject] = '${String(projName).replace(/'/g, "''")}'`);
    clauses.push(`[System.Tags] CONTAINS 'follow'`);
    const where = clauses.length ? `Where ${clauses.join(" AND ")}` : "";
    const q = `Select [System.Id], [System.Title] From WorkItems ${where} Order By [System.ChangedDate] Desc`;
    const res = await this.fetchWorkItemsByWiql(organization, q, projName, pat);
    if (!res || res.length === 0) console.log(`ado-assist: WIQL following result empty for org=${organization} proj=${projName} query=${q}`);
    return res;
  }

  async fetchMentioned(organization: string, projectIdOrName?: string, pat?: string): Promise<AdoWorkItem[]> {
    // コメントや履歴内で @mention を検索するには通常 Comments API を使うが、WIQL の History フィールドの CONTAINS を使って簡易検索する
    let projName = projectIdOrName || "";
    if (projectIdOrName && (!this.projectsByOrg[organization] || this.projectsByOrg[organization].length === 0)) {
      try {
        await this.fetchProjects(organization);
      } catch (e) {}
      const proj = (this.projectsByOrg[organization] || []).find(p => p.id === projectIdOrName || p.name === projectIdOrName);
      if (proj && proj.name) projName = proj.name;
    }
    const clauses: string[] = [];
    if (projName) clauses.push(`[System.TeamProject] = '${String(projName).replace(/'/g, "''")}'`);
    clauses.push(`[System.History] CONTAINS '@'`);
    const where = clauses.length ? `Where ${clauses.join(" AND ")}` : "";
    const q = `Select [System.Id], [System.Title] From WorkItems ${where} Order By [System.ChangedDate] Desc`;
    const res = await this.fetchWorkItemsByWiql(organization, q, projName, pat);
    if (!res || res.length === 0) console.log(`ado-assist: WIQL mentioned result empty for org=${organization} proj=${projName} query=${q}`);
    return res;
  }

  async fetchMyActivity(organization: string, projectIdOrName?: string, pat?: string): Promise<AdoWorkItem[]> {
    let projName = projectIdOrName || "";
    if (projectIdOrName && (!this.projectsByOrg[organization] || this.projectsByOrg[organization].length === 0)) {
      try {
        await this.fetchProjects(organization);
      } catch (e) {}
      const proj = (this.projectsByOrg[organization] || []).find(p => p.id === projectIdOrName || p.name === projectIdOrName);
      if (proj && proj.name) projName = proj.name;
    }
    const clauses: string[] = [];
    if (projName) clauses.push(`[System.TeamProject] = '${String(projName).replace(/'/g, "''")}'`);
    clauses.push(`([System.ChangedBy] = @Me OR [System.CreatedBy] = @Me OR [System.AssignedTo] = @Me)`);
    const where = clauses.length ? `Where ${clauses.join(" AND ")}` : "";
    const q = `Select [System.Id], [System.Title] From WorkItems ${where} Order By [System.ChangedDate] Desc`;
    const res = await this.fetchWorkItemsByWiql(organization, q, projName, pat);
    if (!res || res.length === 0) console.log(`ado-assist: WIQL myactivity result empty for org=${organization} proj=${projName} query=${q}`);
    return res;
  }

  async fetchRecentlyUpdated(organization: string, projectIdOrName?: string, pat?: string): Promise<AdoWorkItem[]> {
    let projName = projectIdOrName || "";
    if (projectIdOrName && (!this.projectsByOrg[organization] || this.projectsByOrg[organization].length === 0)) {
      try {
        await this.fetchProjects(organization);
      } catch (e) {}
      const proj = (this.projectsByOrg[organization] || []).find(p => p.id === projectIdOrName || p.name === projectIdOrName);
      if (proj && proj.name) projName = proj.name;
    }
    const clauses: string[] = [];
    if (projName) clauses.push(`[System.TeamProject] = '${String(projName).replace(/'/g, "''")}'`);
    const where = clauses.length ? `Where ${clauses.join(" AND ")}` : "";
    const q = `Select [System.Id], [System.Title] From WorkItems ${where} Order By [System.ChangedDate] Desc`;
    const res = await this.fetchWorkItemsByWiql(organization, q, projName, pat);
    if (!res || res.length === 0) console.log(`ado-assist: WIQL recentlyUpdated result empty for org=${organization} proj=${projName} query=${q}`);
    return res;
  }

  async fetchRecentlyCompleted(organization: string, projectIdOrName?: string, pat?: string): Promise<AdoWorkItem[]> {
    let projName = projectIdOrName || "";
    if (projectIdOrName && (!this.projectsByOrg[organization] || this.projectsByOrg[organization].length === 0)) {
      try {
        await this.fetchProjects(organization);
      } catch (e) {}
      const proj = (this.projectsByOrg[organization] || []).find(p => p.id === projectIdOrName || p.name === projectIdOrName);
      if (proj && proj.name) projName = proj.name;
    }
    const clauses: string[] = [];
    if (projName) clauses.push(`[System.TeamProject] = '${String(projName).replace(/'/g, "''")}'`);
    clauses.push(`([System.State] = 'Done' OR [System.State] = 'Closed' OR [System.State] = 'Resolved' OR [System.State] = 'Completed')`);
    const where = clauses.length ? `Where ${clauses.join(" AND ")}` : "";
    const q = `Select [System.Id], [System.Title] From WorkItems ${where} Order By [System.ChangedDate] Desc`;
    const res = await this.fetchWorkItemsByWiql(organization, q, projName, pat);
    if (!res || res.length === 0) console.log(`ado-assist: WIQL recentlyCompleted result empty for org=${organization} proj=${projName} query=${q}`);
    return res;
  }

  async fetchRecentlyCreated(organization: string, projectIdOrName?: string, pat?: string): Promise<AdoWorkItem[]> {
    let projName = projectIdOrName || "";
    if (projectIdOrName && (!this.projectsByOrg[organization] || this.projectsByOrg[organization].length === 0)) {
      try {
        await this.fetchProjects(organization);
      } catch (e) {}
      const proj = (this.projectsByOrg[organization] || []).find(p => p.id === projectIdOrName || p.name === projectIdOrName);
      if (proj && proj.name) projName = proj.name;
    }
    const clauses: string[] = [];
    if (projName) clauses.push(`[System.TeamProject] = '${String(projName).replace(/'/g, "''")}'`);
    const where = clauses.length ? `Where ${clauses.join(" AND ")}` : "";
    const q = `Select [System.Id], [System.Title] From WorkItems ${where} Order By [System.CreatedDate] Desc`;
    const res = await this.fetchWorkItemsByWiql(organization, q, projName, pat);
    if (!res || res.length === 0) console.log(`ado-assist: WIQL recentlyCreated result empty for org=${organization} proj=${projName} query=${q}`);
    return res;
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
