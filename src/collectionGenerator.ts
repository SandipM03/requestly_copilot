import * as path from "node:path";
import * as vscode from "vscode";
import { getConfig } from "./config";
import { generateRouteGroupingPlan } from "./ai";
import { detectRoutes } from "./routeDetector";
import { DetectedRoute, RouteGroupPlan } from "./types";

export async function generateRequestlyCollection(): Promise<void> {
  const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
  if (!workspaceFolder) {
    vscode.window.showWarningMessage("Open a workspace folder to generate a Requestly collection.");
    return;
  }

  const config = getConfig();
  const routes = await collectWorkspaceRoutes();
  if (!routes.length) {
    vscode.window.showWarningMessage("No supported Express or Next.js API routes were found in this workspace.");
    return;
  }

  const routeSummaries = routes.map((route) => ({
    key: `${route.method} ${route.path}`,
    method: route.method,
    path: route.path,
    filePath: route.filePath
  }));

  const plan = await generateRouteGroupingPlan(routeSummaries, config);
  const document = buildOpenApiDocument(routes, plan, config.baseUrl);
  const normalizedOutputPath = config.collectionOutputPath.replace(/\\/g, "/");
  const outputUri = vscode.Uri.joinPath(workspaceFolder.uri, ...normalizedOutputPath.split("/"));

  await ensureParentDirectory(outputUri);
  await vscode.workspace.fs.writeFile(
    outputUri,
    Buffer.from(JSON.stringify(document, null, 2), "utf8")
  );

  const opened = await vscode.window.showInformationMessage(
    `Generated Requestly import file with ${routes.length} routes at ${config.collectionOutputPath}.`,
    "Open File"
  );

  if (opened === "Open File") {
    const doc = await vscode.workspace.openTextDocument(outputUri);
    await vscode.window.showTextDocument(doc, { preview: false });
  }
}

async function collectWorkspaceRoutes(): Promise<DetectedRoute[]> {
  const files = await vscode.workspace.findFiles(
    "**/*.{js,jsx,ts,tsx}",
    "**/{node_modules,.next,dist,build,out,coverage}/**"
  );

  const routeMap = new Map<string, DetectedRoute>();
  for (const file of files) {
    const document = await vscode.workspace.openTextDocument(file);
    const detected = detectRoutes(document);
    for (const route of detected) {
      routeMap.set(`${route.filePath}:${route.line}:${route.method}:${route.path}`, route);
    }
  }

  return Array.from(routeMap.values());
}

function buildOpenApiDocument(
  routes: DetectedRoute[],
  plan: RouteGroupPlan,
  baseUrl: string
): Record<string, unknown> {
  const tagLookup = new Map<string, string>();
  for (const folder of plan.folders) {
    for (const routeKey of folder.routeKeys) {
      tagLookup.set(routeKey, folder.name);
    }
  }

  const paths: Record<string, Record<string, unknown>> = {};
  for (const route of routes) {
    const normalizedPath = toOpenApiPath(route.path);
    const methodKey = route.method.toLowerCase();
    const routeKey = `${route.method} ${route.path}`;
    const tag = tagLookup.get(routeKey) ?? "General";

    paths[normalizedPath] = paths[normalizedPath] ?? {};
    paths[normalizedPath][methodKey] = {
      tags: [tag],
      operationId: buildOperationId(route),
      summary: `${route.method} ${route.path}`,
      description: `Detected from ${route.framework} route in ${route.filePath}.`,
      requestBody: route.method === "GET" || route.method === "DELETE"
        ? undefined
        : {
            required: false,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  additionalProperties: true
                }
              }
            }
          },
      responses: {
        "200": {
          description: "Successful response"
        },
        "400": {
          description: "Bad request"
        },
        "500": {
          description: "Server error"
        }
      }
    };
  }

  return {
    openapi: "3.0.3",
    info: {
      title: plan.collectionName,
      description: `${plan.description} Import this file into Requestly API Client to create a collection.`,
      version: "1.0.0"
    },
    servers: [
      {
        url: baseUrl
      }
    ],
    tags: plan.folders.map((folder) => ({
      name: folder.name,
      description: `AI-generated group for ${folder.name} endpoints.`
    })),
    paths
  };
}

function buildOperationId(route: DetectedRoute): string {
  const cleanPath = route.path.replace(/[^A-Za-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
  return `${route.method.toLowerCase()}_${cleanPath || "root"}`;
}

function toOpenApiPath(path: string): string {
  const withLeadingSlash = path.startsWith("/") ? path : `/${path}`;
  return withLeadingSlash
    .replace(/\[([^\]]+)\]/g, "{$1}")
    .replace(/:([A-Za-z0-9_]+)/g, "{$1}");
}

async function ensureParentDirectory(fileUri: vscode.Uri): Promise<void> {
  const parent = vscode.Uri.file(path.dirname(fileUri.fsPath));
  try {
    await vscode.workspace.fs.createDirectory(parent);
  } catch {
    // createDirectory is already idempotent for existing folders in practice.
  }
}
