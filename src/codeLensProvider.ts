import * as vscode from "vscode";
import { detectRoutes } from "./routeDetector";
import { DetectedRoute } from "./types";

export class ApiCodeLensProvider implements vscode.CodeLensProvider {
  private readonly onDidChangeEmitter = new vscode.EventEmitter<void>();
  public readonly onDidChangeCodeLenses = this.onDidChangeEmitter.event;

  refresh(): void {
    this.onDidChangeEmitter.fire();
  }

  provideCodeLenses(document: vscode.TextDocument): vscode.CodeLens[] {
    const routes = detectRoutes(document);
    return routes.flatMap((route) => buildRouteCodeLenses(route));
  }
}

function buildRouteCodeLenses(route: DetectedRoute): vscode.CodeLens[] {
  return [
    new vscode.CodeLens(route.range, {
      title: "Run in Requestly",
      command: "requestlyCopilot.runRoute",
      arguments: [route]
    }),
    new vscode.CodeLens(route.range, {
      title: "Debug with AI",
      command: "requestlyCopilot.debugRoute",
      arguments: [route]
    })
  ];
}
