import * as vscode from "vscode";

export type HttpMethod = "GET" | "POST" | "PUT" | "DELETE" | "PATCH";

export interface DetectedRoute {
  method: HttpMethod;
  path: string;
  filePath: string;
  line: number;
  codeSnippet: string;
  framework: "express" | "next-app-router";
  range: vscode.Range;
}

export interface PayloadSet {
  validPayload: unknown;
  invalidPayload: unknown;
  edgeCasePayload: unknown;
  notes?: string;
}

export interface RequestExecutionResult {
  url: string;
  method: HttpMethod;
  requestBody?: unknown;
  statusCode: number;
  responseBody: string;
  responseTimeMs: number;
  headers: Record<string, string>;
  ok: boolean;
}

export interface DebugSuggestion {
  summary: string;
  suggestions: string[];
}

export interface RouteGroupPlan {
  collectionName: string;
  description: string;
  folders: Array<{
    name: string;
    routeKeys: string[];
  }>;
}
