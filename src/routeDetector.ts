import * as vscode from "vscode";
import { DetectedRoute, HttpMethod } from "./types";

const NEXT_ROUTE_REGEXES = [
  /export\s+(?:async\s+)?function\s+(GET|POST|PUT|DELETE|PATCH)\s*\(/g,
  /export\s+const\s+(GET|POST|PUT|DELETE|PATCH)\s*=\s*(?:async\s*)?(?:\([^)]*\)|[A-Za-z_$][\w$]*)\s*=>/g
];

export function detectRoutes(document: vscode.TextDocument): DetectedRoute[] {
  const text = document.getText();
  const routes: DetectedRoute[] = [];
  const expressIdentifiers = getExpressIdentifiers(text);
  const expressRouteRegex = buildExpressRouteRegex(expressIdentifiers);
  const expressChainedRouteRegex = buildExpressChainedRouteRegex(expressIdentifiers);

  for (const match of text.matchAll(expressRouteRegex)) {
    const method = match[1].toUpperCase() as HttpMethod;
    const path = match[3];
    const startOffset = match.index ?? 0;
    const startPosition = document.positionAt(startOffset);
    const codeSnippet = getCodeSnippet(document, startPosition.line);

    routes.push({
      method,
      path,
      filePath: document.uri.fsPath,
      line: startPosition.line,
      codeSnippet,
      framework: "express",
      range: new vscode.Range(startPosition, startPosition)
    });
  }

  for (const match of text.matchAll(expressChainedRouteRegex)) {
    const path = match[2];
    const method = match[3].toUpperCase() as HttpMethod;
    const startOffset = match.index ?? 0;
    const startPosition = document.positionAt(startOffset);
    const codeSnippet = getCodeSnippet(document, startPosition.line);

    routes.push({
      method,
      path,
      filePath: document.uri.fsPath,
      line: startPosition.line,
      codeSnippet,
      framework: "express",
      range: new vscode.Range(startPosition, startPosition)
    });
  }

  if (isLikelyNextAppRoute(document.uri.fsPath)) {
    for (const routeRegex of NEXT_ROUTE_REGEXES) {
      for (const match of text.matchAll(routeRegex)) {
        const method = match[1].toUpperCase() as HttpMethod;
        const startOffset = match.index ?? 0;
        const startPosition = document.positionAt(startOffset);
        const codeSnippet = getCodeSnippet(document, startPosition.line);

        routes.push({
          method,
          path: inferNextRoutePath(document.uri),
          filePath: document.uri.fsPath,
          line: startPosition.line,
          codeSnippet,
          framework: "next-app-router",
          range: new vscode.Range(startPosition, startPosition)
        });
      }
    }
  }

  return dedupeRoutes(routes);
}

function getExpressIdentifiers(text: string): string[] {
  const identifiers = new Set<string>(["app", "router"]);
  const declarationRegex =
    /(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:await\s+)?(?:express\s*\(\s*\)|express\.Router\s*\(\s*\)|Router\s*\(\s*\))/g;

  for (const match of text.matchAll(declarationRegex)) {
    identifiers.add(match[1]);
  }

  return Array.from(identifiers);
}

function buildExpressRouteRegex(identifiers: string[]): RegExp {
  const names = identifiers.map(escapeRegex).join("|");
  return new RegExp(
    String.raw`\b(?:${names})\.(get|post|put|delete|patch)\s*\(\s*(['"\`])([^'"\`]+)\2`,
    "gi"
  );
}

function buildExpressChainedRouteRegex(identifiers: string[]): RegExp {
  const names = identifiers.map(escapeRegex).join("|");
  return new RegExp(
    String.raw`\b(?:${names})\.route\s*\(\s*(['"\`])([^'"\`]+)\1\s*\)\s*\.(get|post|put|delete|patch)\s*\(`,
    "gi"
  );
}

function getCodeSnippet(document: vscode.TextDocument, line: number): string {
  const start = Math.max(0, line);
  const end = Math.min(document.lineCount - 1, line + 20);
  return document.getText(new vscode.Range(start, 0, end, document.lineAt(end).text.length));
}

function isLikelyNextAppRoute(filePath: string): boolean {
  const normalized = filePath.replace(/\\/g, "/");
  return (normalized.includes("/app/") || normalized.includes("/src/app/"))
    && /\/route\.(t|j)sx?$/.test(normalized);
}

function inferNextRoutePath(uri: vscode.Uri): string {
  const normalized = uri.fsPath.replace(/\\/g, "/");
  const appMarker = normalized.includes("/src/app/") ? "/src/app/" : "/app/";
  const appIndex = normalized.lastIndexOf(appMarker);
  if (appIndex === -1) {
    return "/";
  }

  const appSubPath = normalized.slice(appIndex + appMarker.length);
  const withoutFile = appSubPath.replace(/\/route\.(t|j)sx?$/, "");
  const segments = withoutFile
    .split("/")
    .filter(Boolean)
    .map((segment) => {
      if (segment === "page") {
        return "";
      }
      if (segment.startsWith("[") && segment.endsWith("]")) {
        return `:${segment.slice(1, -1)}`;
      }
      return segment;
    })
    .filter(Boolean);

  return `/${segments.join("/")}` || "/";
}

function dedupeRoutes(routes: DetectedRoute[]): DetectedRoute[] {
  const seen = new Set<string>();
  return routes.filter((route) => {
    const key = `${route.filePath}:${route.line}:${route.method}:${route.path}`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
