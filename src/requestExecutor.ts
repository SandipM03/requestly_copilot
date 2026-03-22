import * as http from "node:http";
import * as https from "node:https";
import { URL } from "node:url";
import { ExtensionConfig } from "./config";
import { DetectedRoute, RequestExecutionResult } from "./types";

export async function executeRouteViaProxy(
  route: DetectedRoute,
  payload: unknown,
  config: ExtensionConfig,
  resolvedPath?: string
): Promise<RequestExecutionResult> {
  const routePath = normalizeRoutePath(resolvedPath ?? route.path);
  const targetUrl = `${config.baseUrl}${routePath}`;
  const proxyUrl = new URL(config.proxyUrl);
  const target = new URL(targetUrl);

  const headers: Record<string, string> = {
    "Host": target.host,
    "X-Requestly-Target-Url": target.toString(),
    "X-Forwarded-Proto": target.protocol.replace(":", ""),
    "X-Forwarded-Host": target.host,
    "Accept": "application/json, text/plain, */*"
  };

  const body = canSendBody(route.method) ? JSON.stringify(payload ?? {}) : undefined;
  if (body) {
    headers["Content-Type"] = "application/json";
    headers["Content-Length"] = Buffer.byteLength(body, "utf8").toString();
  } else if (route.method !== "GET") {
    headers["Content-Length"] = "0";
  }

  const start = Date.now();
  return sendViaProxy({
    proxyUrl,
    targetUrl: target.toString(),
    method: route.method,
    headers,
    body,
    timeoutMs: config.requestTimeoutMs,
    requestBody: payload,
    startedAt: start
  });
}

function normalizeRoutePath(path: string): string {
  const withLeadingSlash = path.startsWith("/") ? path : `/${path}`;
  return withLeadingSlash
    .replace(/\[([^\]]+)\]/g, "123")
    .replace(/:([A-Za-z0-9_]+)/g, "123");
}

function canSendBody(method: string): boolean {
  return method !== "GET";
}

function sendViaProxy(args: {
  proxyUrl: URL;
  targetUrl: string;
  method: string;
  headers: Record<string, string>;
  body?: string;
  timeoutMs: number;
  requestBody: unknown;
  startedAt: number;
}): Promise<RequestExecutionResult> {
  const client = args.proxyUrl.protocol === "https:" ? https : http;

  return new Promise<RequestExecutionResult>((resolve, reject) => {
    const request = client.request(
      {
        protocol: args.proxyUrl.protocol,
        hostname: args.proxyUrl.hostname,
        port: args.proxyUrl.port,
        method: args.method,
        path: args.targetUrl,
        headers: args.headers
      },
      (response) => {
        let responseBody = "";
        response.setEncoding("utf8");
        response.on("data", (chunk) => {
          responseBody += chunk;
        });
        response.on("end", () => {
          resolve({
            url: args.targetUrl,
            method: args.method as DetectedRoute["method"],
            requestBody: args.requestBody,
            statusCode: response.statusCode ?? 0,
            responseBody,
            responseTimeMs: Date.now() - args.startedAt,
            headers: normalizeHeaders(response.headers),
            ok: (response.statusCode ?? 500) >= 200 && (response.statusCode ?? 500) < 300
          });
        });
      }
    );

    request.setTimeout(args.timeoutMs, () => {
      request.destroy(new Error(`Request timed out after ${args.timeoutMs}ms`));
    });

    request.on("error", (error) => {
      reject(wrapProxyError(error, args.proxyUrl, args.targetUrl));
    });

    if (args.body) {
      request.write(args.body);
    }

    request.end();
  });
}

function normalizeHeaders(
  headers: http.IncomingHttpHeaders
): Record<string, string> {
  return Object.fromEntries(
    Object.entries(headers).map(([key, value]) => [
      key,
      Array.isArray(value) ? value.join(", ") : String(value ?? "")
    ])
  );
}

function wrapProxyError(error: unknown, proxyUrl: URL, targetUrl: string): Error {
  if (error instanceof Error) {
    const networkError = error as NodeJS.ErrnoException;

    if (networkError.code === "ECONNREFUSED") {
      return new Error(
        `Could not connect to Requestly proxy at ${proxyUrl.toString()}. Start Requestly, check the proxy port shown in the app, then update requestlyCopilot.proxyUrl if needed. Target URL: ${targetUrl}`
      );
    }

    if (networkError.code === "ENOTFOUND") {
      return new Error(
        `Requestly proxy host could not be resolved: ${proxyUrl.toString()}. Check requestlyCopilot.proxyUrl.`
      );
    }

    return error;
  }

  return new Error(String(error));
}
