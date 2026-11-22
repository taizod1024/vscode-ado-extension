import * as vscode from "vscode";
import { httpRequest } from "./api";

/**
 * VS Code Authentication Provider for Azure DevOps.
 * Implements device flow authentication.
 */
export class AzureDevOpsAuthenticationProvider implements vscode.AuthenticationProvider {
  private readonly id = "azure-devops";
  private readonly label = "Azure DevOps";
  private channel?: vscode.LogOutputChannel;
  private context?: vscode.ExtensionContext;

  constructor(context: vscode.ExtensionContext, channel?: vscode.LogOutputChannel) {
    this.context = context;
    this.channel = channel;
  }

  /**
   * Create a new session by signing in with device flow.
   */
  async createSession(scopes: string[]): Promise<vscode.AuthenticationSession> {
    if (!this.context) {
      throw new Error("Extension context not available");
    }

    try {
      this.channel?.appendLine("[Auth] Starting device flow authentication...");

      // Initiate device flow
      const deviceCodeResponse = await this.requestDeviceCode();
      this.channel?.appendLine(`[Auth] Device code obtained: ${deviceCodeResponse.deviceCode}`);

      // Show notification with user code
      await vscode.window.showInformationMessage(
        `To sign in to Azure DevOps, visit: ${deviceCodeResponse.verificationUri}\nCode: ${deviceCodeResponse.userCode}`,
        { modal: true }
      );

      // Poll for token
      const tokenResponse = await this.pollForToken(deviceCodeResponse);
      this.channel?.appendLine("[Auth] Token obtained successfully");

      // Create session
      const session: vscode.AuthenticationSession = {
        id: `azure-devops-${Date.now()}`,
        accessToken: tokenResponse.access_token,
        account: {
          id: tokenResponse.id || "unknown",
          label: tokenResponse.name || "Azure DevOps User",
        },
        scopes: scopes,
      };

      return session;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.channel?.appendLine(`[Auth] Device flow error: ${msg}`);
      throw err;
    }
  }

  /**
   * Remove a session.
   */
  async removeSession(sessionId: string): Promise<void> {
    this.channel?.appendLine(`[Auth] Removing session: ${sessionId}`);
  }

  /**
   * Get all sessions.
   */
  async getSessions(scopes?: string[]): Promise<vscode.AuthenticationSession[]> {
    return [];
  }

  /**
   * Request device code from Azure DevOps.
   */
  private async requestDeviceCode(): Promise<any> {
    const clientId = "d4a05a76-0e30-41da-b35c-5e6caaff26ab"; // VS Code's default OAuth app ID for ADO
    const tenantId = "common";
    const url = `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/devicecode`;

    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        client_id: clientId,
        scope: "499b84ac-1321-427f-aa17-267ca6975798/.default",
      }).toString(),
    });

    if (!response.ok) {
      throw new Error(`Failed to request device code: HTTP ${response.status}`);
    }

    return response.json();
  }

  /**
   * Poll for token using device code.
   */
  private async pollForToken(deviceCodeResponse: any): Promise<any> {
    const clientId = "d4a05a76-0e30-41da-b35c-5e6caaff26ab";
    const tenantId = "common";
    const tokenUrl = `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`;

    const pollInterval = (deviceCodeResponse.interval || 5) * 1000;
    const expiresIn = deviceCodeResponse.expires_in || 900;
    const startTime = Date.now();

    while (Date.now() - startTime < expiresIn * 1000) {
      await new Promise((resolve) => setTimeout(resolve, pollInterval));

      try {
        const response = await fetch(tokenUrl, {
          method: "POST",
          headers: {
            "Content-Type": "application/x-www-form-urlencoded",
          },
          body: new URLSearchParams({
            client_id: clientId,
            grant_type: "urn:ietf:params:oauth:grant-type:device_code",
            device_code: deviceCodeResponse.deviceCode,
          }).toString(),
        });

        if (response.status === 400) {
          const error = await response.json();
          if (error.error === "authorization_pending") {
            continue; // Keep polling
          } else {
            throw new Error(`OAuth error: ${error.error}`);
          }
        }

        if (!response.ok) {
          throw new Error(`Failed to get token: HTTP ${response.status}`);
        }

        const tokenData = await response.json();
        return {
          access_token: tokenData.access_token,
          id: tokenData.oid,
          name: tokenData.name,
        };
      } catch (err) {
        if (err instanceof Error && err.message.includes("authorization_pending")) {
          continue;
        }
        throw err;
      }
    }

    throw new Error("Device flow authentication timed out");
  }
}

/**
 * Utility functions for authentication.
 */
export class AuthUtils {
  /**
   * Try to sign in using the authentication provider.
   * Returns the access token on success, or undefined on failure.
   */
  static async trySignIn(
    authProvider: AzureDevOpsAuthenticationProvider,
    organization: string,
    channel?: vscode.LogOutputChannel
  ): Promise<string | undefined> {
    try {
      channel?.appendLine(`[SignIn] Attempting to sign in for organization: ${organization}`);

      const session = await authProvider.createSession([]);
      if (!session || !session.accessToken) {
        channel?.appendLine("[SignIn] No access token returned");
        return undefined;
      }

      channel?.appendLine("[SignIn] Successfully obtained access token");
      return session.accessToken;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      channel?.appendLine(`[SignIn] Sign in failed: ${msg}`);
      return undefined;
    }
  }

  /**
   * Verify that an OAuth token is valid for Azure DevOps.
   */
  static async verifyToken(token: string, channel?: vscode.LogOutputChannel): Promise<boolean> {
    try {
      const url = "https://app.vssps.visualstudio.com/_apis/profile/profiles/me";
      const response = await fetch(url, {
        method: "GET",
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      if (response.status === 200) {
        channel?.appendLine("[Auth] Token verified successfully");
        return true;
      } else {
        channel?.appendLine(`[Auth] Token verification failed: HTTP ${response.status}`);
        return false;
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      channel?.appendLine(`[Auth] Token verification error: ${msg}`);
      return false;
    }
  }
}
