import * as vscode from "vscode";

export class AzureDevOpsTreeItem extends vscode.TreeItem {
  // custom metadata
  id?: string;
  itemType?: string; // 'project' | 'category' | 'repo' | 'pipeline' | 'error' | 'loading'
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

export class AzureDevOpsTreeProvider implements vscode.TreeDataProvider<AzureDevOpsTreeItem> {
  private _onDidChangeTreeData: vscode.EventEmitter<AzureDevOpsTreeItem | undefined | null | void> = new vscode.EventEmitter();
  readonly onDidChangeTreeData: vscode.Event<AzureDevOpsTreeItem | undefined | null | void> = this._onDidChangeTreeData.event;
  private projectsByOrg: { [org: string]: AdoProject[] } = {};
  private loadingNodes: { [id: string]: boolean } = {};
  private reposByProject: { [key: string]: AzureDevOpsTreeItem[] } = {};
  private branchesByRepo: { [key: string]: AzureDevOpsTreeItem[] } = {};
  private prsByScope: { [key: string]: AzureDevOpsTreeItem[] } = {};
  private workItemsByProject: { [key: string]: AzureDevOpsTreeItem[] } = {};
  private context: vscode.ExtensionContext | undefined;
  private loadingOrg?: string;
  private errorsByOrg: { [org: string]: string } = {};
  private orgDescriptions: { [org: string]: string } = {};
  private projectsFetchPromises: { [org: string]: Promise<AdoProject[]> } = {};
  private projectsCache: { [org: string]: { ts: number; projects: AdoProject[] } } = {};
  private projectsCacheExpiryMs = 5000; // short-lived in-memory cache to avoid rapid repeated requests
  private reposFetchPromises: { [key: string]: Promise<AzureDevOpsTreeItem[]> } = {};
  private prsFetchPromises: { [key: string]: Promise<AzureDevOpsTreeItem[]> } = {};
  private branchesFetchPromises: { [key: string]: Promise<AzureDevOpsTreeItem[]> } = {};
  private workItemsFetchPromises: { [key: string]: Promise<AzureDevOpsTreeItem[]> } = {};
  private loadingTimers: { [id: string]: NodeJS.Timeout } = {};

