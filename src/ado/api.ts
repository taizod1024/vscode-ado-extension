import { URL } from "url";
import * as vscode from "vscode";

/**
 * HTTP リクエストを行い、JSON レスポンスをパースして返します。
 * @param method HTTP メソッド（"GET" | "POST"）
 * @param urlStr 要求先の URL
 * @param pat Personal Access Token（Basic 認証に利用）
 * @param body POST 時のペイロード（省略可）
 * @param _opts オプション設定（ロギング用 channel 含む）
 * @returns パース済みの JSON レスポンス（失敗時は例外を投げます）
 */
export type HttpRequestOptions = { channel?: vscode.LogOutputChannel };

export async function httpRequest(method: "GET" | "POST", urlStr: string, pat: string, body?: any, opts?: HttpRequestOptions): Promise<any> {
  const https = require("https");
  const http = require("http");
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
    options.headers["Content-Type"] = "application/json";
    options.headers["Content-Length"] = Buffer.byteLength(payload);
  }

  return new Promise((resolve, reject) => {
    try {
      const lib = u.protocol === "https:" ? https : http;
      const req = lib.request(options, (res: any) => {
        let bodyStr = "";
        res.setEncoding("utf8");
        res.on("data", (chunk: string) => (bodyStr += chunk));
        res.on("end", () => {
          const status = res.statusCode;
          const masked = maskUrl(urlStr);

          // ステータスコードを最初に確認
          if (status < 200 || status >= 300) {
            try {
              let parsed: any = {};
              let errorMsg = `HTTP ${status} ${res.statusMessage || ""}`;

              // 302リダイレクトは通常、認証失敗を示す
              if (status === 302) {
                errorMsg = `Authentication failed (redirected). Check your PAT.`;
              }

              if (bodyStr) {
                try {
                  parsed = JSON.parse(bodyStr);
                } catch (e) {
                  // パース失敗は無視、bodyStrをそのまま使う
                }
              }

              const err = new Error(errorMsg);
              (err as any).status = status;
              (err as any).body = parsed;
              if (channel) {
                channel.appendLine(`call api - request=${method} ${masked} error=${errorMsg} status=${status}`);
              }
              reject(err);
            } catch (parseErr) {
              const err = new Error(`HTTP ${status} ${res.statusMessage || ""}`);
              (err as any).status = status;
              if (channel) {
                channel.appendLine(`call api - request=${method} ${masked} error=${String(err.message)}`);
              }
              reject(err);
            }
            return;
          }

          // 成功時のみJSON.parse
          try {
            let parsed: any = {};
            if (bodyStr) {
              parsed = JSON.parse(bodyStr);
            }
            if (channel) {
              channel.appendLine(`call api - request=${method} ${masked} status=${status} ${res.statusMessage || ""}`);
            }
            resolve(parsed);
          } catch (err) {
            const masked2 = maskUrl(urlStr);
            if (channel) {
              channel.appendLine(`call api - request=${method} ${masked2} error=${String(err)}`);
            }
            reject(err);
          }
        });
      });
      req.on("error", (e: any) => {
        const masked = maskUrl(urlStr);
        if (channel) {
          channel.appendLine(`call api - request=${method} ${masked} error=${String(e && e.message ? e.message : e)}`);
        }
        reject(e);
      });
      if (payload) req.write(payload);
      req.end();
    } catch (err) {
      const masked = maskUrl(urlStr);
      if (channel) {
        channel.appendLine(`call api - request=${method} ${masked} error=${String(err)}`);
      }
      reject(err);
    }
  });
}

// Deprecated: callers should use `httpRequest` directly
