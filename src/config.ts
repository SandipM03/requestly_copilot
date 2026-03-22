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
    geminiApiKey: config.get<string>("geminiApiKey", ""),
    geminiModel: config.get<string>("geminiModel", "gemini-2.5-flash"),
    requestTimeoutMs: config.get<number>("requestTimeoutMs", 15000),
    collectionOutputPath: config.get<string>("collectionOutputPath", ".requestly/requestly-copilot.openapi.json"),
    postmanCollectionOutputPath: config.get<string>("postmanCollectionOutputPath", ".requestly/requestly-copilot.postman.json")
  };
}

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, "");
}
