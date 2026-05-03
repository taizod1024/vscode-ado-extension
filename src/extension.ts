import * as vscode from "vscode";
import { createTreeProvider } from "./ado";

export function activate(context: vscode.ExtensionContext) {
  console.log("ado-assist: activate() start");
  try {
    // Register a TreeDataProvider for the side panel view id
    const provider = createTreeProvider(context);
    context.subscriptions.push(vscode.window.registerTreeDataProvider("azureDevOps.sidePanel", provider));
    console.log("ado-assist: registered TreeDataProvider for", "azureDevOps.sidePanel");
    console.log("ado-assist: extension path:", context.extensionPath);

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
          await context.secrets.store(`ado-assist.pat.${org}`, pat);
          vscode.window.showInformationMessage(`PAT saved for ${org}`);
          // Trigger a refresh of the tree since the PAT is now available
          try {
            provider.refresh();
          } catch (e) {
            // ignore refresh errors here
          }
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          vscode.window.showErrorMessage("Failed to save PAT: " + msg);
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
          console.log(`ado-assist: open url - url=${url}`);
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
                  console.log(`ado-assist: opened with extension command=${c}`);
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
            console.log(`ado-assist: clone repo - url=${safeLog}`);
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
          const org = await vscode.window.showInputBox({ prompt: "Organization name to add (e.g. myorg)" });
          if (!org) return;
          provider.addOrganization(org);
          vscode.window.showInformationMessage(`Added organization ${org}`);
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          vscode.window.showErrorMessage("Failed to add organization: " + msg);
        }
      }),
    );

    // Remove organization
    context.subscriptions.push(
      vscode.commands.registerCommand("ado-assist.removeOrganization", async () => {
        try {
          const orgs = context.globalState.get<string[]>("azuredevops.organizations") || [];
          if (orgs.length === 0) {
            vscode.window.showInformationMessage("No organizations to remove");
            return;
          }
          const pick = await vscode.window.showQuickPick(orgs, { placeHolder: "Select organization to remove" });
          if (!pick) return;
          const confirm = await vscode.window.showQuickPick(["REMOVE", "CANCEL"], {
            placeHolder: `Confirm remove organization ${pick}?`,
          });
          if (confirm !== "REMOVE") return;
          provider.removeOrganization(pick);
          vscode.window.showInformationMessage(`Removed organization ${pick}`);
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          vscode.window.showErrorMessage("Failed to remove organization: " + msg);
        }
      }),
    );

    // Clear all organizations + delete stored PATs
    context.subscriptions.push(
      vscode.commands.registerCommand("ado-assist.clearOrganizations", async () => {
        try {
          const orgs = context.globalState.get<string[]>("azuredevops.organizations") || [];
          if (orgs.length === 0) {
            vscode.window.showInformationMessage("No organizations to clear");
            return;
          }
          const confirm = await vscode.window.showQuickPick(["CLEAR", "CANCEL"], { placeHolder: "CLEAR ALL ORGANIZATIONS" });
          if (confirm !== "CLEAR") return;
          // delete PATs
          for (const o of orgs) {
            try {
              await context.secrets.delete(`ado-assist.pat.${o}`);
            } catch (e) {
              // ignore per-org deletion errors
            }
          }
          // clear provider state (provider now also removes stored PATs)
          if (provider && provider.clearOrganizations) await provider.clearOrganizations();
          vscode.window.showInformationMessage(`Cleared ${orgs.length} organizations and their PATs`);
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          vscode.window.showErrorMessage("Failed to clear organizations: " + msg);
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
          vscode.window.showInformationMessage("Refreshed");
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          vscode.window.showErrorMessage("Failed to refresh: " + msg);
        }
      }),
    );

    // (removed unused viewMenu command - view title uses direct contributes.commands)
  } catch (err) {
    console.error("ado-assist: error registering provider", err);
  }
  console.log("ado-assist: activate() end");
  // attempt to force reveal the view after a short delay
  setTimeout(async () => {
    try {
      console.log("ado-assist: attempting automatic reveal of side panel");
      await vscode.commands.executeCommand("workbench.view.extension.azureDevOps");
      try {
        // try the newer openView command if available
        // @ts-ignore
        await vscode.commands.executeCommand("workbench.views.openView", "azureDevOps.sidePanel", true);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.log("ado-assist: optional openView failed", msg);
      }
      console.log("ado-assist: automatic reveal attempt finished");
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error("ado-assist: automatic reveal setup error", msg);
    }
  }, 500);
}

export function deactivate() {
  // no-op
}
