import { URL } from "url";

async function httpRequest(method: "GET" | "POST", urlStr: string, pat: string, body?: any): Promise<any> {
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

export async function getJson(urlStr: string, pat: string): Promise<any> {
  return await httpRequest("GET", urlStr, pat);
}

export async function postJson(urlStr: string, pat: string, body: any): Promise<any> {
  return await httpRequest("POST", urlStr, pat, body);
}
