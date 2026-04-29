import * as vscode from "vscode";
import { azuredevops } from "./AzureDevOps";

export function activate(context: vscode.ExtensionContext) {
  azuredevops.activate(context);
}

export function deactivate() {
  azuredevops.deactivate();
}
