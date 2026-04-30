import * as vscode from "vscode";
import { createTreeProvider } from "./AzureDevOps";

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
          // trigger a refresh/fetch for this org if provider is available
          try {
            await provider.fetchProjects(org);
          } catch (e) {
            // ignore fetch errors here
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
      vscode.commands.registerCommand("ado-assist.openProject", async (arg?: any) => {
        try {
          const url = typeof arg === "string" ? arg : arg?.url || arg?._links?.web?.href || (arg?.command?.arguments && arg.command.arguments[0]);
          if (!url) return;
          await vscode.env.openExternal(vscode.Uri.parse(url));
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          vscode.window.showErrorMessage("Failed to open URL: " + msg);
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
          const orgs = context.workspaceState.get<string[]>("azuredevops.organizations") || [];
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
