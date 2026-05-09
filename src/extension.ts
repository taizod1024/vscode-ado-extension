import * as vscode from "vscode";
import { execSync } from "child_process";
import { createTreeProvider, httpRequest, ERROR_MESSAGES } from "./ado";

export function activate(context: vscode.ExtensionContext) {
  // Create output channel
  const channel = vscode.window.createOutputChannel("Azure DevOps Assist", { log: true });

  channel.appendLine("Azure DevOps Assist activated");
  channel.appendLine("activate() start");
  try {
    // Register a TreeDataProvider for the side panel view id
    const provider = createTreeProvider(context, channel);
    const treeView = vscode.window.createTreeView("azureDevOps.sidePanel", { treeDataProvider: provider });
    context.subscriptions.push(treeView);
    provider.setTreeView(treeView);

    channel.appendLine("registered TreeDataProvider for azureDevOps.sidePanel");
    channel.appendLine("extension path: " + context.extensionPath);

    // -----------------------
    // Common Context Extraction Helper
    // -----------------------
    /**
     * ツリーノードから組織・プロジェクト情報を統一的に抽出。
     * @param arg ツリーノード引数
     * @returns { org, projectId, repo }
     */
    const extractContext = (arg?: any): { org?: string; projectId?: string; repo?: string } => {
      return {
        org: arg?.organization || arg?.org,
        projectId: arg?.projectId || arg?.project,
        repo: arg?.repoName || arg?.repo || arg?.repoId,
      };
    };

    // -----------------------
    // Common PAT Validation Handler
    // -----------------------
    /**
     * PAT の検証と保存を行う共通ハンドラー。
     * @param org 組織名
     * @param pat Personal Access Token
     * @param addOrgToProvider true の場合、成功時に provider.addOrganization() を呼び出す
     * @returns 成功時は true、失敗時は false
     */
    const handlePatValidationAndSave = async (org: string, pat: string, addOrgToProvider: boolean = false): Promise<boolean> => {
      try {
        // PAT を検証
        channel.appendLine(`Starting PAT verification for organization: ${org}`);
        const client = provider.getClient();
        const isValid = await client.verifyPat(org, pat);
        channel.appendLine(`PAT verification result: ${isValid}`);

        if (!isValid) {
          const errorMsg = ERROR_MESSAGES.PAT_INVALID;
          channel.appendLine(`Error: ${errorMsg}`);
          provider.clearCacheForOrganization(org);
          await provider.revealOrganization(org);
          await vscode.window.showErrorMessage(errorMsg);
          return false;
        }

        // PAT 保存
        await context.secrets.store(`ado-assist.pat.${org}`, pat);
        channel.appendLine(`PAT successfully saved for organization: ${org}`);

        // 組織を追加（if requested）
        if (addOrgToProvider) {
          provider.addOrganization(org);
        }

        // キャッシュクリア→プロジェクト先行フェッチ→ツリー展開
        provider.clearCacheForOrganization(org);
        await provider.revealOrganization(org);

        const successMsg = addOrgToProvider ? `Organization "${org}" added.` : `PAT saved for ${org}`;
        await vscode.window.showInformationMessage(successMsg);
        return true;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        channel.appendLine(`Exception in PAT handling: ${msg}`);
        await vscode.window.showErrorMessage("Failed to save PAT: " + msg);
        return false;
      }
    };

    // Enter PAT for a specific organization (used by tree items)
    context.subscriptions.push(
      vscode.commands.registerCommand("ado-assist.enterPatForOrg", async (orgArg?: any) => {
        try {
          const orgFromArg = typeof orgArg === "string" ? orgArg : orgArg?.organization || orgArg?.label;
          const org = orgFromArg || (await vscode.window.showInputBox({ prompt: "Organization for this PAT (e.g. myorg)" }));
          if (!org) return;
          const pat = await vscode.window.showInputBox({ prompt: `Enter Personal Access Token (PAT) for ${org}`, password: true });
          if (!pat) return;

          await handlePatValidationAndSave(org, pat, false);
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          channel.appendLine(`Exception in enterPatForOrg: ${msg}`);
          await vscode.window.showErrorMessage("Failed to save PAT: " + msg);
        }
      }),
    );

    // Open Work Items
    context.subscriptions.push(
      vscode.commands.registerCommand("ado-assist.openWorkItems", async (arg?: any) => {
        try {
          // arg から organization と projectId を抽出して work items URL を構築
          const { org, projectId } = extractContext(arg);
          if (!org || !projectId) {
            vscode.window.showErrorMessage("Could not extract organization/project from context.");
            return;
          }
          const url = `https://dev.azure.com/${encodeURIComponent(org)}/${encodeURIComponent(projectId)}/_workitems/recentlyupdated/`;
          channel.appendLine(`open work items url - url=${url}`);

          await vscode.commands.executeCommand("simpleBrowser.show", url);
          channel.appendLine("opened with integrated browser");
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          channel.appendLine(`Failed to open URL: ${msg}`);
          vscode.window.showErrorMessage("Failed to open URL: " + msg);
        }
      }),
    );

    // Refresh iteration items (keep current filter)
    context.subscriptions.push(
      vscode.commands.registerCommand("ado-assist.refreshIterationItems", async (arg?: any) => {
        provider.refreshIterationItems(arg);
      }),
    );

    // Open project/repo/pipeline URL (integrated browser only)
    context.subscriptions.push(
      vscode.commands.registerCommand("ado-assist.openUrl", async (arg?: any) => {
        try {
          let url: string = "";
          if (typeof arg === "string") {
            url = arg;
          } else if (arg && typeof arg === "object") {
            // Use getWebUrl() helper to extract Web URL with fallback logic
            const client = provider.getClient();
            url = client.getWebUrl(arg);
          }

          if (!url) return;
          channel.appendLine(`open url - url=${url}`);

          await vscode.commands.executeCommand("simpleBrowser.show", url);
          channel.appendLine("opened with integrated browser");
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          channel.appendLine(`Failed to open URL: ${msg}`);
          vscode.window.showErrorMessage("Failed to open URL: " + msg);
        }
      }),
    );

    // Create Epic (open Azure DevOps create-Epic URL)
    context.subscriptions.push(
      vscode.commands.registerCommand("ado-assist.createEpic", async (arg?: any) => {
        try {
          const { org, projectId: proj } = extractContext(arg);
          if (!org || !proj) {
            vscode.window.showErrorMessage("Could not extract organization/project from context.");
            return;
          }
          let url = `https://dev.azure.com/${encodeURIComponent(org)}/${encodeURIComponent(proj)}/_workitems/create/Epic`;
          if (arg?.iterationPath) url += `?[System.IterationPath]=${encodeURIComponent(arg.iterationPath)}`;
          await vscode.commands.executeCommand("ado-assist.openUrl", url);
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          vscode.window.showErrorMessage("Failed to open URL: " + msg);
        }
      }),
    );

    // Create Issue
    context.subscriptions.push(
      vscode.commands.registerCommand("ado-assist.createIssue", async (arg?: any) => {
        try {
          const { org, projectId: proj } = extractContext(arg);
          if (!org || !proj) {
            vscode.window.showErrorMessage("Could not extract organization/project from context.");
            return;
          }
          let url = `https://dev.azure.com/${encodeURIComponent(org)}/${encodeURIComponent(proj)}/_workitems/create/Issue`;
          if (arg?.iterationPath) url += `?[System.IterationPath]=${encodeURIComponent(arg.iterationPath)}`;
          await vscode.commands.executeCommand("ado-assist.openUrl", url);
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          vscode.window.showErrorMessage("Failed to open URL: " + msg);
        }
      }),
    );

    // Create Task
    context.subscriptions.push(
      vscode.commands.registerCommand("ado-assist.createTask", async (arg?: any) => {
        try {
          const { org, projectId: proj } = extractContext(arg);
          if (!org || !proj) {
            vscode.window.showErrorMessage("Could not extract organization/project from context.");
            return;
          }
          let url = `https://dev.azure.com/${encodeURIComponent(org)}/${encodeURIComponent(proj)}/_workitems/create/Task`;
          if (arg?.iterationPath) url += `?[System.IterationPath]=${encodeURIComponent(arg.iterationPath)}`;
          await vscode.commands.executeCommand("ado-assist.openUrl", url);
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          vscode.window.showErrorMessage("Failed to open URL: " + msg);
        }
      }),
    );

    // Create Pull Request
    context.subscriptions.push(
      vscode.commands.registerCommand("ado-assist.createPullRequest", async (arg?: any) => {
        try {
          const { org, projectId: proj, repo } = extractContext(arg);
          if (!org || !proj || !repo) {
            vscode.window.showErrorMessage("Could not extract organization/project/repository from context.");
            return;
          }
          const url = `https://dev.azure.com/${encodeURIComponent(org)}/${encodeURIComponent(proj)}/_git/${encodeURIComponent(repo)}/pullrequestcreate`;
          await vscode.commands.executeCommand("ado-assist.openUrl", url);
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          vscode.window.showErrorMessage("Failed to open URL: " + msg);
        }
      }),
    );

    // Create Sprint
    context.subscriptions.push(
      vscode.commands.registerCommand("ado-assist.createSprint", async (arg?: any) => {
        try {
          const { org, projectId: proj } = extractContext(arg);
          if (!org || !proj) {
            vscode.window.showErrorMessage("Could not extract organization/project from context.");
            return;
          }
          const url = `https://dev.azure.com/${encodeURIComponent(org)}/${encodeURIComponent(proj)}/_sprints/directory`;
          await vscode.commands.executeCommand("ado-assist.openUrl", url);
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          vscode.window.showErrorMessage("Failed to open URL: " + msg);
        }
      }),
    );

    // Clone Repository
    context.subscriptions.push(
      vscode.commands.registerCommand("ado-assist.cloneRepo", async (arg?: any) => {
        try {
          let cloneUrl: string | undefined;
          if (typeof arg === "string") {
            cloneUrl = arg;
          } else if (arg && typeof arg === "object") {
            // Use getCloneUrl() helper to extract Clone URL with fallback logic
            const client = provider.getClient();
            cloneUrl = client.getCloneUrl(arg);
            if (!cloneUrl) {
              const { org, projectId: proj, repo } = extractContext(arg);
              if (org && proj && repo) {
                cloneUrl = `https://dev.azure.com/${encodeURIComponent(org)}/${encodeURIComponent(proj)}/_git/${encodeURIComponent(repo)}`;
              }
            }
          }

          if (!cloneUrl) {
            cloneUrl = await vscode.window.showInputBox({ prompt: "Enter repository clone URL" });
            if (!cloneUrl) return;
          }

          // Attempt to embed PAT for Azure DevOps HTTPS clones when available
          let attemptUrl = cloneUrl;
          try {
            if (cloneUrl && !cloneUrl.includes("@") && typeof cloneUrl === "string") {
              // try to extract org from node if available
              let orgFromNode: string | undefined;
              if (typeof arg === "object" && arg) {
                const { org } = extractContext(arg);
                orgFromNode = org;
              }
              // if we have an org, look up stored PAT
              if (!orgFromNode) {
                // attempt to parse org from URL: https://dev.azure.com/{org}/...
                const urlParts = cloneUrl.replace(/^https:\/\//i, "").split("/");
                if (urlParts.length >= 1) orgFromNode = urlParts[0];
              }

              if (orgFromNode && context) {
                const key = `ado-assist.pat.${orgFromNode}`;
                try {
                  const pat = await context.secrets.get(key);
                  if (pat) {
                    // embed PAT safely (username 'PAT' used as placeholder)
                    if (cloneUrl.startsWith("https://")) {
                      const rest = cloneUrl.slice("https://".length);
                      attemptUrl = `https://PAT:${encodeURIComponent(pat)}@${rest}`;
                    } else if (cloneUrl.startsWith("http://")) {
                      const rest = cloneUrl.slice("http://".length);
                      attemptUrl = `http://PAT:${encodeURIComponent(pat)}@${rest}`;
                    }
                  }
                } catch (secretErr) {
                  // Log secret read error but proceed with original URL
                  const secretMsg = secretErr instanceof Error ? secretErr.message : String(secretErr);
                  channel.appendLine(`Warning: Failed to retrieve PAT for ${orgFromNode}: ${secretMsg}`);
                  attemptUrl = cloneUrl;
                }
              }
            }
          } catch (e) {
            // General error handling: proceed with original URL
            const errMsg = e instanceof Error ? e.message : String(e);
            channel.appendLine(`Warning: Failed to embed PAT: ${errMsg}`);
            attemptUrl = cloneUrl;
          }

          // Log only host/path, do not emit PAT
          try {
            const safeLog = cloneUrl.replace(/^(https?:\/\/)(?:[^@]+@)?/, "$1");
            channel.appendLine(`clone repo - url=${safeLog}`);
          } catch (e) {}

          await vscode.commands.executeCommand("git.clone", attemptUrl);
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          vscode.window.showErrorMessage("Failed to clone repository: " + msg);
        }
      }),
    );
    // Add organization
    context.subscriptions.push(
      vscode.commands.registerCommand("ado-assist.addOrganization", async () => {
        try {
          // 1. org 名を入力
          const org = await vscode.window.showInputBox({ prompt: "Organization name to add (e.g. myorg)" });
          if (!org) return;
          const existing = context.globalState.get<string[]>("azuredevops.organizations") || [];
          if (existing.includes(org)) {
            vscode.window.showErrorMessage(`Organization "${org}" is already registered.`);
            return;
          }

          // 2. PAT を入力
          const pat = await vscode.window.showInputBox({ prompt: `Enter Personal Access Token (PAT) for ${org}`, password: true });
          if (!pat) return;

          // 3. PAT を検証・保存して org を追加
          await handlePatValidationAndSave(org, pat, true);
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          vscode.window.showErrorMessage("Failed to add organization: " + msg);
        }
      }),
    );

    // Remove organization
    context.subscriptions.push(
      vscode.commands.registerCommand("ado-assist.removeOrganization", async (orgArg?: any) => {
        try {
          const pick = typeof orgArg === "string" ? orgArg : orgArg?.organization || orgArg?.label;
          if (!pick) return;
          const confirm = await vscode.window.showQuickPick([`REMOVE ${pick}`, "CANCEL"], {
            placeHolder: `Remove organization ${pick} and its PAT?`,
          });
          if (confirm !== `REMOVE ${pick}`) return;
          provider.removeOrganization(pick);
          await context.secrets.delete(`ado-assist.pat.${pick}`);
          vscode.window.showInformationMessage(`Removed organization ${pick}`);
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          vscode.window.showErrorMessage("Failed to remove organization: " + msg);
        }
      }),
    );

    // Remove all organizations + delete stored PATs
    context.subscriptions.push(
      vscode.commands.registerCommand("ado-assist.removeAllOrganizations", async () => {
        try {
          const orgs = context.globalState.get<string[]>("azuredevops.organizations") || [];
          if (orgs.length === 0) {
            vscode.window.showInformationMessage("No organizations to remove");
            return;
          }
          const confirm = await vscode.window.showQuickPick(["REMOVE ALL ORGANIZATIONS", "CANCEL"], { placeHolder: "Remove all organizations and their PATs?" });
          if (confirm !== "REMOVE ALL ORGANIZATIONS") return;
          await provider.removeAllOrganizations();
          vscode.window.showInformationMessage(`Removed ${orgs.length} organizations and their PATs`);
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          vscode.window.showErrorMessage("Failed to remove organizations: " + msg);
        }
      }),
    );

    // Fetch organization command removed: org refresh no longer triggers fetch from UI

    // Refresh a specific node (organization/project/category/repo) or full tree
    context.subscriptions.push(
      vscode.commands.registerCommand("ado-assist.refreshNode", async (element?: any) => {
        try {
          if (!provider || !provider.refreshNode) {
            vscode.window.showInformationMessage("Provider refresh not available");
            return;
          }
          await provider.refreshNode(element);
          // 組織ノードのリフレッシュ後は展開して表示
          const org = typeof element === "string" ? element : element?.organization;
          if (org) {
            await provider.revealOrganization(org);
          }
          vscode.window.showInformationMessage("Refreshed");
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          vscode.window.showErrorMessage("Failed to refresh: " + msg);
        }
      }),
    );

    // Iteration Items filter commands
    const iterFilters: [string, number][] = [
      ["ado-assist.setIterationItemFilter.all", 0],
      ["ado-assist.setIterationItemFilter.assigned", 1],
      ["ado-assist.setIterationItemFilter.myactivity", 2],
      ["ado-assist.setIterationItemFilter.active", 3],
    ];
    for (const [cmd, idx] of iterFilters) {
      context.subscriptions.push(
        vscode.commands.registerCommand(cmd, (filterBtnArg?: any) => {
          try {
            const folderElement = filterBtnArg?.folderRef;
            if (!folderElement) return;
            provider.setIterationItemFilter(folderElement, idx);
          } catch (err) {
            channel.appendLine(`${cmd} error: ${err instanceof Error ? err.message : String(err)}`);
          }
        }),
      );
    }

    // Pull Requests filter: individual commands
    const prFilters: [string, number][] = [
      ["ado-assist.setPrFilter.mine", 0],
      ["ado-assist.setPrFilter.active", 1],
      ["ado-assist.setPrFilter.completed", 2],
      ["ado-assist.setPrFilter.abandoned", 3],
    ];
    for (const [cmd, idx] of prFilters) {
      context.subscriptions.push(
        vscode.commands.registerCommand(cmd, (filterBtnArg?: any) => {
          try {
            const folderElement = filterBtnArg?.folderRef;
            if (!folderElement) return;
            provider.setPrFilter(folderElement, idx);
          } catch (err) {
            channel.appendLine(`${cmd} error: ${err instanceof Error ? err.message : String(err)}`);
          }
        }),
      );
    }

    // Send Work Item to GitHub Copilot Chat
    context.subscriptions.push(
      vscode.commands.registerCommand("ado-assist.sendWorkItemToCopilot", async (arg?: any) => {
        try {
          const getLabel = (item: any): string => {
            if (typeof item?.label === "string") return item.label;
            if (typeof item?.label?.label === "string") return item.label.label;
            return String(item?.label ?? "");
          };

          // work item number extraction
          let workItemNum = "";
          try {
            if (arg && typeof arg === "object") {
              if (typeof arg.id === "number") workItemNum = String(arg.id);
              else if (typeof arg.id === "string") {
                const m1 = arg.id.match(/work:[^:]+:(\d+)/);
                const m2 = arg.id.match(/:(\d+)$/);
                if (m1) workItemNum = m1[1];
                else if (m2) workItemNum = m2[1];
              }
              if (!workItemNum) {
                const label = getLabel(arg);
                const m3 = String(label).match(/^#(\d+)/);
                if (m3) workItemNum = m3[1];
              }
            }
          } catch (e) {}

          // title
          let title = "";
          if (arg && typeof arg === "object") {
            if (typeof arg.title === "string" && arg.title.trim()) title = arg.title.trim();
            else {
              const label = getLabel(arg);
              title = String(label)
                .replace(/^#\d+\s*/, "")
                .trim();
            }
          } else if (typeof arg === "string") {
            title = arg;
          }

          // description
          let description = "";
          if (arg && typeof arg === "object") {
            if (arg.fields && typeof arg.fields["System.Description"] === "string") {
              description = arg.fields["System.Description"];
            } else if (typeof arg.body === "string") {
              description = arg.body;
            } else if (workItemNum && arg.organization) {
              // API から work item の詳細を取得
              try {
                const client = provider.getClient();
                const pat = await context.secrets.get(`ado-assist.pat.${arg.organization}`);
                const url = `https://dev.azure.com/${encodeURIComponent(arg.organization)}/_apis/wit/workitems/${workItemNum}?api-version=6.0`;
                const response: any = await httpRequest("GET", url, pat || "", undefined, { channel });
                if (response && response.fields) {
                  description = response.fields["System.Description"] || response.fields["Description"] || "";
                }
              } catch (e) {
                channel.appendLine(`Failed to fetch work item details: ${e}`);
              }
            }
          }
          // HTML タグを削除
          description = description.replace(/<[^>]*>/g, "");

          const query = `**work item**: #${workItemNum}\n**title**: ${title}\n**description**:\n${description}`;
          channel.appendLine(`sendWorkItemToCopilot - workItem=${workItemNum}, title=${title}`);
          await vscode.commands.executeCommand("workbench.action.chat.open", { query });
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          vscode.window.showErrorMessage("Failed to send to GitHub Copilot: " + msg);
        }
      }),
    );

    // Create branch for work item
    context.subscriptions.push(
      vscode.commands.registerCommand("ado-assist.createBranchForWorkItem", async (arg?: any) => {
        try {
          // Extract work item ID
          let workItemNum = "";
          if (arg && typeof arg === "object") {
            if (typeof arg.id === "number") workItemNum = String(arg.id);
            else if (typeof arg.id === "string") {
              const m1 = arg.id.match(/work:[^:]+:(\d+)/);
              const m2 = arg.id.match(/:(\d+)$/);
              if (m1) workItemNum = m1[1];
              else if (m2) workItemNum = m2[1];
            }
          }

          if (!workItemNum) {
            vscode.window.showErrorMessage("Could not extract work item number");
            return;
          }

          // Extract organization from arg (must be provided)
          const organization = arg?.organization || arg?.orgName || "";
          if (!organization) {
            const msg = "Could not extract organization from work item context. Please try again from the tree view.";
            channel.appendLine(`Error: ${msg}`);
            vscode.window.showErrorMessage(msg);
            return;
          }
          channel.appendLine(`Organization from context: ${organization}`);

          // Extract project ID from arg (must be provided)
          const projectId = arg?.projectId || arg?.projectName || "";
          if (!projectId) {
            const msg = "Could not extract project ID from work item context. Please try again from the tree view.";
            channel.appendLine(`Error: ${msg}`);
            vscode.window.showErrorMessage(msg);
            return;
          }
          channel.appendLine(`Project ID from context: ${projectId}`);

          // Get title
          let title = "";
          if (arg && typeof arg === "object") {
            if (typeof arg.title === "string" && arg.title.trim()) title = arg.title.trim();
            else {
              const label = typeof arg?.label === "string" ? arg.label : String(arg?.label ?? "");
              title = String(label)
                .replace(/^#\d+\s*/, "")
                .trim();
            }
          }

          // Sanitize title for branch name
          const sanitizedTitle = title
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, "_")
            .replace(/^_|_$/g, "");

          // Get branch prefix from settings
          const config = vscode.workspace.getConfiguration("adoAssist");
          const branchPrefix = config.get<string>("branchPrefix") || "working";

          // Get git username
          let username = "";
          try {
            username = execSync("git config user.name", { encoding: "utf-8", stdio: "pipe" }).trim();
          } catch (e) {
            channel.appendLine(`Failed to get git username: ${e}`);
            username = "user";
          }

          const branchName = `${branchPrefix}/${username}/#${workItemNum}_${sanitizedTitle}`;

          // Get working directory (try multiple sources)
          const wsFolder = vscode.workspace.workspaceFolders?.[0];
          const cwd = wsFolder?.uri?.fsPath;
          channel.appendLine(`createBranchForWorkItem: workspace folder cwd=${cwd}`);

          // Verify that we have a valid git repository
          if (!cwd) {
            const msg = "No workspace folder found. Please open a folder in VS Code.";
            channel.appendLine(`Error: ${msg}`);
            vscode.window.showErrorMessage(msg);
            return;
          }

          // Check if it's a git repository by running git rev-parse --git-dir
          try {
            execSync("git rev-parse --git-dir", {
              encoding: "utf-8",
              stdio: "pipe",
              cwd,
            });
            channel.appendLine(`Verified git repository at: ${cwd}`);
          } catch (e) {
            const msg = `Not a git repository at ${cwd}. Please initialize git or open the correct folder.`;
            channel.appendLine(`Error: ${String(e)}`);
            vscode.window.showErrorMessage(msg);
            return;
          }

          // Check organization and project match using git remote -v
          try {
            const remotes = execSync("git remote -v", {
              encoding: "utf-8",
              stdio: "pipe",
              cwd,
            });
            channel.appendLine(`git remote -v output:\n${remotes}`);

            // Extract organization and project from git remote URL
            // URL format: https://[PAT]@dev.azure.com/{org}/{project}/_git/{repo}
            // or: git@ssh.dev.azure.com:v3/{org}/{project}/_git/{repo}
            const httpsPattern = /dev\.azure\.com\/([^\/]+)\/([^\/]+)\//;
            const sshPattern = /git@ssh\.dev\.azure\.com:v3\/([^\/]+)\/([^\/]+)\//;

            let remoteOrg: string | undefined;
            let remoteProject: string | undefined;

            // Try HTTPS format first
            const httpsMatch = remotes.match(httpsPattern);
            if (httpsMatch && httpsMatch[1] && httpsMatch[2]) {
              remoteOrg = httpsMatch[1];
              remoteProject = httpsMatch[2];
            } else {
              // Try SSH format
              const sshMatch = remotes.match(sshPattern);
              if (sshMatch && sshMatch[1] && sshMatch[2]) {
                remoteOrg = sshMatch[1];
                remoteProject = sshMatch[2];
              }
            }

            if (!remoteOrg || !remoteProject) {
              const msg = "Could not extract organization/project from git remote. The repository may not be connected to Azure DevOps.";
              channel.appendLine(`Error: ${msg}`);
              vscode.window.showErrorMessage(msg);
              return;
            }

            channel.appendLine(`Extracted from remote: org=${remoteOrg}, project=${remoteProject}`);

            if (remoteOrg !== organization) {
              const msg = `Organization mismatch: selected organization is '${organization}', but git remote points to '${remoteOrg}'. Please open the correct project folder.`;
              channel.appendLine(`Error: ${msg}`);
              vscode.window.showErrorMessage(msg);
              return;
            }

            if (remoteProject !== projectId) {
              const msg = `Project mismatch: selected project is '${projectId}', but git remote points to '${remoteProject}'. Please open the correct project folder.`;
              channel.appendLine(`Error: ${msg}`);
              vscode.window.showErrorMessage(msg);
              return;
            }

            channel.appendLine(`Organization and project match verified: ${organization}/${projectId}`);
          } catch (e) {
            const msg = `Failed to verify organization/project: ${String(e)}`;
            channel.appendLine(`Error: ${msg}`);
            vscode.window.showErrorMessage(msg);
            return;
          }

          // Check if branch already exists using git branch --list
          let branchExists = false;
          try {
            const branches = execSync("git branch --list", {
              encoding: "utf-8",
              stdio: "pipe",
              cwd,
            });
            branchExists = branches.includes(branchName);
            channel.appendLine(`Branch check result: exists=${branchExists}, cwd=${cwd}`);
          } catch (e) {
            channel.appendLine(`Failed to check branch: ${String(e)}`);
          }

          // Create or checkout branch using the active terminal
          try {
            let terminal = vscode.window.activeTerminal;
            if (!terminal) {
              terminal = vscode.window.createTerminal("Azure DevOps");
            }

            const cmd = branchExists ? `git checkout "${branchName}"` : `git checkout -b "${branchName}"`;

            // If cwd is available, navigate to it first before running git command
            if (cwd) {
              channel.appendLine(`Terminal: cd "${cwd}"`);
              terminal.sendText(`cd "${cwd}"`, true);
              // Wait a brief moment for cd to complete
              await new Promise(resolve => setTimeout(resolve, 100));
            }

            channel.appendLine(`Executing: ${cmd}`);
            terminal.sendText(cmd, true);
            // terminal.show();  // Don't show terminal, just send the command

            const msg = branchExists ? `Switched to branch: ${branchName}` : `New branch created: ${branchName}`;
            vscode.window.showInformationMessage(msg);
            channel.appendLine(msg);
          } catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            channel.appendLine(`Failed to create/checkout branch: ${msg}`);
            vscode.window.showErrorMessage(`Failed to create/checkout branch: ${msg}`);
          }
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          channel.appendLine(`Exception in createBranchForWorkItem: ${msg}`);
          vscode.window.showErrorMessage("Failed to create branch: " + msg);
        }
      }),
    );

    // Open settings
    context.subscriptions.push(
      vscode.commands.registerCommand("ado-assist.openSettings", async () => {
        try {
          await vscode.commands.executeCommand("workbench.action.openSettings", "adoAssist.");
          channel.appendLine("Opened settings for adoAssist");
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          channel.appendLine(`Failed to open settings: ${msg}`);
          vscode.window.showErrorMessage("Failed to open settings: " + msg);
        }
      }),
    );
  } catch (err) {
    channel.appendLine("error registering provider: " + String(err));
  }
  channel.appendLine("activate() end");
  // attempt to force reveal the view after a short delay
  setTimeout(async () => {
    try {
      channel.appendLine("attempting automatic reveal of side panel");
      await vscode.commands.executeCommand("workbench.view.extension.azureDevOps");
      channel.appendLine("automatic reveal attempt finished");
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      channel.appendLine("automatic reveal setup error: " + msg);
    }
  }, 500);
}

export function deactivate() {
  // no-op
}
