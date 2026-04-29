import * as vscode from "vscode";

/** Azure DevOps Extension class */
class AzureDevOps {
  /** application id */
  public appId = "azure-devops";

  /** application name */
  public appName = "Azure DevOps Extension";

  /** output channel */
  public channel: vscode.OutputChannel;

  /** extension path */
  public extensionPath: string;

  /** constructor */
  constructor() {}

  /** activate extension */
  public activate(context: vscode.ExtensionContext) {
    // init context
    this.channel = vscode.window.createOutputChannel(this.appName, { log: true });
    this.channel.appendLine("");
    this.channel.appendLine(`## ${this.appName} activated`);

    // init vscode
    context.subscriptions.push(
      vscode.commands.registerCommand(`${this.appId}.doSomething`, async (uri: vscode.Uri) => {
        const commandContext = { channel: this.channel, extensionPath: context.extensionPath };
        this.channel.show(false);
        try {
          this.doSomethingAsync(uri);
        } catch (reason) {
          this.channel.appendLine(`ERROR: ${reason}`);
          vscode.window.showErrorMessage(`${reason}`);
        }
      }),
    );
  }

  /** deactivate extension */
  public deactivate() {}

  public async doSomethingAsync(uri: vscode.Uri) {
    this.channel.appendLine("doSomethingAsync:" + uri.fsPath);
  }
}

export const azuredevops = new AzureDevOps();
