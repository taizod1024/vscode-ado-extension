import * as vscode from "vscode";
import { AdoProject, AdoRepository, AdoWorkItem, AdoBranch, AdoPullRequest } from "./types";
import { httpRequest } from "./api";

/**
 * ADO API クライアント：API 呼び出しと認証ロジックを管理します。
 * TreeProvider と独立した責務を持ちます。
 */
export class AdoApiClient {
  // -----------------------
  // Properties
  // -----------------------
  private context: vscode.ExtensionContext | undefined;
  private projectsByOrg: { [org: string]: AdoProject[] } = {};
  private projectsFetchPromises: { [org: string]: Promise<AdoProject[]> } = {};
  private currentProfileCache: any | undefined;
  private patCache: { [org: string]: string } = {};
  private patPromptCallback?: (org: string) => Promise<string | undefined>;

  // -----------------------
  // Constructor
  // -----------------------
  constructor(context?: vscode.ExtensionContext) {
    this.context = context;
  }

  // -----------------------
  // Configuration
  // -----------------------
  /**
   * PAT プロンプト用のコールバックを設定します。
   * @param callback PAT を要求する関数
   */
  setPatPromptCallback(callback: (org: string) => Promise<string | undefined>): void {
    this.patPromptCallback = callback;
  }

  /**
   * PAT キャッシュをクリアします。
   */
  clearPatCache(): void {
    this.patCache = {};
  }

  // -----------------------
  // Projects
  // -----------------------
  async fetchProjects(organization: string, pat?: string): Promise<AdoProject[]> {
    if (this.projectsFetchPromises[organization]) {
      return this.projectsFetchPromises[organization];
    }

    const p = (async () => {
      try {
        const usePat = await this.resolvePat(organization, pat);
        if (!usePat) throw new Error("PAT not provided");
        const url = `https://dev.azure.com/${encodeURIComponent(organization)}/_apis/projects?api-version=6.0`;
        const data: any = await httpRequest("GET", url, usePat);
        const projects: AdoProject[] = [];
        if (data && Array.isArray(data.value)) {
          for (const p of data.value) {
            const projectName = String(p.name);
            const apiUrl = p._links?.web?.href;
            const canonical = this.buildWebUrl(organization, projectName, undefined, "project");
            const desc = p.description || p.properties?.description || "";
            projects.push({
              id: String(p.id),
              name: projectName,
              url: String(apiUrl || canonical),
              description: String(desc),
            });
          }
        }
        this.projectsByOrg[organization] = projects;
        return projects;
      } catch (err) {
        return [];
      } finally {
        delete this.projectsFetchPromises[organization];
      }
    })();

    this.projectsFetchPromises[organization] = p;
    return p;
  }

