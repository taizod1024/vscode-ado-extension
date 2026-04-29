import * as vscode from "vscode";
import { createTreeProvider } from "./AzureDevOps";

export function activate(context: vscode.ExtensionContext) {
  console.log("azure-devops: activate() start");
  try {
    // Register a TreeDataProvider for the side panel view id
    const provider = createTreeProvider(context);
    context.subscriptions.push(vscode.window.registerTreeDataProvider("azureDevOps.sidePanel", provider));
    console.log("azure-devops: registered TreeDataProvider for", "azureDevOps.sidePanel");
    console.log("azure-devops: extension path:", context.extensionPath);

    // (removed unused helper commands: showView, savePat)

    // Enter PAT for a specific organization (used by tree items)
    context.subscriptions.push(
      vscode.commands.registerCommand("azure-devops.enterPatForOrg", async (orgArg?: any) => {
        try {
          const orgFromArg = typeof orgArg === "string" ? orgArg : orgArg?.organization || orgArg?.label;
          const org = orgFromArg || (await vscode.window.showInputBox({ prompt: "Organization for this PAT (e.g. myorg)" }));
          if (!org) return;
          const pat = await vscode.window.showInputBox({ prompt: `Enter Personal Access Token (PAT) for ${org}`, password: true });
          if (!pat) return;
          await context.secrets.store(`azure-devops.pat.${org}`, pat);
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
      vscode.commands.registerCommand("azure-devops.openProject", async (arg?: any) => {
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
      vscode.commands.registerCommand("azure-devops.addOrganization", async () => {
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
      vscode.commands.registerCommand("azure-devops.removeOrganization", async () => {
        try {
          const orgs = context.workspaceState.get<string[]>("azuredevops.organizations") || [];
          if (orgs.length === 0) {
            vscode.window.showInformationMessage("No organizations to remove");
            return;
          }
          const pick = await vscode.window.showQuickPick(orgs, { placeHolder: "Select organization to remove" });
          if (!pick) return;
          provider.removeOrganization(pick);
          vscode.window.showInformationMessage(`Removed organization ${pick}`);
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          vscode.window.showErrorMessage("Failed to remove organization: " + msg);
        }
      }),
    );

    // Fetch organization command (used by org-level action)
    context.subscriptions.push(
      vscode.commands.registerCommand("azure-devops.fetchOrganization", async (orgArg?: any) => {
        try {
          const orgFromArg = typeof orgArg === "string" ? orgArg : orgArg?.organization || orgArg?.label;
          const org = orgFromArg || (await vscode.window.showInputBox({ prompt: "Organization (e.g. myorg)" }));
          if (!org) return;
          await provider.fetchProjects(org);
          vscode.window.showInformationMessage(`Fetched projects for ${org}`);
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          vscode.window.showErrorMessage("Failed to fetch projects: " + msg);
        }
      }),
    );

    // View title dropdown menu: show a QuickPick with actions
    context.subscriptions.push(
      vscode.commands.registerCommand("azure-devops.viewMenu", async () => {
        try {
          const items = [
            { label: "Add organization", command: "azure-devops.addOrganization" },
            { label: "Remove organization", command: "azure-devops.removeOrganization" },
            { label: "Fetch organization", command: "azure-devops.fetchOrganization" },
          ];
          const pick = await vscode.window.showQuickPick(
            items.map(i => i.label),
            { placeHolder: "Select Azure DevOps action" },
          );
          if (!pick) return;
          const selected = items.find(i => i.label === pick);
          if (selected) {
            await vscode.commands.executeCommand(selected.command);
          }
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          console.error("azure-devops: viewMenu error", msg);
        }
      }),
    );
  } catch (err) {
    console.error("azure-devops: error registering provider", err);
  }
  console.log("azure-devops: activate() end");
  // attempt to force reveal the view after a short delay
  setTimeout(async () => {
    try {
      console.log("azure-devops: attempting automatic reveal of side panel");
      await vscode.commands.executeCommand("workbench.view.extension.azureDevOps");
      try {
        // try the newer openView command if available
        // @ts-ignore
        await vscode.commands.executeCommand("workbench.views.openView", "azureDevOps.sidePanel", true);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.log("azure-devops: optional openView failed", msg);
      }
      console.log("azure-devops: automatic reveal attempt finished");
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error("azure-devops: automatic reveal setup error", msg);
    }
  }, 500);
}

export function deactivate() {
  // no-op
}
