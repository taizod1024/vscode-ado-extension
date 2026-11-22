import * as vscode from "vscode";
import { AdoApiCredential, httpRequest } from "./api";

export const MICROSOFT_AUTH_PROVIDER_ID = "microsoft";
export const AZURE_DEVOPS_SCOPES = ["499b84ac-1321-427f-aa17-267ca6975798/.default"];

const ORGANIZATION_AUTH_KEY = "azuredevops.organizationAuth";

export type OrganizationAuthentication =
  | { method: "microsoft"; account: vscode.AuthenticationSessionAccountInformation }
  | { method: "pat" };

export interface AccessibleOrganization {
  id: string;
  name: string;
}

/**
 * Microsoft アカウントで Azure DevOps 用セッションを取得します。
 * @returns VS Code が管理する認証セッション
 */
export async function signInWithMicrosoft(): Promise<vscode.AuthenticationSession> {
  return vscode.authentication.getSession(MICROSOFT_AUTH_PROVIDER_ID, AZURE_DEVOPS_SCOPES, {
    createIfNone: { detail: "Azure DevOps 組織へのアクセスに使用します。" },
  });
}

/**
 * 保存済みアカウントのセッションを対話なしで取得します。
 * @param account Microsoft アカウント
 * @returns セッションが利用可能な場合はセッション
 */
export async function getMicrosoftSession(account: vscode.AuthenticationSessionAccountInformation): Promise<vscode.AuthenticationSession | undefined> {
  return vscode.authentication.getSession(MICROSOFT_AUTH_PROVIDER_ID, AZURE_DEVOPS_SCOPES, { account, silent: true });
}

/**
 * サインインしたユーザーがアクセス可能な Azure DevOps 組織を取得します。
 * @param accessToken Microsoft 認証プロバイダーのアクセストークン
 * @param channel ログ出力先
 * @returns アクセス可能な組織一覧
 */
export async function fetchAccessibleOrganizations(accessToken: string, channel?: vscode.LogOutputChannel): Promise<AccessibleOrganization[]> {
  const credential: AdoApiCredential = { token: accessToken, scheme: "Bearer" };
  const profile = await httpRequest("GET", "https://app.vssps.visualstudio.com/_apis/profile/profiles/me?api-version=7.1", credential, undefined, { channel });
  if (typeof profile?.id !== "string" || !profile.id) {
    throw new Error("Azure DevOps did not return the signed-in user's profile ID.");
  }

  const accountsUrl = new URL("https://app.vssps.visualstudio.com/_apis/accounts");
  accountsUrl.searchParams.set("memberId", profile.id);
  accountsUrl.searchParams.set("api-version", "7.1");
  const accounts = await httpRequest("GET", accountsUrl.toString(), credential, undefined, { channel });
  if (!Array.isArray(accounts?.value)) {
    throw new Error("Azure DevOps returned an invalid organization list.");
  }

  return accounts.value
    .filter((account: any) => typeof account?.accountId === "string" && typeof account?.accountName === "string")
    .map((account: any) => ({ id: account.accountId as string, name: account.accountName as string }));
}

/**
 * 組織に紐づく認証方式を取得します。
 * @param context 拡張コンテキスト
 * @param organization 組織名
 * @returns 認証情報。未登録の場合は undefined
 */
export function getOrganizationAuthentication(context: vscode.ExtensionContext | undefined, organization: string): OrganizationAuthentication | undefined {
  if (!context) return undefined;
  const authByOrganization = context.globalState.get<Record<string, OrganizationAuthentication>>(ORGANIZATION_AUTH_KEY, {});
  return authByOrganization[organization];
}

/**
 * 組織に認証方式を保存します。
 * @param context 拡張コンテキスト
 * @param organization 組織名
 * @param authentication 組織の認証情報
 */
export async function setOrganizationAuthentication(context: vscode.ExtensionContext, organization: string, authentication: OrganizationAuthentication): Promise<void> {
  const authByOrganization = context.globalState.get<Record<string, OrganizationAuthentication>>(ORGANIZATION_AUTH_KEY, {});
  await context.globalState.update(ORGANIZATION_AUTH_KEY, { ...authByOrganization, [organization]: authentication });
}

/**
 * 組織の認証方式メタデータを削除します。Microsoft の共有セッションは削除しません。
 * @param context 拡張コンテキスト
 * @param organization 組織名
 */
export async function removeOrganizationAuthentication(context: vscode.ExtensionContext, organization: string): Promise<void> {
  const authByOrganization = context.globalState.get<Record<string, OrganizationAuthentication>>(ORGANIZATION_AUTH_KEY, {});
  if (!authByOrganization[organization]) return;
  const remaining = { ...authByOrganization };
  delete remaining[organization];
  await context.globalState.update(ORGANIZATION_AUTH_KEY, remaining);
}

/**
 * 組織の認証情報から API 用資格情報を解決します。
 * @param context 拡張コンテキスト
 * @param organization 組織名
 * @param pat 明示的に指定された PAT
 * @returns API 用資格情報
 */
export async function resolveOrganizationCredential(
  context: vscode.ExtensionContext | undefined,
  organization: string,
  pat?: string,
): Promise<AdoApiCredential | undefined> {
  if (pat) return { token: pat, scheme: "Basic" };

  const authentication = getOrganizationAuthentication(context, organization);
  if (authentication?.method === "microsoft") {
    const session = await getMicrosoftSession(authentication.account);
    if (!session) {
      throw new Error(`Microsoft sign-in is no longer available for "${organization}". Sign in again or enter a PAT.`);
    }
    return { token: session.accessToken, scheme: "Bearer" };
  }

  const storedPat = await context?.secrets.get(`ado-ext.pat.${organization}`);
  return storedPat ? { token: storedPat, scheme: "Basic" } : undefined;
}
