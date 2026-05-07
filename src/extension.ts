import * as vscode from "vscode";
import { createTreeProvider } from "./ado";

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

    // (removed unused helper commands: showView, savePat)

    // Enter PAT for a specific organization (used by tree items)
    context.subscriptions.push(
      vscode.commands.registerCommand("ado-assist.enterPatForOrg", async (orgArg?: any) => {
        try {
          const orgFromArg = typeof orgArg === "string" ? orgArg : orgArg?.organization || orgArg?.label;
          const org = orgFromArg || (await vscode.window.showInputBox({ prompt: "Organization for this PAT (e.g. myorg)" }));
          if (!org) return;
          const pat = await vscode.window.showInputBox({ prompt: `Enter Personal Access Token (PAT) for ${org}`, password: true });
          if (!pat) return;

          // Verify the PAT before saving
          channel.appendLine(`Starting PAT verification for organization: ${org}`);
          const client = provider.getClient();
          const isValid = await client.verifyPat(org, pat);
          channel.appendLine(`PAT verification result: ${isValid}`);

          if (!isValid) {
            const errorMsg = "Authentication failed. The PAT is invalid or has expired.";
            channel.appendLine(`Error: ${errorMsg}`);
            // キャッシュクリア → 組織ノードを展開して PAT 入力項目を表示
            provider.clearCacheForOrganization(org);
            await provider.revealOrganization(org);
            await vscode.window.showErrorMessage(errorMsg);
            return;
          }

          await context.secrets.store(`ado-assist.pat.${org}`, pat);
          channel.appendLine(`PAT successfully saved for organization: ${org}`);
          // キャッシュクリア→プロジェクト先行フェッチ→ツリー展開
          provider.clearCacheForOrganization(org);
          await provider.revealOrganization(org);
          await vscode.window.showInformationMessage(`PAT saved for ${org}`);
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          channel.appendLine(`Exception in enterPatForOrg: ${msg}`);
          await vscode.window.showErrorMessage("Failed to save PAT: " + msg);
        }
      }),
    );

    // Fetch projects command (removed; use per-organization fetch via context menu or view actions)

    // (removed unused refreshProjects command)

    // Open project/repo/pipeline URL
    context.subscriptions.push(
      vscode.commands.registerCommand("ado-assist.openUrl", async (arg?: any) => {
        try {
          const url = typeof arg === "string" ? arg : arg?.url || arg?._links?.web?.href || (arg?.command?.arguments && arg.command.arguments[0]);
          if (!url) return;
          channel.appendLine(`open url - url=${url}`);
          // Try to open with Live Server extension if installed (user requested ms-vscode.live-server)
          try {
            const tryExtIds = ["ms-vscode.live-server", "ritwickdey.LiveServer", "ritwickdey.liveserver"];
            const ext = tryExtIds.map(id => vscode.extensions.getExtension(id)).find(x => !!x);
            if (ext) {
              const cmds = ["liveServer.openBrowser", "liveServer.open", "extension.liveServer.goOnline", "liveServer.goOnline", "openInLiveServer", "openInBrowser"];
              for (const c of cmds) {
                try {
                  // many live-server commands accept a URL or will open the last served page
                  await vscode.commands.executeCommand(c, url);
                  channel.appendLine(`opened with extension command=${c}`);
                  return;
                } catch (e) {
                  // try next
                }
              }
            }
          } catch (e) {
            // ignore and fallback
          }

          // fallback to external browser
          await vscode.env.openExternal(vscode.Uri.parse(url));
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          vscode.window.showErrorMessage("Failed to open URL: " + msg);
        }
      }),
    );

    // Create Epic (open Azure DevOps create-Epic URL)
    context.subscriptions.push(
      vscode.commands.registerCommand("ado-assist.createEpic", async () => {
        try {
          const url = "https://dev.azure.com/taizod1024/bar-project/_workitems/create/Epic";
          await vscode.commands.executeCommand("ado-assist.openUrl", url);
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          vscode.window.showErrorMessage("Failed to open URL: " + msg);
        }
      }),
    );

    // Create Issue
    context.subscriptions.push(
      vscode.commands.registerCommand("ado-assist.createIssue", async () => {
        try {
          const url = "https://dev.azure.com/taizod1024/bar-project/_workitems/create/Issue";
          await vscode.commands.executeCommand("ado-assist.openUrl", url);
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          vscode.window.showErrorMessage("Failed to open URL: " + msg);
        }
      }),
    );

    // Create Task
    context.subscriptions.push(
      vscode.commands.registerCommand("ado-assist.createTask", async () => {
        try {
          const url = "https://dev.azure.com/taizod1024/bar-project/_workitems/create/Task";
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
          // prefer repo-specific construction when possible
          if (arg && typeof arg === "object") {
            const org = arg.organization || arg.org || undefined;
            const proj = arg.projectId || arg.project || undefined;
            const repo = arg.repoName || arg.repo || arg.repoId || undefined;
            if (org && proj && repo) {
              const url = `https://dev.azure.com/${encodeURIComponent(org)}/${encodeURIComponent(proj)}/_git/${encodeURIComponent(repo)}/pullrequestcreate`;
              await vscode.commands.executeCommand("ado-assist.openUrl", url);
              return;
            }
          }

          // fallback: open project-level pull requests hub or default create page
          const fallback = "https://dev.azure.com/taizod1024/bar-project/_git/_pullrequestcreate";
          await vscode.commands.executeCommand("ado-assist.openUrl", fallback);
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
            // prefer explicit repo clone url if available
            cloneUrl = arg.cloneUrl || arg.remoteUrl || arg.url || undefined;
            if (!cloneUrl) {
              const org = arg.organization || arg.org || undefined;
              const proj = arg.projectId || arg.project || undefined;
              const repo = arg.repoName || arg.repo || arg.repoId || undefined;
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
                orgFromNode = arg.organization || arg.org || undefined;
              }
              // if we have an org, look up stored PAT
              if (!orgFromNode) {
                // attempt to parse org from URL: https://dev.azure.com/{org}/...
                const m = cloneUrl.match(/^https:\/\/([^/]+)\/(?:_?git|[^/]+)\/(.*)$/i);
                if (m) {
                  // for dev.azure.com host, the org is the first path segment
                  const urlParts = cloneUrl.replace(/^https:\/\//i, "").split("/");
                  if (urlParts.length >= 1) orgFromNode = urlParts[0];
                }
              }

              if (orgFromNode && context) {
                const key = `ado-assist.pat.${orgFromNode}`;
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
              }
            }
          } catch (e) {
            // ignore secret read errors and proceed with original URL
            attemptUrl = cloneUrl;
          }

          // Log only host/path, do not emit PAT
          try {
            const safeLog = cloneUrl.replace(/^(https?:\/\/)(?:[^@]+@)?/, "$1");
            channel.appendLine(`clone repo - url=${safeLog}`);
          } catch (e) {}

          try {
            await vscode.commands.executeCommand("git.clone", attemptUrl);
          } catch (e) {
            // if git.clone not available or clone failed, fallback to opening URL
            try {
              await vscode.commands.executeCommand("ado-assist.openUrl", cloneUrl);
            } catch (ee) {
              vscode.window.showErrorMessage("Failed to clone or open repository: " + String(ee));
            }
          }
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

          // 3. PAT を検証
          channel.appendLine(`Starting PAT verification for organization: ${org}`);
          const client = provider.getClient();
          const isValid = await client.verifyPat(org, pat);
          channel.appendLine(`PAT verification result: ${isValid}`);

          // 4. org 登録（PAT の OK/NG に関わらず）
          provider.addOrganization(org);

          if (!isValid) {
            const errorMsg = "Authentication failed. The PAT is invalid or has expired.";
            channel.appendLine(`Error: ${errorMsg}`);
            // キャッシュクリア → 組織ノードを展開して PAT 入力項目を表示
            provider.clearCacheForOrganization(org);
            await provider.revealOrganization(org);
            await vscode.window.showErrorMessage(errorMsg);
            return;
          }

          // 5. PAT 保存 → ツリー展開
          await context.secrets.store(`ado-assist.pat.${org}`, pat);
          channel.appendLine(`PAT successfully saved for organization: ${org}`);
          provider.clearCacheForOrganization(org);
          await provider.revealOrganization(org);
          await vscode.window.showInformationMessage(`Organization "${org}" added.`);
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
            if (typeof arg.description === "string" && arg.description.trim()) description = arg.description;
            else if (arg.fields && typeof arg.fields["System.Description"] === "string") description = arg.fields["System.Description"];
            else if (typeof arg.body === "string") description = arg.body;
          }

          const parts = [`work item: #${workItemNum}`, `title: ${title}`, `description: ${description}`];
          const query = parts.join("\n");
          channel.appendLine(`sendWorkItemToCopilot - workItem=${workItemNum}, title=${title}`);
          await vscode.commands.executeCommand("workbench.action.chat.open", { query });
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          vscode.window.showErrorMessage("Failed to send to GitHub Copilot: " + msg);
        }
      }),
    );

    // (removed unused viewMenu command - view title uses direct contributes.commands)
  } catch (err) {
    channel.appendLine("error registering provider: " + String(err));
  }
  channel.appendLine("activate() end");
  // attempt to force reveal the view after a short delay
  setTimeout(async () => {
    try {
      channel.appendLine("attempting automatic reveal of side panel");
      await vscode.commands.executeCommand("workbench.view.extension.azureDevOps");
      try {
        // try the newer openView command if available
        // @ts-ignore
        await vscode.commands.executeCommand("workbench.views.openView", "azureDevOps.sidePanel", true);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        channel.appendLine("optional openView failed: " + msg);
      }
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
