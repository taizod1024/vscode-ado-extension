import { URL } from "url";

/**
 * HTTP リクエストを行い、JSON レスポンスをパースして返します。
 * @param method HTTP メソッド（"GET" | "POST"）
 * @param urlStr 要求先の URL
 * @param pat Personal Access Token（Basic 認証に利用）
 * @param body POST 時のペイロード（省略可）
 * @returns パース済みの JSON レスポンス（失敗時は例外を投げます）
 */
export async function httpRequest(method: "GET" | "POST", urlStr: string, pat: string, body?: any): Promise<any> {
  const https = require("https");
  const u = new URL(urlStr);
  const auth = Buffer.from(":" + pat).toString("base64");
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
      const req = https.request(options, (res: any) => {
        let bodyStr = "";
        res.setEncoding("utf8");
        res.on("data", (chunk: string) => (bodyStr += chunk));
        res.on("end", () => {
          try {
            const parsed = bodyStr ? JSON.parse(bodyStr) : {};
            try {
              console.log(`ado-assist: request=${method} ${urlStr} status=${res.statusCode} ${res.statusMessage}`);
            } catch (e) {}
            resolve(parsed);
          } catch (err) {
            reject(err);
          }
        });
      });
      req.on("error", (e: any) => reject(e));
      if (payload) req.write(payload);
      req.end();
    } catch (err) {
      reject(err);
    }
  });
}

// Deprecated: callers should use `httpRequest` directly