  constructor(context?: vscode.ExtensionContext) {
    this.context = context;
    // try to load cached projects from workspaceState
    if (this.context) {
      // do not persist project lists or descriptions; only load organizations and errors
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

  getTreeItem(element: AzureDevOpsTreeItem): vscode.TreeItem {
    // loading state indicated by child '(loading...)' items; do not override item icons
    return element;
  }

  // (debug helper removed)

  async getChildren(element?: AzureDevOpsTreeItem): Promise<AzureDevOpsTreeItem[]> {
    // getChildren called
    if (!element) {
      // action buttons at the top
      const actions: AzureDevOpsTreeItem[] = [];
      // (removed global Fetch Projects — use per-organization fetch under each organization)

      // root-level Save PAT and Refresh Projects removed — per-org fetch only

      // organization nodes after actions — make organizations the root entries
      const orgItems: AzureDevOpsTreeItem[] = [];
      for (const o of this.organizations) {
        const it = new AzureDevOpsTreeItem(o, vscode.TreeItemCollapsibleState.Collapsed);
        it.itemType = "organization";
        it.organization = o;
        it.id = `org:${o}`;
        it.contextValue = "organization";
        it.iconPath = new vscode.ThemeIcon("organization");
        // set organization web URL so inline/open commands can open it
        it.url = `https://dev.azure.com/${encodeURIComponent(o)}`;
        // do not set click command on the label — opening the web page is handled by the inline action
        // tooltip default to URL; fetch org description in background (do not await)
        it.tooltip = it.url;
        (async () => {
          try {
            if (this.context) {
              const key = this.patKeyForOrg(o);
              const storedPat = await this.context.secrets.get(key);
              if (storedPat) {
                try {
                  const orgMetaUrl = `https://dev.azure.com/${encodeURIComponent(o)}/_apis/organization?api-version=6.0`;
                  const orgMeta = await getJson(orgMetaUrl, storedPat || "");
                  const orgDesc = orgMeta?.description || orgMeta?.displayName || orgMeta?.name || "";
                  if (orgDesc) {
                    it.tooltip = String(orgDesc);
                    this.refresh();
                  }
                } catch (e) {
                  // ignore per-org fetch errors
                }
              }
            }
          } catch (e) {
            // ignore
          }
        })();
        orgItems.push(it);
      }

      // per-org loading/error handled when expanding each organization

      if (orgItems.length === 0) {
        return actions.concat([new AzureDevOpsTreeItem("(no organizations)")]);
      }

      return actions.concat(orgItems);
    }

    // element-specific children
    // if this node is currently loading due to a refresh, show loading indicator only
    if (element && element.id && this.loadingNodes[element.id]) {
      const it = new AzureDevOpsTreeItem("(loading...)", vscode.TreeItemCollapsibleState.None);
      it.itemType = "loading";
      it.iconPath = new vscode.ThemeIcon("sync~spin");
      return [it];
    }
    if (element.itemType === "organization") {
      const org = element.organization as string;
      // if this org is loading, show loading indicator
      if (this.loadingOrg === org) {
        const it = new AzureDevOpsTreeItem("(loading...)", vscode.TreeItemCollapsibleState.None);
        it.itemType = "loading";
        it.iconPath = new vscode.ThemeIcon("sync~spin");
        return [it];
      }
      // if this org had an error, show it
      if (this.errorsByOrg[org]) {
        const it = new AzureDevOpsTreeItem(`(error) ${this.errorsByOrg[org]}`, vscode.TreeItemCollapsibleState.None);
        it.itemType = "error";
        it.iconPath = new vscode.ThemeIcon("error");
        return [it];
      }
      // fetch projects each time (caching disabled)
      try {
        const projects = await this.fetchProjects(org);
        if (!projects || projects.length === 0) return [new AzureDevOpsTreeItem("(no projects)")];
        const items = projects.map(p => {
          const it = new AzureDevOpsTreeItem(p.name, vscode.TreeItemCollapsibleState.Collapsed);
          it.itemType = "project";
          it.projectId = p.id;
          it.url = p.url;
          it.organization = org;
          it.id = `project:${org}:${p.id}`;
          it.iconPath = new vscode.ThemeIcon("server-environment");
          it.contextValue = "adoProject";
          it.tooltip = p.description || p.url;
          return it;
        });
        return items;
      } catch (e) {
        return [new AzureDevOpsTreeItem("(failed to load projects)")];
      }
    }

    if (element.itemType === "project") {
      // project expand for: log suppressed
      const org = element.organization as string;
      // Do not auto-fetch full project list here — rely on organization expand to populate projectsByOrg.
      // prefetch project-scoped dynamic children sequentially and cache them
      try {
        await this.prefetchProjectData(org, element.projectId as string);
      } catch (e) {
        // ignore; category handlers will show errors if needed
      }

      // categories under project
      const repos = new AzureDevOpsTreeItem("Repositories", vscode.TreeItemCollapsibleState.Collapsed);
      repos.itemType = "category";
      repos.projectId = element.projectId;
      repos.organization = element.organization;
      repos.contextValue = "category";
      repos.id = `category:${element.organization}:${element.projectId}:repositories`;
      repos.iconPath = new vscode.ThemeIcon("files");

      const boards = new AzureDevOpsTreeItem("Boards", vscode.TreeItemCollapsibleState.Collapsed);
      boards.itemType = "category";
      boards.projectId = element.projectId;
      boards.organization = element.organization;
      boards.contextValue = "category";
      boards.id = `category:${element.organization}:${element.projectId}:boards`;
      boards.iconPath = new vscode.ThemeIcon("layout");

      return [boards, repos];
    }

    if (element.itemType === "repo") {
      // Do not call refs API when expanding a repo; always expose categories.
      const org = element.organization as string;
      const proj = element.projectId as string;
      const repoName = element.repoName || String(element.label);
      const repoIdentifier = element.repoId || repoName;

      const prCategory = new AzureDevOpsTreeItem("Pull Requests", vscode.TreeItemCollapsibleState.Collapsed);
      prCategory.itemType = "category";
      prCategory.projectId = proj;
      prCategory.organization = org;
      prCategory.repoId = repoIdentifier;
      prCategory.repoName = repoName;
      prCategory.contextValue = "category";
      prCategory.id = `category:${org}:${proj}:pullrequests:${repoIdentifier}`;
      prCategory.iconPath = new vscode.ThemeIcon("git-pull-request");

      const branchesCategory = new AzureDevOpsTreeItem("Branches", vscode.TreeItemCollapsibleState.Collapsed);
      branchesCategory.itemType = "category";
      branchesCategory.projectId = proj;
      branchesCategory.organization = org;
      branchesCategory.repoId = repoIdentifier;
      branchesCategory.repoName = repoName;
      branchesCategory.contextValue = "category";
      branchesCategory.id = `category:${org}:${proj}:branches:${repoIdentifier}`;
      branchesCategory.iconPath = new vscode.ThemeIcon("git-branch");

      return [prCategory, branchesCategory];
    }

    if (element.itemType === "category") {
      const label = element.label as string;
      if (label === "Repositories") {
        const org = element.organization as string;
        const proj = element.projectId as string;
        try {
          const items = this.reposByProject[`${org}:${proj}`] || (await this.fetchRepositories(org, proj));
          return items;
        } catch (e) {
          return [new AzureDevOpsTreeItem("(failed to load repositories)")];
        }
      }
      if (label === "Recent Work Items") {
        const org = element.organization as string;
        const proj = element.projectId as string;
        try {
          const items = await this.fetchWorkItems(org, proj);
          return items;
        } catch (e) {
          return [new AzureDevOpsTreeItem("(failed to load work items)")];
        }
      }
      if (label === "Pull Requests") {
        const org = element.organization as string;
        const proj = element.projectId as string;
        const repoIdentifier = (element.repoId as string) || (element.repoName as string) || undefined;
        try {
          const pKey = repoIdentifier ? `${org}:${proj}:${repoIdentifier}` : `${org}:${proj}`;
          const items = this.prsByScope[pKey] || (await this.fetchPullRequests(org, proj, repoIdentifier));
          return items;
        } catch (e) {
          return [new AzureDevOpsTreeItem("(failed to load pull requests)")];
        }
      }

      if (label === "Branches") {
        const org = element.organization as string;
        const proj = element.projectId as string;
        const repoIdentifier = (element.repoId as string) || (element.repoName as string) || "";
        try {
          const items = this.branchesByRepo[`${org}:${proj}:${repoIdentifier}`] || (await this.fetchBranches(org, proj, repoIdentifier, element.repoName as string | undefined));
          return items;
        } catch (e) {
          return [new AzureDevOpsTreeItem("(failed to load branches)")];
        }
      }

      if (label === "Boards") {
        try {
          const org = element.organization;
          const proj = element.projectId;
          let pat: string | undefined;
          if (this.context && org) {
            pat = await this.context.secrets.get(this.patKeyForOrg(org));
            if (!pat) {
              const entered = await this.promptAndStorePat(org);
              if (!entered) return [new AzureDevOpsTreeItem("(no PAT provided)")];
              pat = entered;
            }
          }
          if (!pat) {
            const ask = new AzureDevOpsTreeItem(`Enter PAT for ${org}`, vscode.TreeItemCollapsibleState.None);
            ask.command = { command: "ado-assist.enterPatForOrg", title: "Enter PAT", arguments: [org] };
            ask.iconPath = new vscode.ThemeIcon("key");
            return [ask];
          }
          // fetch work item queries as a proxy for boards
          const url = `https://dev.azure.com/${encodeURIComponent(org)}/${encodeURIComponent(proj)}/_apis/wit/queries?$depth=2&api-version=6.0`;
          const data = await getJson(url, pat);
          if (data && Array.isArray(data.value)) {
            // flatten queries
            // ensure project description cached before showing boards
            let projectEntry = this.projectsByOrg[org]?.find(x => x.id === (proj as any));
            const items: AzureDevOpsTreeItem[] = [];
            const walk = (nodes: any[]) => {
              for (const n of nodes) {
                if (n.isFolder && Array.isArray(n.children)) {
                  walk(n.children);
                } else if (!n.isFolder) {
                  const it = new AzureDevOpsTreeItem(n.name, vscode.TreeItemCollapsibleState.None);
                  it.itemType = "board";
                  it.url = n._links?.web?.href || `https://dev.azure.com/${org}/${proj}/_workitems`;
                  it.contextValue = "board";
                  it.id = `board:${org}:${proj}:${n.id || n.name}`;
                  // tooltip: use query description if available
                  it.tooltip = n.description || it.url;
                  it.iconPath = new vscode.ThemeIcon("layout");
                  // opening web page handled by inline/context action; do not attach to item click
                  items.push(it);
                }
              }
            };
            // data.value may contain folders; some entries at top-level
            for (const v of data.value) {
              if (v.hasOwnProperty("children") && Array.isArray(v.children)) walk(v.children);
              else if (!v.isFolder) {
                const it = new AzureDevOpsTreeItem(v.name, vscode.TreeItemCollapsibleState.None);
                it.itemType = "board";
                it.url = v._links?.web?.href || `https://dev.azure.com/${org}/${proj}/_workitems`;
                it.contextValue = "board";
                it.id = `board:${org}:${proj}:${v.id || v.name}`;
                it.iconPath = new vscode.ThemeIcon("layout");
                // opening web page handled by inline/context action; do not attach to item click
                items.push(it);
              }
            }
            // prepend a Recent Work Items category under Boards
            const recent = new AzureDevOpsTreeItem("Recent Work Items", vscode.TreeItemCollapsibleState.Collapsed);
            recent.itemType = "category";
            recent.projectId = proj;
            recent.organization = org;
            recent.contextValue = "category";
            recent.id = `category:${org}:${proj}:recentWorkItems`;
            recent.iconPath = new vscode.ThemeIcon("list-unordered");
            if (items.length === 0) return [recent];
            // cache boards-as-queries not needed; work items handled separately
            return [recent, ...items];
          }
          return [new AzureDevOpsTreeItem("(no boards)")];
        } catch (err) {
          return [new AzureDevOpsTreeItem("(failed to load boards)")];
        }
      }
    }

    return [];
  }

  // Prefetch and cache repositories, pull requests, branches (per-repo) and work items for a project
  async prefetchProjectData(org: string, projectId: string): Promise<void> {
    if (!org || !projectId) return;
    const key = `${org}:${projectId}`;
    try {
      const repos = await this.fetchRepositories(org, projectId);
      this.reposByProject[key] = repos;
    } catch (e) {
      this.reposByProject[key] = [];
    }
    try {
      const prs = await this.fetchPullRequests(org, projectId);
      this.prsByScope[key] = prs;
    } catch (e) {
      this.prsByScope[key] = [];
    }
    // fetch branches per repo sequentially to avoid bursts
    const reposCached = this.reposByProject[key] || [];
    for (const r of reposCached) {
      try {
        const repoId = (r.repoId as string) || (r.repoName as string) || "";
        const b = await this.fetchBranches(org, projectId, repoId, r.repoName);
        this.branchesByRepo[`${org}:${projectId}:${repoId}`] = b;
      } catch (e) {
        // ignore per-repo branch errors
      }
    }
    try {
      const wis = await this.fetchWorkItems(org, projectId);
      this.workItemsByProject[key] = wis;
    } catch (e) {
      this.workItemsByProject[key] = [];
    }
  }

  refresh(): void {
    this._onDidChangeTreeData.fire();
  }

  /**
   * Refresh a specific node or organization. If no element provided, refresh entire tree.
   * - organization: re-fetch projects for the organization
   * - project: re-fetch projects for the parent organization
   * - category/repo/other: trigger a tree refresh so getChildren re-queries dynamic endpoints
   */
  async refreshNode(element?: AzureDevOpsTreeItem): Promise<void> {
    if (!element) {
      this.refresh();
      return;
    }
    try {
      const t = element.itemType;
      // mark node as loading and clear its children visually
      if (element.id) {
        this.loadingNodes[element.id] = true;
        // safety timer to avoid permanent spinner if something fails to clear loading state
        try {
          if (this.loadingTimers[element.id]) clearTimeout(this.loadingTimers[element.id]);
        } catch (e) {}
        this.loadingTimers[element.id] = setTimeout(() => {
          try {
            if (this.loadingNodes[element.id]) {
              delete this.loadingNodes[element.id];
              delete this.loadingTimers[element.id];
              this._onDidChangeTreeData.fire(element);
            }
          } catch (e) {}
        }, 10000);
        // collapse the node so children are hidden during refresh
        element.collapsibleState = vscode.TreeItemCollapsibleState.Collapsed;
        // clear caches relevant to this node so children disappear immediately
        const t = element.itemType;
        if (t === "organization" && element.organization) {
          delete this.projectsByOrg[element.organization];
        } else if (t === "project" && element.organization && element.projectId) {
          // clear repos/workitems/prs for this project
          delete this.reposByProject[`${element.organization}:${element.projectId}`];
          // also clear any branch caches under repos of this project
          for (const key of Object.keys(this.branchesByRepo)) {
            if (key.startsWith(`${element.organization}:${element.projectId}:`)) delete this.branchesByRepo[key];
          }
          for (const key of Object.keys(this.prsByScope)) {
            if (key.startsWith(`${element.organization}:${element.projectId}:`)) delete this.prsByScope[key];
          }
          delete this.workItemsByProject[`${element.organization}:${element.projectId}`];
        } else if (t === "repo" && element.organization && element.projectId && element.repoId) {
          const repoKey = `${element.organization}:${element.projectId}:${element.repoId}`;
          delete this.branchesByRepo[repoKey];
          delete this.prsByScope[`${element.organization}:${element.projectId}:${element.repoId}`];
        } else if (t === "category" && String(element.label) === "Branches") {
          const repoKey = `${element.organization}:${element.projectId}:${element.repoId || element.repoName || ""}`;
          delete this.branchesByRepo[repoKey];
        }
        // force update so UI shows spinner and empty children
        this._onDidChangeTreeData.fire(element);
      }
      if (t === "organization") {
        const org = element.organization;
        if (org) {
          // remove cached children immediately so UI shows empty under org
          delete this.projectsByOrg[org];
          // ensure UI updated (node already collapsed and marked loading above)
          this._onDidChangeTreeData.fire(element);
          // fetch projects once and then re-render collapsed project nodes
          try {
            await this.fetchProjects(org);
          } catch (e) {
            // ignore fetch errors; fetchProjects handles errors state
          }
          if (element.id) {
            try {
              if (this.loadingTimers[element.id]) clearTimeout(this.loadingTimers[element.id]);
            } catch (e) {}
            delete this.loadingTimers[element.id];
            delete this.loadingNodes[element.id];
            this._onDidChangeTreeData.fire(element);
          }
        } else this.refresh();
        return;
      }
      if (t === "project") {
        // For project-level refresh, perform a single fetch of the project's
        // immediate dynamic children (repositories and recent work items)
        // to preserve the "clear children -> single fetch -> collapsed re-add" flow.
        const org = element.organization as string | undefined;
        const proj = element.projectId as string | undefined;
        if (!org || !proj) {
          if (element.id) {
            delete this.loadingNodes[element.id];
            this._onDidChangeTreeData.fire(element);
          }
          return;
        }
        try {
          // fetch repositories and work items once (do not touch org project list)
          await Promise.allSettled([this.fetchRepositories(org, proj), this.fetchWorkItems(org, proj)]);
        } catch (e) {
          // ignore individual fetch errors
        }
        if (element.id) {
          try {
            if (this.loadingTimers[element.id]) clearTimeout(this.loadingTimers[element.id]);
          } catch (e) {}
          delete this.loadingTimers[element.id];
          delete this.loadingNodes[element.id];
          this._onDidChangeTreeData.fire(element);
        }
        return;
      }
      // categories, repos, boards, etc. are dynamic -- trigger a re-render for the node
      if (element.id) {
        try {
          if (this.loadingTimers[element.id]) clearTimeout(this.loadingTimers[element.id]);
        } catch (e) {}
        delete this.loadingTimers[element.id];
        // clear loading state before re-render so getChildren will re-query endpoints
        delete this.loadingNodes[element.id];
      }
      this._onDidChangeTreeData.fire(element);
      return;
    } catch (err) {
      // fallback to full refresh on error
      if (element?.id) {
        try {
          if (this.loadingTimers[element.id]) clearTimeout(this.loadingTimers[element.id]);
        } catch (e) {}
        delete this.loadingTimers[element.id];
        delete this.loadingNodes[element.id];
      }
      this.refresh();
    }
  }

  // projects caching disabled: no setProjects helper

  async fetchProjects(organization: string, pat?: string): Promise<AdoProject[]> {
    // quick-return short-lived cache to avoid immediate repeated requests
    const cached = this.projectsCache[organization];
    if (cached && Date.now() - cached.ts < this.projectsCacheExpiryMs) return cached.projects;

    // reuse in-flight fetches to avoid duplicate API calls
    if (this.projectsFetchPromises[organization]) return this.projectsFetchPromises[organization];
    const p = (async () => {
      // per-organization loading and error state
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

        // Try saved PAT first; if missing or invalid, prompt and allow retry
        let data: any;
        if (usePat) {
          try {
            data = await getJson(url, usePat);
          } catch (err) {
            // saved PAT failed — prompt for new one
            const entered = await this.promptAndStorePat(organization);
            if (!entered) throw new Error("PAT not provided");
            usePat = entered;
            data = await getJson(url, usePat);
          }
        } else {
          // no PAT saved — prompt until user provides a working one or cancels
          while (true) {
            const entered = await this.promptAndStorePat(organization);
            if (!entered) throw new Error("PAT not provided");
            try {
              data = await getJson(url, entered);
              usePat = entered;
              break;
            } catch (err) {
              const retry = await vscode.window.showQuickPick(["Retry", "Cancel"], { placeHolder: "Failed to authenticate with provided PAT. Retry?" });
              if (retry !== "Retry") throw new Error("Authentication failed");
              // otherwise loop to prompt again
            }
          }
        }

        // if we got data and used a pat, ensure it's stored
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
        // attempt to fetch organization metadata (best-effort) to get description for tooltip
        try {
          const orgMetaUrl = `https://dev.azure.com/${encodeURIComponent(organization)}/_apis/organization?api-version=6.0`;
          const orgMeta = await getJson(orgMetaUrl, usePat || "");
          const orgDesc = orgMeta?.description || orgMeta?.displayName || orgMeta?.name || "";
          if (orgDesc) {
            // keep only in-memory; do not persist
            this.orgDescriptions[organization] = String(orgDesc);
          }
        } catch (e) {
          // ignore org metadata errors
        }
        const projects: AdoProject[] = [];
        if (data && Array.isArray(data.value)) {
          for (const p of data.value) {
            // prefer API-provided web link, otherwise construct a canonical project URL
            const projectName = String(p.name);
            const apiUrl = p._links?.web?.href;
            const canonical = `https://dev.azure.com/${encodeURIComponent(organization)}/${encodeURIComponent(projectName)}`;
            const desc = p.description || p.properties?.description || "";
            projects.push({ id: String(p.id), name: projectName, url: String(apiUrl || canonical), description: String(desc) });
          }
        }
        // cache projects briefly in-memory to suppress rapid repeated requests
        this.projectsCache[organization] = { ts: Date.now(), projects };
        // populate in-memory projectsByOrg for callers that check it (do not persist)
        this.projectsByOrg[organization] = projects;
        // do not persist projects to workspaceState
        // clear any previous error for this org
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

  // Fetch repositories for a given project and cache them. Does not call this.refresh().
  async fetchRepositories(org: string, projectId: string): Promise<AzureDevOpsTreeItem[]> {
    const cacheKey = `${org}:${projectId}`;
    if (this.reposFetchPromises[cacheKey]) return this.reposFetchPromises[cacheKey];
    const id = `category:${org}:${projectId}:repositories`;
    if (this.loadingNodes[id]) return [new AzureDevOpsTreeItem("(loading...)")];
    const p = (async () => {
      this.loadingNodes[id] = true;
      try {
        let pat: string | undefined;
        if (this.context && org) {
          pat = await this.context.secrets.get(this.patKeyForOrg(org));
          if (!pat) {
            const entered = await this.promptAndStorePat(org);
            if (!entered) {
              delete this.loadingNodes[id];
              return [new AzureDevOpsTreeItem("(no PAT provided)")];
            }
            pat = entered;
          }
        }
        if (!pat) {
          delete this.loadingNodes[id];
          const ask = new AzureDevOpsTreeItem(`Enter PAT for ${org}`, vscode.TreeItemCollapsibleState.None);
          ask.command = { command: "ado-assist.enterPatForOrg", title: "Enter PAT", arguments: [org] };
          ask.iconPath = new vscode.ThemeIcon("key");
          return [ask];
        }
        const url = `https://dev.azure.com/${encodeURIComponent(org)}/${encodeURIComponent(projectId)}/_apis/git/repositories?api-version=6.0`;
        const data = await getJson(url, pat);
        const repoItems: AzureDevOpsTreeItem[] = [];
        if (data && Array.isArray(data.value)) {
          let projectEntry: AdoProject | undefined;
          // Prefer in-memory project list to avoid calling fetchProjects repeatedly
          projectEntry = this.projectsByOrg[org]?.find(p => p.id === (projectId as any));
          if (!projectEntry) {
            try {
              const projects = await this.fetchProjects(org);
              projectEntry = projects.find(p => p.id === (projectId as any));
            } catch (e) {}
          }
          const projectNameForUrl = projectEntry?.name || String(projectId);
          for (const r of data.value) {
            const repoName = String(r.name);
            const it = new AzureDevOpsTreeItem(repoName, vscode.TreeItemCollapsibleState.Collapsed);
            it.itemType = "repo";
            it.organization = org;
            it.projectId = projectId;
            const apiUrl = r._links?.web?.href;
            const canonicalRepoUrl = `https://dev.azure.com/${encodeURIComponent(org)}/${encodeURIComponent(projectNameForUrl)}/_git/${encodeURIComponent(repoName)}`;
            it.url = String(apiUrl || canonicalRepoUrl);
            it.contextValue = "repo";
            it.id = `repo:${org}:${projectId}:${repoName}`;
            it.repoId = r.id || repoName;
            it.repoName = repoName;
            it.tooltip = r.description || projectEntry?.description || it.url;
            it.iconPath = new vscode.ThemeIcon("files");
            repoItems.push(it);
          }
        }
        // store in-memory for synchronous retrieval by getChildren
        this.reposByProject[`${org}:${projectId}`] = repoItems;
        return repoItems;
      } catch (err) {
        return [new AzureDevOpsTreeItem("(failed to load repositories)")];
      } finally {
        delete this.loadingNodes[id];
      }
    })();
    this.reposFetchPromises[cacheKey] = p;
    try {
      return await p;
    } finally {
      delete this.reposFetchPromises[cacheKey];
    }
  }

  async fetchPullRequests(org: string, projectId: string, repoIdentifier?: string): Promise<AzureDevOpsTreeItem[]> {
    const cacheKey = `${org}:${projectId}:${repoIdentifier || ""}`;
    if (this.prsFetchPromises[cacheKey]) return this.prsFetchPromises[cacheKey];
    const id = `category:${org}:${projectId}:pullrequests:${repoIdentifier || ""}`;
    if (this.loadingNodes[id]) return [new AzureDevOpsTreeItem("(loading...)")];
    const p = (async () => {
      this.loadingNodes[id] = true;
      try {
        let pat: string | undefined;
        if (this.context && org) {
          pat = await this.context.secrets.get(this.patKeyForOrg(org));
          if (!pat) {
            const entered = await this.promptAndStorePat(org);
            if (!entered) {
              delete this.loadingNodes[id];
              return [new AzureDevOpsTreeItem("(no PAT provided)")];
            }
            pat = entered;
          }
        }
        if (!pat) {
          delete this.loadingNodes[id];
          const ask = new AzureDevOpsTreeItem(`Enter PAT for ${org}`, vscode.TreeItemCollapsibleState.None);
          ask.command = { command: "ado-assist.enterPatForOrg", title: "Enter PAT", arguments: [org] };
          ask.iconPath = new vscode.ThemeIcon("key");
          return [ask];
        }
        let projectEntry: AdoProject | undefined = this.projectsByOrg[org]?.find(p => p.id === (projectId as any));
        const projectName = projectEntry?.name || String(projectId);
        const repoFilter = repoIdentifier ? `&searchCriteria.repositoryId=${encodeURIComponent(repoIdentifier)}` : "";
        const prUrl = `https://dev.azure.com/${encodeURIComponent(org)}/${encodeURIComponent(projectName)}/_apis/git/pullrequests?api-version=6.0&searchCriteria.status=active${repoFilter}`;
        const data = await getJson(prUrl, pat);
        if (data && Array.isArray(data.value)) {
          const prItems = data.value.map((p: any) => {
            const title = p.title || `PR ${p.pullRequestId}`;
            const it = new AzureDevOpsTreeItem(title, vscode.TreeItemCollapsibleState.None);
            it.itemType = "pullrequest";
            it.url = p._links?.web?.href || `https://dev.azure.com/${org}/${projectName}/_git/${p.repository?.name}/pullrequest/${p.pullRequestId}`;
            it.contextValue = "pullrequest";
            it.id = repoIdentifier ? `pr:${org}:${projectId}:${repoIdentifier}:${p.pullRequestId}` : `pr:${org}:${projectId}:${p.pullRequestId}`;
            const src = p.sourceRefName || "";
            const tgt = p.targetRefName || "";
            it.tooltip = `${src} → ${tgt}`;
            it.iconPath = new vscode.ThemeIcon("git-pull-request");
            return it;
          });
          return prItems.length ? prItems : [new AzureDevOpsTreeItem("(no pull requests)")];
        }
        return [new AzureDevOpsTreeItem("(no pull requests)")];
      } catch (err) {
        return [new AzureDevOpsTreeItem("(failed to load pull requests)")];
      } finally {
        delete this.loadingNodes[id];
      }
    })();
    this.prsFetchPromises[cacheKey] = p;
    try {
      return await p;
    } finally {
      delete this.prsFetchPromises[cacheKey];
    }
  }

  async fetchBranches(org: string, projectId: string, repoIdentifier: string, repoName?: string): Promise<AzureDevOpsTreeItem[]> {
    const cacheKey = `${org}:${projectId}:${repoIdentifier}`;
    if (this.branchesFetchPromises[cacheKey]) return this.branchesFetchPromises[cacheKey];
    const id = `category:${org}:${projectId}:branches:${repoIdentifier}`;
    if (this.loadingNodes[id]) return [new AzureDevOpsTreeItem("(loading...)")];
    const p = (async () => {
      this.loadingNodes[id] = true;
      try {
        let pat: string | undefined;
        if (this.context && org) {
          pat = await this.context.secrets.get(this.patKeyForOrg(org));
          if (!pat) {
            const entered = await this.promptAndStorePat(org);
            if (!entered) {
              delete this.loadingNodes[id];
              return [new AzureDevOpsTreeItem("(no PAT provided)")];
            }
            pat = entered;
          }
        }
        if (!pat) {
          delete this.loadingNodes[id];
          const ask = new AzureDevOpsTreeItem(`Enter PAT for ${org}`, vscode.TreeItemCollapsibleState.None);
          ask.command = { command: "ado-assist.enterPatForOrg", title: "Enter PAT", arguments: [org] };
          ask.iconPath = new vscode.ThemeIcon("key");
          return [ask];
        }
        let projectEntry: AdoProject | undefined = this.projectsByOrg[org]?.find(p => p.id === (projectId as any));
        const projectName = projectEntry?.name || String(projectId);
        const url = `https://dev.azure.com/${encodeURIComponent(org)}/${encodeURIComponent(projectName)}/_apis/git/repositories/${encodeURIComponent(repoIdentifier)}/refs?filter=heads/&api-version=6.0`;
        const data = await getJson(url, pat);
        if (data && Array.isArray(data.value)) {
          const items = data.value.map((r: any) => {
            const fullName = String(r.name || r.name);
            const parts = fullName.split("/");
            const branchName = parts.slice(2).join("/") || fullName;
            const it = new AzureDevOpsTreeItem(branchName, vscode.TreeItemCollapsibleState.None);
            it.itemType = "branch";
            it.contextValue = "branch";
            it.id = `branch:${org}:${projectId}:${repoIdentifier}:${branchName}`;
            it.url = `https://dev.azure.com/${org}/${projectName}/_git/${encodeURIComponent(repoName || repoIdentifier)}?version=GB${encodeURIComponent(branchName)}`;
            it.tooltip = it.url;
            it.iconPath = new vscode.ThemeIcon("git-branch");
            return it;
          });
          return items.length ? items : [new AzureDevOpsTreeItem("(no branches)")];
        }
        return [new AzureDevOpsTreeItem("(no branches)")];
      } catch (err) {
        return [new AzureDevOpsTreeItem("(failed to load branches)")];
      } finally {
        delete this.loadingNodes[id];
      }
    })();
    this.branchesFetchPromises[cacheKey] = p;
    try {
      return await p;
    } finally {
      delete this.branchesFetchPromises[cacheKey];
    }
  }

  async fetchWorkItems(org: string, projectId: string): Promise<AzureDevOpsTreeItem[]> {
    const cacheKey = `${org}:${projectId}`;
    if (this.workItemsFetchPromises[cacheKey]) return this.workItemsFetchPromises[cacheKey];
    const id = `category:${org}:${projectId}:recentWorkItems`;
    if (this.loadingNodes[id]) return [new AzureDevOpsTreeItem("(loading...)")];
    const p = (async () => {
      this.loadingNodes[id] = true;
      try {
        let pat: string | undefined;
        if (this.context && org) {
          pat = await this.context.secrets.get(this.patKeyForOrg(org));
          if (!pat) {
            const entered = await this.promptAndStorePat(org);
            if (!entered) {
              delete this.loadingNodes[id];
              return [new AzureDevOpsTreeItem("(no PAT provided)")];
            }
            pat = entered;
          }
        }
        if (!pat) {
          delete this.loadingNodes[id];
          const ask = new AzureDevOpsTreeItem(`Enter PAT for ${org}`, vscode.TreeItemCollapsibleState.None);
          ask.command = { command: "ado-assist.enterPatForOrg", title: "Enter PAT", arguments: [org] };
          ask.iconPath = new vscode.ThemeIcon("key");
          return [ask];
        }
        let projectEntry: AdoProject | undefined = this.projectsByOrg[org]?.find(x => x.id === (projectId as any));
        const projectName = projectEntry?.name || String(projectId);
        const wiqlUrl = `https://dev.azure.com/${encodeURIComponent(org)}/${encodeURIComponent(projectName)}/_apis/wit/wiql?api-version=6.0`;
        const wiqlBody = { query: `Select [System.Id] From WorkItems Where [System.TeamProject] = '${projectName}' ORDER BY [System.ChangedDate] DESC` };
        const wiqlRes = await postJson(wiqlUrl, pat, wiqlBody);
        const ids = Array.isArray(wiqlRes?.workItems) ? wiqlRes.workItems.slice(0, 50).map((w: any) => w.id) : [];
        if (ids.length === 0) return [new AzureDevOpsTreeItem("(no work items)")];
        const fields = encodeURIComponent("System.Title,System.State,System.AssignedTo");
        const idsParam = ids.join(",");
        const url = `https://dev.azure.com/${encodeURIComponent(org)}/_apis/wit/workitems?ids=${idsParam}&fields=${fields}&api-version=6.0`;
        const data = await getJson(url, pat);
        if (data && Array.isArray(data.value)) {
          const items = data.value.map((w: any) => {
            const id = String(w.id);
            const title = w.fields?.["System.Title"] || "(no title)";
            const state = w.fields?.["System.State"] || "";
            const assigned = (w.fields?.["System.AssignedTo"] && w.fields["System.AssignedTo"].displayName) || "";
            const it = new AzureDevOpsTreeItem(`#${id} ${title}`, vscode.TreeItemCollapsibleState.None);
            it.itemType = "workitem";
            it.url = w._links?.html?.href || `https://dev.azure.com/${org}/${projectName}/_workitems?id=${id}`;
            it.contextValue = "workitem";
            it.id = `workitem:${org}:${projectId}:${id}`;
            it.tooltip = `${state}${assigned ? " — " + assigned : ""}` || it.url;
            it.iconPath = new vscode.ThemeIcon("issue-opened");
            return it;
          });
          return items;
        }
        return [new AzureDevOpsTreeItem("(no work items)")];
      } catch (err) {
        return [new AzureDevOpsTreeItem("(failed to load work items)")];
      } finally {
        delete this.loadingNodes[id];
      }
    })();
    this.workItemsFetchPromises[cacheKey] = p;
    try {
      return await p;
    } finally {
      delete this.workItemsFetchPromises[cacheKey];
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
    // remove cached projects
    delete this.projectsByOrg[org];
    // do not persist projectsByOrg
    this.refresh();
  }
}

export function createTreeProvider(context?: vscode.ExtensionContext): AzureDevOpsTreeProvider {
  return new AzureDevOpsTreeProvider(context);
}

async function httpRequest(method: "GET" | "POST", urlStr: string, pat: string, body?: any): Promise<any> {
  const https = require("https");
  const u = new URL(urlStr);
  const auth = Buffer.from(":" + pat).toString("base64");
  const payload = body ? JSON.stringify(body) : undefined;
  const options: any = {
    hostname: u.hostname,
    path: u.pathname + u.search,
    method,
    headers: {
      Authorization: "Basic " + auth,
      Accept: "application/json",
    },
  };
  if (payload) {
    options.headers["Content-Type"] = "application/json";
    options.headers["Content-Length"] = Buffer.byteLength(payload);
  }

  return new Promise((resolve, reject) => {
    try {
      const req = https.request(options, (res: any) => {
        let bodyStr = "";
        res.setEncoding("utf8");
        res.on("data", (chunk: string) => (bodyStr += chunk));
        res.on("end", () => {
          try {
            const parsed = bodyStr ? JSON.parse(bodyStr) : {};
            try {
              console.log(`ado-assist: request=${method} ${urlStr} status=${res.statusCode} ${res.statusMessage}`);
            } catch (e) {
              // ignore logging errors
            }
            // resolve immediately (removed artificial 0.5s delay)
            resolve(parsed);
          } catch (err) {
            reject(err);
          }
        });
      });
      req.on("error", (e: any) => reject(e));
      if (payload) req.write(payload);
      req.end();
    } catch (err) {
      reject(err);
    }
  });
}

export async function getJson(urlStr: string, pat: string): Promise<any> {
  return await httpRequest("GET", urlStr, pat);
}

export async function postJson(urlStr: string, pat: string, body: any): Promise<any> {
  return await httpRequest("POST", urlStr, pat, body);
}
