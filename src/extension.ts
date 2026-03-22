import * as vscode from "vscode";
import { generateDebugSuggestions, generatePayloads } from "./ai";
import { generatePostmanCollection, generateRequestlyCollection } from "./collectionGenerator";
import { ApiCodeLensProvider } from "./codeLensProvider";
import { getConfig } from "./config";
import { logError, logInfo } from "./logger";
import { executeRouteViaProxy } from "./requestExecutor";
import { detectRoutes } from "./routeDetector";
import { DetectedRoute } from "./types";
import { showResultPanel } from "./webview";

export function activate(context: vscode.ExtensionContext): void {
  const provider = new ApiCodeLensProvider();
  logInfo("Extension activated.");

  context.subscriptions.push(
    vscode.languages.registerCodeLensProvider(
      [
        { language: "javascript", scheme: "file" },
        { language: "typescript", scheme: "file" },
        { language: "javascriptreact", scheme: "file" },
        { language: "typescriptreact", scheme: "file" }
      ],
      provider
    )
  );

  context.subscriptions.push(
    vscode.workspace.onDidChangeTextDocument(() => provider.refresh()),
    vscode.window.onDidChangeActiveTextEditor(() => provider.refresh())
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("requestlyCopilot.runRoute", async (route?: DetectedRoute) => {
      try {
        const resolvedRoute = route ?? getRouteFromActiveEditor();
        if (!resolvedRoute) {
          vscode.window.showWarningMessage("No supported API route was detected in the active editor.");
          return;
        }

        await runRoute(context, resolvedRoute, "validPayload", false);
      } catch (error) {
        logError("Run route failed.", error);
        vscode.window.showErrorMessage(`Requestly Copilot failed: ${toErrorMessage(error)}`);
      }
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("requestlyCopilot.debugRoute", async (route?: DetectedRoute) => {
      try {
        const resolvedRoute = route ?? getRouteFromActiveEditor();
        if (!resolvedRoute) {
          vscode.window.showWarningMessage("No supported API route was detected in the active editor.");
          return;
        }

        const selected = await vscode.window.showQuickPick(
          [
            { label: "Invalid payload", payloadKey: "invalidPayload" as const },
            { label: "Edge case payload", payloadKey: "edgeCasePayload" as const }
          ],
          { placeHolder: "Choose the debug scenario" }
        );

        if (!selected) {
          return;
        }

        await runRoute(context, resolvedRoute, selected.payloadKey, true);
      } catch (error) {
        logError("Debug route failed.", error);
        vscode.window.showErrorMessage(`Requestly Copilot failed: ${toErrorMessage(error)}`);
      }
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("requestlyCopilot.generateCollection", async () => {
      try {
        await vscode.window.withProgress(
          {
            location: vscode.ProgressLocation.Notification,
            title: "Requestly Copilot: Generating Requestly collection",
            cancellable: false
          },
          async () => {
            await generateRequestlyCollection();
          }
        );
      } catch (error) {
        logError("Generate collection failed.", error);
        vscode.window.showErrorMessage(`Requestly Copilot failed: ${toErrorMessage(error)}`);
      }
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("requestlyCopilot.generatePostmanCollection", async () => {
      try {
        await vscode.window.withProgress(
          {
            location: vscode.ProgressLocation.Notification,
            title: "Requestly Copilot: Generating Postman collection",
            cancellable: false
          },
          async () => {
            await generatePostmanCollection();
          }
        );
      } catch (error) {
        logError("Generate Postman collection failed.", error);
        vscode.window.showErrorMessage(`Requestly Copilot failed: ${toErrorMessage(error)}`);
      }
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("requestlyCopilot.showDetectedRoutes", async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) {
        vscode.window.showWarningMessage("Open a JavaScript or TypeScript route file first.");
        return;
      }

      const routes = detectRoutes(editor.document);
      logInfo(`Detected ${routes.length} route(s) in ${editor.document.uri.fsPath}`);
      if (!routes.length) {
        vscode.window.showWarningMessage("No supported routes were detected in the active file.");
        return;
      }

      const selected = await vscode.window.showQuickPick(
        routes.map((route) => ({
          label: `${route.method} ${route.path}`,
          description: `${route.framework} · line ${route.line + 1}`
        })),
        { placeHolder: "Detected routes in the active file" }
      );

      if (selected) {
        vscode.window.showInformationMessage(`Detected route: ${selected.label}`);
      }
    })
  );
}

async function runRoute(
  context: vscode.ExtensionContext,
  route: DetectedRoute,
  payloadKey: "validPayload" | "invalidPayload" | "edgeCasePayload",
  includeDebugSuggestions: boolean
): Promise<void> {
  const config = getConfig(vscode.Uri.file(route.filePath));

  await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: `Requestly Copilot: ${route.method} ${route.path}`,
      cancellable: false
    },
    async (progress) => {
      progress.report({ message: "Generating payloads..." });
      const payloads = await generatePayloads(route.codeSnippet, config);
      const selectedPayload = payloads[payloadKey];
      const resolvedPath = await resolveRoutePath(route, selectedPayload);
      if (!resolvedPath) {
        return;
      }

      progress.report({ message: "Sending request through Requestly proxy..." });
      const result = await executeRouteViaProxy(route, selectedPayload, config, resolvedPath);

      let debugSuggestion;
      if (includeDebugSuggestions && !result.ok) {
        progress.report({ message: "Generating debugging suggestions..." });
        debugSuggestion = await generateDebugSuggestions(
          route.codeSnippet,
          selectedPayload,
          result.responseBody,
          result.statusCode,
          config
        );
      }

      showResultPanel(
        context.extensionUri,
        `Requestly Copilot: ${route.method} ${route.path}`,
        result,
        payloads,
        debugSuggestion
      );
    }
  );
}

function getRouteFromActiveEditor(): DetectedRoute | undefined {
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    return undefined;
  }

  const routes = detectRoutes(editor.document);
  logInfo(`Active editor route detection found ${routes.length} route(s) in ${editor.document.uri.fsPath}`);
  if (!routes.length) {
    return undefined;
  }

  const currentLine = editor.selection.active.line;
  return routes.find((route) => route.line === currentLine)
    ?? routes.find((route) => route.line >= currentLine)
    ?? routes[0];
}

async function resolveRoutePath(route: DetectedRoute, payload: unknown): Promise<string | undefined> {
  const parameters = extractPathParameters(route.path);
  if (!parameters.length) {
    return route.path;
  }

  let resolvedPath = route.path;
  const payloadObject = isRecord(payload) ? payload : {};

  for (const parameter of parameters) {
    const suggestedValue = getSuggestedPathValue(parameter, payloadObject);
    const value = await vscode.window.showInputBox({
      prompt: `Enter value for path parameter "${parameter}"`,
      placeHolder: suggestedValue,
      value: suggestedValue,
      ignoreFocusOut: true,
      validateInput: (input) => input.trim() ? undefined : `Path parameter "${parameter}" is required.`
    });

    if (value === undefined) {
      return undefined;
    }

    const trimmed = value.trim();
    resolvedPath = resolvedPath
      .replace(new RegExp(`:${escapeRegex(parameter)}\\b`, "g"), trimmed)
      .replace(new RegExp(`\\[${escapeRegex(parameter)}\\]`, "g"), trimmed);
  }

  return resolvedPath;
}

function extractPathParameters(path: string): string[] {
  const matches = path.matchAll(/:([A-Za-z0-9_]+)|\[([^\]]+)\]/g);
  const seen = new Set<string>();
  const parameters: string[] = [];

  for (const match of matches) {
    const parameter = match[1] ?? match[2];
    if (parameter && !seen.has(parameter)) {
      seen.add(parameter);
      parameters.push(parameter);
    }
  }

  return parameters;
}

function getSuggestedPathValue(parameter: string, payload: Record<string, unknown>): string {
  const directValue = payload[parameter];
  if (isPrimitivePathValue(directValue)) {
    return String(directValue);
  }

  if (parameter.toLowerCase() === "id" && isPrimitivePathValue(payload.id)) {
    return String(payload.id);
  }

  return "123";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isPrimitivePathValue(value: unknown): value is string | number | boolean {
  return typeof value === "string" || typeof value === "number" || typeof value === "boolean";
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function deactivate(): void {}

function toErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}
