import * as vscode from "vscode";

let outputChannel: vscode.OutputChannel | undefined;

export function getOutputChannel(): vscode.OutputChannel {
  outputChannel ??= vscode.window.createOutputChannel("Requestly Copilot");
  return outputChannel;
}

export function logInfo(message: string): void {
  getOutputChannel().appendLine(`[info] ${message}`);
}

export function logError(message: string, error?: unknown): void {
  const details = error instanceof Error ? `${error.message}\n${error.stack ?? ""}` : String(error ?? "");
  getOutputChannel().appendLine(`[error] ${message}${details ? `\n${details}` : ""}`);
}
