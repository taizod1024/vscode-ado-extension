import * as vscode from "vscode";

export class AzureDevOpsTreeItem extends vscode.TreeItem {
  // custom metadata
  id?: string;
  itemType?: string; // 'project' | 'category' | 'repo' | 'pipeline' | 'error' | 'loading'
  projectId?: string;
  organization?: string;
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
  private context: vscode.ExtensionContext | undefined;
  private loadingOrg?: string;
  private errorsByOrg: { [org: string]: string } = {};
  private orgDescriptions: { [org: string]: string } = {};

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
    return element;
  }

  async getChildren(element?: AzureDevOpsTreeItem): Promise<AzureDevOpsTreeItem[]> {
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
      // show cached projects for this organization
      let cached = this.projectsByOrg[org] || [];
      if (cached.length === 0) {
        // automatically fetch projects when expanding an organization (no prompt)
        // trigger fetch only if not already loading
        try {
          if (this.loadingOrg !== org) {
            this.fetchProjects(org).catch(() => {});
          }
        } catch (e) {
          // ignore
        }
        // return a loading indicator so the tree doesn't continuously re-enter fetch synchronously
        const it = new AzureDevOpsTreeItem("(loading projects...)", vscode.TreeItemCollapsibleState.None);
        it.itemType = "loading";
        it.iconPath = new vscode.ThemeIcon("sync~spin");
        return [it];
      }
      if (cached.length === 0) return [];
      const items = cached.map(p => {
        const it = new AzureDevOpsTreeItem(p.name, vscode.TreeItemCollapsibleState.Collapsed);
        it.itemType = "project";
        it.projectId = p.id;
        it.url = p.url;
        it.organization = org;
        it.id = `project:${org}:${p.id}`;
        it.iconPath = new vscode.ThemeIcon("server-environment");
        it.contextValue = "adoProject";
        // show fetched description in tooltip (hover); fallback to URL
        it.tooltip = p.description || p.url;
        return it;
      });

      return items;
    }

    if (element.itemType === "project") {
      // ensure we have project list for this org (auto-fetch if missing)
      try {
        const org = element.organization as string;
        if (!this.projectsByOrg[org] || this.projectsByOrg[org].length === 0) {
          try {
            await this.fetchProjects(org);
          } catch (e) {
            // ignore fetch errors
          }
        }
      } catch (e) {
        // ignore
      }
      // categories under project
      const repos = new AzureDevOpsTreeItem("Repositories", vscode.TreeItemCollapsibleState.Collapsed);
      repos.itemType = "category";
      repos.projectId = element.projectId;
      repos.organization = element.organization;
      repos.contextValue = "category";
      repos.id = `category:${element.organization}:${element.projectId}:repositories`;
      repos.iconPath = new vscode.ThemeIcon("database");

      const boards = new AzureDevOpsTreeItem("Boards", vscode.TreeItemCollapsibleState.Collapsed);
      boards.itemType = "category";
      boards.projectId = element.projectId;
      boards.organization = element.organization;
      boards.contextValue = "category";
      boards.id = `category:${element.organization}:${element.projectId}:boards`;
      boards.iconPath = new vscode.ThemeIcon("layout");

      const pipelines = new AzureDevOpsTreeItem("Pipelines", vscode.TreeItemCollapsibleState.Collapsed);
      pipelines.itemType = "category";
      pipelines.projectId = element.projectId;
      pipelines.organization = element.organization;
      pipelines.contextValue = "category";
      pipelines.id = `category:${element.organization}:${element.projectId}:pipelines`;
      pipelines.iconPath = new vscode.ThemeIcon("git-branch");

      return [repos, boards, pipelines];
    }

    if (element.itemType === "category") {
      const label = element.label as string;
      if (label === "Repositories") {
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
          const url = `https://dev.azure.com/${encodeURIComponent(org)}/${encodeURIComponent(proj)}/_apis/git/repositories?api-version=6.0`;
          const data = await getJson(url, pat);
          if (data && Array.isArray(data.value)) {
            // find project name from cached projects (projectId -> name)
            let projectEntry = this.projectsByOrg[org]?.find(p => p.id === (proj as any));
            // if project description missing, trigger background refresh of project list (do not await)
            if (!projectEntry || !projectEntry.description) {
              try {
                if (this.loadingOrg !== org) this.fetchProjects(org).catch(() => {});
              } catch (e) {
                // ignore
              }
              projectEntry = this.projectsByOrg[org]?.find(p => p.id === (proj as any));
            }
            const projectNameForUrl = projectEntry?.name || String(proj);
            const repoItems = data.value.map((r: any) => {
              const repoName = String(r.name);
              const it = new AzureDevOpsTreeItem(repoName, vscode.TreeItemCollapsibleState.None);
              it.itemType = "repo";
              // prefer API-provided web link, otherwise construct canonical repo URL
              const apiUrl = r._links?.web?.href;
              const canonicalRepoUrl = `https://dev.azure.com/${encodeURIComponent(org)}/${encodeURIComponent(projectNameForUrl)}/_git/${encodeURIComponent(repoName)}`;
              it.url = String(apiUrl || canonicalRepoUrl);
              it.contextValue = "repo";
              // Use projectId for stability rather than project name
              it.id = `repo:${org}:${proj}:${repoName}`;
              // opening web page handled by inline/context action; do not attach to item click
              // tooltip: prefer repo description or project description, fallback to URL
              it.tooltip = r.description || projectEntry?.description || it.url;
              it.iconPath = new vscode.ThemeIcon("database");
              return it;
            });

            return repoItems;
          }
          return [new AzureDevOpsTreeItem("(no repositories)")];
        } catch (err) {
          return [new AzureDevOpsTreeItem("(failed to load repositories)")];
        }
      }
      if (label === "Pipelines") {
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
          const url = `https://dev.azure.com/${encodeURIComponent(org)}/${encodeURIComponent(proj)}/_apis/pipelines?api-version=6.0-preview.1`;
          const data = await getJson(url, pat);
          if (data && Array.isArray(data.value)) {
            // try to refresh project descriptions if missing before building pipeline items
            let projectEntry = this.projectsByOrg[org]?.find(x => x.id === (proj as any));
            if (!projectEntry || !projectEntry.description) {
              try {
                if (this.loadingOrg !== org) this.fetchProjects(org).catch(() => {});
              } catch (e) {}
              projectEntry = this.projectsByOrg[org]?.find(x => x.id === (proj as any));
            }
            const pipelineItems = data.value.map((p: any) => {
              const it = new AzureDevOpsTreeItem(p.name || `Pipeline ${p.id}`, vscode.TreeItemCollapsibleState.None);
              it.itemType = "pipeline";
              it.url = p._links?.web?.href || "";
              it.contextValue = "pipeline";
              it.id = `pipeline:${org}:${proj}:${p.id}`;
              // opening web page handled by inline/context action; do not attach to item click
              // tooltip: pipeline description or URL
              it.tooltip = p.description || it.url;
              it.iconPath = new vscode.ThemeIcon("git-branch");
              return it;
            });

            return pipelineItems;
          }
          return [new AzureDevOpsTreeItem("(no pipelines)")];
        } catch (err) {
          return [new AzureDevOpsTreeItem("(failed to load pipelines)")];
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
            if (!projectEntry || !projectEntry.description) {
              try {
                if (this.loadingOrg !== org) this.fetchProjects(org).catch(() => {});
              } catch (e) {}
              projectEntry = this.projectsByOrg[org]?.find(x => x.id === (proj as any));
            }
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
            if (items.length === 0) return [new AzureDevOpsTreeItem("(no boards)")];

            return items;
          }
          return [new AzureDevOpsTreeItem("(no boards)")];
        } catch (err) {
          return [new AzureDevOpsTreeItem("(failed to load boards)")];
        }
      }
    }

    return [];
  }

  refresh(): void {
    this._onDidChangeTreeData.fire();
  }

  setProjects(projects: AdoProject[], org: string) {
    this.projectsByOrg[org] = projects;
    // do not persist project lists (store only organizations and PATs per user request)
    this.refresh();
  }

  async fetchProjects(organization: string, pat?: string): Promise<void> {
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
      this.setProjects(projects, organization);
      // clear any previous error for this org
      delete this.errorsByOrg[organization];
      if (this.context) this.context.workspaceState.update("azuredevops.errorsByOrg", this.errorsByOrg);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.errorsByOrg[organization] = msg;
      if (this.context) this.context.workspaceState.update("azuredevops.errorsByOrg", this.errorsByOrg);
      this.setProjects([], organization);
    } finally {
      this.loadingOrg = undefined;
      this.refresh();
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

function getJson(urlStr: string, pat: string): Promise<any> {
  return new Promise((resolve, reject) => {
    try {
      const https = require("https");
      const u = new URL(urlStr);
      const auth = Buffer.from(":" + pat).toString("base64");
      const options = {
        hostname: u.hostname,
        path: u.pathname + u.search,
        method: "GET",
        headers: {
          // eslint-disable-next-line @typescript-eslint/naming-convention
          Authorization: "Basic " + auth,
          // eslint-disable-next-line @typescript-eslint/naming-convention
          Accept: "application/json",
        },
      } as any;
      const req = https.request(options, (res: any) => {
        let body = "";
        res.setEncoding("utf8");
        res.on("data", (chunk: string) => (body += chunk));
        res.on("end", () => {
          try {
            const parsed = JSON.parse(body);
            resolve(parsed);
          } catch (err) {
            reject(err);
          }
        });
      });
      req.on("error", (e: any) => reject(e));
      req.end();
    } catch (err) {
      reject(err);
    }
  });
}
