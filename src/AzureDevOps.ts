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
}

export class AzureDevOpsTreeProvider implements vscode.TreeDataProvider<AzureDevOpsTreeItem> {
  private _onDidChangeTreeData: vscode.EventEmitter<AzureDevOpsTreeItem | undefined | null | void> = new vscode.EventEmitter();
  readonly onDidChangeTreeData: vscode.Event<AzureDevOpsTreeItem | undefined | null | void> = this._onDidChangeTreeData.event;
  private projectsByOrg: { [org: string]: AdoProject[] } = {};
  private context: vscode.ExtensionContext | undefined;
  private loadingOrg?: string;
  private errorsByOrg: { [org: string]: string } = {};

  constructor(context?: vscode.ExtensionContext) {
    this.context = context;
    // try to load cached projects from workspaceState
    if (this.context) {
      const byOrg = this.context.workspaceState.get<{ [org: string]: AdoProject[] }>("azuredevops.projectsByOrg");
      if (byOrg) this.projectsByOrg = byOrg;
      const orgs = this.context.workspaceState.get<string[]>("azuredevops.organizations");
      if (orgs) this.organizations = orgs;
      const errs = this.context.workspaceState.get<{ [org: string]: string }>("azuredevops.errorsByOrg");
      if (errs) this.errorsByOrg = errs;
    }
  }

  private patKeyForOrg(org: string) {
    return `azure-devops.pat.${org}`;
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
      const orgItems = this.organizations.map(o => {
        const it = new AzureDevOpsTreeItem(o, vscode.TreeItemCollapsibleState.Collapsed);
        it.itemType = "organization";
        it.organization = o;
        it.contextValue = "organization";
        it.iconPath = new vscode.ThemeIcon("organization");
        return it;
      });

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
      const cached = this.projectsByOrg[org] || [];
      if (cached.length === 0) return [];
      const items = cached.map(p => {
        const it = new AzureDevOpsTreeItem(p.name, vscode.TreeItemCollapsibleState.Collapsed);
        it.itemType = "project";
        it.projectId = p.id;
        it.url = p.url;
        it.organization = org;
        it.iconPath = new vscode.ThemeIcon("briefcase");
        it.contextValue = "adoProject";
        return it;
      });

      return items;
    }

    if (element.itemType === "project") {
      // categories under project
      const repos = new AzureDevOpsTreeItem("Repositories", vscode.TreeItemCollapsibleState.Collapsed);
      repos.itemType = "category";
      repos.projectId = element.projectId;
      repos.organization = element.organization;
      repos.contextValue = "category";
      repos.iconPath = new vscode.ThemeIcon("database");

      const boards = new AzureDevOpsTreeItem("Boards", vscode.TreeItemCollapsibleState.Collapsed);
      boards.itemType = "category";
      boards.projectId = element.projectId;
      boards.organization = element.organization;
      boards.contextValue = "category";
      boards.iconPath = new vscode.ThemeIcon("layout");

      const pipelines = new AzureDevOpsTreeItem("Pipelines", vscode.TreeItemCollapsibleState.Collapsed);
      pipelines.itemType = "category";
      pipelines.projectId = element.projectId;
      pipelines.organization = element.organization;
      pipelines.contextValue = "category";
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
            ask.command = { command: "azure-devops.enterPatForOrg", title: "Enter PAT", arguments: [org] };
            ask.iconPath = new vscode.ThemeIcon("key");
            return [ask];
          }
          const url = `https://dev.azure.com/${encodeURIComponent(org)}/${encodeURIComponent(proj)}/_apis/git/repositories?api-version=6.0`;
          const data = await getJson(url, pat);
          if (data && Array.isArray(data.value)) {
            const repoItems = data.value.map((r: any) => {
              const it = new AzureDevOpsTreeItem(r.name, vscode.TreeItemCollapsibleState.None);
              it.itemType = "repo";
              it.url = r._links?.web?.href || "";
              it.contextValue = "repo";
              if (it.url) {
                it.command = {
                  command: "azure-devops.openProject",
                  title: "Open Repo",
                  arguments: [it.url],
                };
              }
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
            ask.command = { command: "azure-devops.enterPatForOrg", title: "Enter PAT", arguments: [org] };
            ask.iconPath = new vscode.ThemeIcon("key");
            return [ask];
          }
          const url = `https://dev.azure.com/${encodeURIComponent(org)}/${encodeURIComponent(proj)}/_apis/pipelines?api-version=6.0-preview.1`;
          const data = await getJson(url, pat);
          if (data && Array.isArray(data.value)) {
            const pipelineItems = data.value.map((p: any) => {
              const it = new AzureDevOpsTreeItem(p.name || `Pipeline ${p.id}`, vscode.TreeItemCollapsibleState.None);
              it.itemType = "pipeline";
              it.url = p._links?.web?.href || "";
              it.contextValue = "pipeline";
              if (it.url) {
                it.command = {
                  command: "azure-devops.openProject",
                  title: "Open Pipeline",
                  arguments: [it.url],
                };
              }
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
            ask.command = { command: "azure-devops.enterPatForOrg", title: "Enter PAT", arguments: [org] };
            ask.iconPath = new vscode.ThemeIcon("key");
            return [ask];
          }
          // fetch work item queries as a proxy for boards
          const url = `https://dev.azure.com/${encodeURIComponent(org)}/${encodeURIComponent(proj)}/_apis/wit/queries?$depth=2&api-version=6.0`;
          const data = await getJson(url, pat);
          if (data && Array.isArray(data.value)) {
            // flatten queries
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
                  it.iconPath = new vscode.ThemeIcon("layout");
                  if (it.url) it.command = { command: "azure-devops.openProject", title: "Open Board", arguments: [it.url] };
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
                it.iconPath = new vscode.ThemeIcon("layout");
                if (it.url) it.command = { command: "azure-devops.openProject", title: "Open Board", arguments: [it.url] };
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
    if (this.context) this.context.workspaceState.update("azuredevops.projectsByOrg", this.projectsByOrg);
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
      const projects: AdoProject[] = [];
      if (data && Array.isArray(data.value)) {
        for (const p of data.value) {
          projects.push({ id: String(p.id), name: String(p.name), url: String(p._links?.web?.href || `https://dev.azure.com/${organization}/_projects`) });
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
    if (this.context) this.context.workspaceState.update("azuredevops.projectsByOrg", this.projectsByOrg);
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
          Authorization: "Basic " + auth,
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