  // -----------------------
  // Work Items
  // -----------------------
  async fetchWorkItems(organization: string, projectIdOrName: string, pat?: string): Promise<AdoWorkItem[]> {
    const usePat = await this.resolvePat(organization, pat);
    if (!usePat) return [];

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
    const query = {
      query: `Select [System.Id], [System.Title] From WorkItems Where [System.TeamProject] = '${safeName}' Order By [System.ChangedDate] Desc`,
    };
    const wiqlResult: any = await httpRequest("POST", wiqlUrl, usePat, query);
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
        const wid = Number(d.id);
        let webUrl = d.url || "";
        if (projectName) {
          webUrl = `https://dev.azure.com/${encodeURIComponent(organization)}/${encodeURIComponent(projectName)}/_workitems/edit/${encodeURIComponent(String(wid))}`;
        }
        const state = String(d.fields?.["System.State"] || d.fields?.["State"] || "");
        const assignee = this.extractPerson(d.fields?.["System.AssignedTo"] || d.fields?.["Assigned To"] || "");
        items.push({
          id: wid,
          title: String(d.fields?.["System.Title"] || d.fields?.["Title"] || "(no title)"),
          url: webUrl,
          status: state,
          assignee,
        });
      }
    }
    return items;
  }

  async fetchWorkItemsByWiql(organization: string, wiql: string, projectIdOrName?: string, pat?: string): Promise<AdoWorkItem[]> {
    const usePat = await this.resolvePat(organization, pat);
    if (!usePat) return [];

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
        if (/^[0-9a-fA-F-]{32,36}$/.test(String(projectIdOrName))) {
          console.log(`ado-assist: provided project identifier appears to be GUID and could not be resolved to name: ${projectIdOrName}`);
          projectName = "";
        }
      }
    }

    const wiqlUrl = `https://dev.azure.com/${encodeURIComponent(organization)}/_apis/wit/wiql?api-version=6.0`;
    const queryBody = { query: wiql };
    const wiqlResult: any = await httpRequest("POST", wiqlUrl, usePat, queryBody);

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
          rawDesc = rawDesc
            .replace(/<[^>]*>/g, "")
            .replace(/\s+/g, " ")
            .trim();
        } else {
          rawDesc = "";
        }
        const shortDesc = rawDesc.length > 200 ? rawDesc.slice(0, 197) + "..." : rawDesc;
        const assignee = this.extractPerson(d.fields?.["System.AssignedTo"] || d.fields?.["Assigned To"] || "");
        items.push({
          id: wid,
          title: String(d.fields?.["System.Title"] || d.fields?.["Title"] || "(no title)"),
          url: webUrl,
          status: state,
          assignee,
          description: shortDesc,
        });
      }
    }
    return items;
  }

  // -----------------------
  // Work Items - Categories
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
    return this.fetchWorkItemsByWiql(organization, q, projName, pat);
  }

  async fetchFollowing(organization: string, projectIdOrName?: string, pat?: string): Promise<AdoWorkItem[]> {
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
    return this.fetchWorkItemsByWiql(organization, q, projName, pat);
  }

  async fetchMentioned(organization: string, projectIdOrName?: string, pat?: string): Promise<AdoWorkItem[]> {
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
    return this.fetchWorkItemsByWiql(organization, q, projName, pat);
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
    return this.fetchWorkItemsByWiql(organization, q, projName, pat);
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
    return this.fetchWorkItemsByWiql(organization, q, projName, pat);
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
    return this.fetchWorkItemsByWiql(organization, q, projName, pat);
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
    return this.fetchWorkItemsByWiql(organization, q, projName, pat);
  }

  // -----------------------
  // Branches
  // -----------------------
  async fetchBranches(organization: string, repoIdOrName: string, pat?: string): Promise<AdoBranch[]> {
    const usePat = await this.resolvePat(organization, pat);
    if (!usePat) return [];
    const url = `https://dev.azure.com/${encodeURIComponent(organization)}/_apis/git/repositories/${encodeURIComponent(repoIdOrName)}/refs?filter=heads&api-version=6.0`;
    const data: any = await httpRequest("GET", url, usePat);
    const out: AdoBranch[] = [];
    if (data && Array.isArray(data.value)) {
      for (const r of data.value) {
        const name = String(r.name || r.ref || "");
        out.push({ name });
      }
    }
    return out;
  }

  async fetchRepositories(organization: string, projectIdOrName: string, pat?: string): Promise<AdoRepository[]> {
    const usePat = await this.resolvePat(organization, pat);
    if (!usePat) return [];
    const url = `https://dev.azure.com/${encodeURIComponent(organization)}/${encodeURIComponent(projectIdOrName)}/_apis/git/repositories?api-version=6.0`;
    const data: any = await httpRequest("GET", url, usePat);
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

  // -----------------------
  // Pull Requests
  // -----------------------
  async fetchPullRequests(organization: string, repoIdOrName: string, pat?: string): Promise<AdoPullRequest[]> {
    const usePat = await this.resolvePat(organization, pat);
    if (!usePat) return [];
    const url = `https://dev.azure.com/${encodeURIComponent(organization)}/_apis/git/pullrequests?searchCriteria.repositoryId=${encodeURIComponent(repoIdOrName)}&api-version=6.0`;
    const data: any = await httpRequest("GET", url, usePat);
    const out: AdoPullRequest[] = [];
    if (data && Array.isArray(data.value)) {
      for (const pr of data.value) {
        out.push({
          pullRequestId: Number(pr.pullRequestId || pr.id),
          title: String(pr.title || ""),
          url: pr._links?.web?.href || pr.url || "",
          status: pr.status,
          createdBy: pr.createdBy,
        });
      }
    }
    return out;
  }

  async fetchPullRequestsByStatus(organization: string, repoIdOrName: string, status: string, pat?: string): Promise<AdoPullRequest[]> {
    const usePat = await this.resolvePat(organization, pat);
    if (!usePat) return [];
    const url = `https://dev.azure.com/${encodeURIComponent(organization)}/_apis/git/pullrequests?searchCriteria.repositoryId=${encodeURIComponent(repoIdOrName)}&searchCriteria.status=${encodeURIComponent(status)}&api-version=6.0`;
    const data: any = await httpRequest("GET", url, usePat);
    const out: AdoPullRequest[] = [];
    if (data && Array.isArray(data.value)) {
      for (const pr of data.value) {
        const web = pr._links?.web?.href || undefined;
        const apiUrl = pr.url || pr._links?.self?.href || "";
        out.push({
          pullRequestId: Number(pr.pullRequestId || pr.id),
          title: String(pr.title || ""),
          url: apiUrl,
          webUrl: web,
          status: pr.status,
          createdBy: pr.createdBy,
        });
      }
    }
    return out;
  }

  async fetchPullRequestsMine(organization: string, repoIdOrName: string, pat?: string): Promise<AdoPullRequest[]> {
    const usePat = await this.resolvePat(organization, pat);
    if (!usePat) return [];
    const url = `https://dev.azure.com/${encodeURIComponent(organization)}/_apis/git/pullrequests?searchCriteria.repositoryId=${encodeURIComponent(repoIdOrName)}&api-version=6.0`;
    const data: any = await httpRequest("GET", url, usePat);
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
          out.push({
            pullRequestId: Number(pr.pullRequestId || pr.id),
            title: String(pr.title || ""),
            url: apiUrl,
            webUrl: web,
            status: pr.status,
            createdBy,
          });
        }
      }
    }
    return out;
  }

  // -----------------------
  // Private Utilities
  // -----------------------
  private async fetchCurrentProfile(organization: string, pat?: string): Promise<any> {
    if (this.currentProfileCache) return this.currentProfileCache;
    const usePat = await this.resolvePat(organization, pat);
    if (!usePat) return undefined;
    const url = `https://app.vssps.visualstudio.com/_apis/profile/profiles/me?api-version=6.0`;
    try {
      const data = await httpRequest("GET", url, usePat);
      this.currentProfileCache = data;
      return data;
    } catch (e) {
      return undefined;
    }
  }

  private async resolvePat(org: string, pat?: string): Promise<string | undefined> {
    if (pat) return pat;

    // キャッシュをチェック
    if (this.patCache[org]) return this.patCache[org];

    if (this.context) {
      try {
        const stored = await this.context.secrets.get(this.patKeyForOrg(org));
        if (stored) {
          this.patCache[org] = stored;
          return stored;
        }
      } catch (e) {}
    }
    // PAT プロンプト用コールバックがある場合は呼び出す
    if (this.patPromptCallback) {
      const pat = await this.patPromptCallback(org);
      if (pat) {
        this.patCache[org] = pat;
      }
      return pat;
    }
    return undefined;
  }

  async resolveProjectName(org: string, idOrName?: string): Promise<string> {
    if (!idOrName) return "";
    const findProj = () => (this.projectsByOrg[org] || []).find(p => p.id === idOrName || p.name === idOrName);
    let proj = findProj();
    if (!proj) {
      try {
        await this.fetchProjects(org);
      } catch (e) {}
      proj = findProj();
    }
    if (proj && proj.name) return proj.name;
    if (/^[0-9a-fA-F-]{32,36}$/.test(String(idOrName))) return "";
    return String(idOrName);
  }

  private patKeyForOrg(org: string): string {
    return `ado-assist.pat.${org}`;
  }

  extractPerson(field: any): string {
    try {
      if (!field) return "";
      if (typeof field === "string") return field;
      if ((field as any).displayName) return String((field as any).displayName);
      if ((field as any).uniqueName) return String((field as any).uniqueName);
      if ((field as any).id) return String((field as any).id);
      return String(field);
    } catch (e) {
      return "";
    }
  }

  buildWebUrl(org: string, projectName?: string, repoName?: string, type?: string, id?: string | number): string {
    switch (type) {
      case "project":
        return projectName ? `https://dev.azure.com/${encodeURIComponent(org)}/${encodeURIComponent(projectName)}` : `https://dev.azure.com/${encodeURIComponent(org)}`;
      case "workitemsRoot":
        return projectName ? `https://dev.azure.com/${encodeURIComponent(org)}/${encodeURIComponent(projectName)}/_workitems/recentlyupdated/` : `https://dev.azure.com/${encodeURIComponent(org)}/_workitems`;
      case "repo":
        return projectName && repoName ? `https://dev.azure.com/${encodeURIComponent(org)}/${encodeURIComponent(projectName)}/_git/${encodeURIComponent(repoName)}` : "";
      case "branch":
        return projectName && repoName && id ? `https://dev.azure.com/${encodeURIComponent(org)}/${encodeURIComponent(projectName)}/_git/${encodeURIComponent(repoName)}?version=GB${encodeURIComponent(String(id))}` : "";
      case "pr":
        return projectName && repoName && id ? `https://dev.azure.com/${encodeURIComponent(org)}/${encodeURIComponent(projectName)}/_git/${encodeURIComponent(repoName)}/pullrequest/${encodeURIComponent(String(id))}` : "";
      case "workitem":
        return projectName && id ? `https://dev.azure.com/${encodeURIComponent(org)}/${encodeURIComponent(projectName)}/_workitems/edit/${encodeURIComponent(String(id))}` : "";
      case "prsFolder":
        return projectName && repoName ? `https://dev.azure.com/${encodeURIComponent(org)}/${encodeURIComponent(projectName)}/_git/${encodeURIComponent(repoName)}/pullrequests?_a=mine` : "";
      default:
        return "";
    }
  }
}
