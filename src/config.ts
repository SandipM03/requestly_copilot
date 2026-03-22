import * as fs from "node:fs";
import * as path from "node:path";
import * as vscode from "vscode";

export interface ExtensionConfig {
  baseUrl: string;
  proxyUrl: string;
  aiProvider: "local" | "smolify" | "gemini";
  smolifyApiUrl: string;
  smolifyApiKey: string;
  smolifyModel: string;
  geminiApiUrl: string;
  geminiApiKey: string;
  geminiModel: string;
  requestTimeoutMs: number;
  collectionOutputPath: string;
  postmanCollectionOutputPath: string;
}

export function getConfig(resource?: vscode.Uri): ExtensionConfig {
  const config = vscode.workspace.getConfiguration("requestlyCopilot", resource);
  const workspaceFolder = resource
    ? vscode.workspace.getWorkspaceFolder(resource)
    : vscode.workspace.workspaceFolders?.[0];
  const env = readWorkspaceEnv(workspaceFolder?.uri);
  const geminiApiKey = config.get<string>("geminiApiKey", "")
    || env.REQUESTLY_COPILOT_GEMINI_API_KEY
    || env.GEMINI_API_KEY
    || process.env.REQUESTLY_COPILOT_GEMINI_API_KEY
    || process.env.GEMINI_API_KEY
    || "";

  return {
    baseUrl: trimTrailingSlash(config.get<string>("baseUrl", "http://localhost.requestly.io:3000")),
    proxyUrl: trimTrailingSlash(config.get<string>("proxyUrl", "http://172.27.115.202:8281")),
    aiProvider: config.get<"local" | "smolify" | "gemini">("aiProvider", "local"),
    smolifyApiUrl: config.get<string>("smolifyApiUrl", "https://api.smolify.ai/v1/chat/completions"),
    smolifyApiKey: config.get<string>("smolifyApiKey", ""),
    smolifyModel: config.get<string>("smolifyModel", "smolify-chat"),
    geminiApiUrl: trimTrailingSlash(
      config.get<string>("geminiApiUrl", "https://generativelanguage.googleapis.com/v1beta")
    ),
    geminiApiKey,
    geminiModel: config.get<string>("geminiModel", "gemini-2.5-flash"),
    requestTimeoutMs: config.get<number>("requestTimeoutMs", 15000),
    collectionOutputPath: config.get<string>("collectionOutputPath", ".requestly/requestly-copilot.openapi.json"),
    postmanCollectionOutputPath: config.get<string>("postmanCollectionOutputPath", ".requestly/requestly-copilot.postman.json")
  };
}

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, "");
}

function readWorkspaceEnv(workspaceUri?: vscode.Uri): Record<string, string> {
  if (!workspaceUri) {
    return {};
  }

  const envPath = path.join(workspaceUri.fsPath, ".env");
  if (!fs.existsSync(envPath)) {
    return {};
  }

  const content = fs.readFileSync(envPath, "utf8");
  const entries: Record<string, string> = {};

  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) {
      continue;
    }

    const separatorIndex = line.indexOf("=");
    if (separatorIndex === -1) {
      continue;
    }

    const key = line.slice(0, separatorIndex).trim();
    let value = line.slice(separatorIndex + 1).trim();

    if (
      (value.startsWith("\"") && value.endsWith("\""))
      || (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    entries[key] = value;
  }

  return entries;
}
