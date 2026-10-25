import { URL } from "url";
import * as vscode from "vscode";

// ============================================================================
// Constants
// ============================================================================
export const ERROR_MESSAGES = {
  PAT_INVALID: "Authentication failed. The PAT is invalid or has expired.",
  PAT_REDIRECTED: "Authentication failed (redirected). Check your PAT.",
} as const;

/**
 * HTTP リクエストを行い、JSON レスポンスをパースして返します。
 * @param method HTTP メソッド（"GET" | "POST"）
 * @param urlStr 要求先の URL
 * @param pat Personal Access Token（Basic 認証に利用）
 * @param body POST 時のペイロード（省略可）
 * @param _opts オプション設定（ロギング用 channel 含む）
 * @returns パース済みの JSON レスポンス（失敗時は例外を投げます）
 */
export type HttpRequestOptions = { channel?: vscode.LogOutputChannel; contentType?: string };

export async function httpRequest(method: "GET" | "POST" | "PATCH", urlStr: string, pat: string, body?: any, opts?: HttpRequestOptions): Promise<any> {
  const u = new URL(urlStr);
  const channel = opts?.channel;

  const maskUrl = (s: string) => s.replace(/(^https?:\/\/)(?:[^@/]+@)?/, `$1`);

  const auth = Buffer.from(":" + (pat || "")).toString("base64");
  const payload = body ? JSON.stringify(body) : undefined;
  const options: any = {
    hostname: u.hostname,
    path: u.pathname + u.search,
    method,
    headers: {
      Authorization: "Basic " + auth,
      Accept: "application/json",
    },
  };
  if (payload) {
    options.headers["Content-Type"] = opts?.contentType ?? "application/json";
    options.headers["Content-Length"] = Buffer.byteLength(payload);
  }

  const masked = maskUrl(urlStr);
  const log = (msg: string) => channel?.appendLine(`call api - request=${method} ${masked} ${msg}`);

  let res: Response;
  let bodyStr: string;
  try {
    res = await fetch(urlStr, { method, headers: options.headers, body: payload, redirect: "manual" });
    bodyStr = await res.text();
  } catch (e: any) {
    const msg = String(e?.cause?.message || e?.message || e);
    log(`error=${msg}`);
    throw e;
  }

  const status = res.status;
  // redirect: "manual" の場合 Node は実ステータス(302)を返す
  if (status < 200 || status >= 300) {
    let parsed: any = {};
    if (bodyStr) {
      try {
        parsed = JSON.parse(bodyStr);
      } catch {
        // 本文が JSON でない場合は無視する
      }
    }
    const errorMsg = status === 302 ? ERROR_MESSAGES.PAT_REDIRECTED : `HTTP ${status} ${res.statusText || ""}`;
    const err = new Error(errorMsg);
    (err as any).status = status;
    (err as any).body = parsed;
    log(`error=${errorMsg} status=${status}`);
    throw err;
  }

  try {
    const parsed = bodyStr ? JSON.parse(bodyStr) : {};
    log(`status=${status} ${res.statusText || ""}`);
    return parsed;
  } catch (err) {
    log(`error=${String(err)}`);
    throw err;
  }
}
// Deprecated: callers should use `httpRequest` directly
