import * as vscode from "vscode";
import { DebugSuggestion, PayloadSet, RequestExecutionResult } from "./types";

export function showResultPanel(
  extensionUri: vscode.Uri,
  title: string,
  result: RequestExecutionResult,
  payloads: PayloadSet,
  debugSuggestion?: DebugSuggestion
): void {
  const panel = vscode.window.createWebviewPanel(
    "requestlyCopilotResult",
    title,
    vscode.ViewColumn.Beside,
    {
      enableScripts: false,
      retainContextWhenHidden: true
    }
  );

  panel.webview.html = getHtml(panel.webview, extensionUri, result, payloads, debugSuggestion);
}

function getHtml(
  webview: vscode.Webview,
  extensionUri: vscode.Uri,
  result: RequestExecutionResult,
  payloads: PayloadSet,
  debugSuggestion?: DebugSuggestion
): string {
  const nonce = String(Date.now());
  const titleColor = result.ok ? "#1f8f4e" : "#c2410c";
  const bg = "#0b1020";
  const panelBg = "#121a2b";
  const border = "#2a3656";
  const text = "#e5ecff";
  const muted = "#9fb0d9";

  void webview;
  void extensionUri;
  const formattedResponseBody = formatResponseBody(result.responseBody);

  return `<!DOCTYPE html>
  <html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline';" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Requestly Copilot Result</title>
    <style>
      :root {
        --bg: ${bg};
        --panel: ${panelBg};
        --border: ${border};
        --text: ${text};
        --muted: ${muted};
        --accent: ${titleColor};
      }
      * { box-sizing: border-box; }
      body {
        margin: 0;
        padding: 24px;
        background:
          radial-gradient(circle at top right, rgba(31, 143, 78, 0.18), transparent 24%),
          linear-gradient(180deg, #0b1020 0%, #0f172a 100%);
        color: var(--text);
        font-family: Georgia, "Times New Roman", serif;
      }
      h1, h2 {
        margin: 0 0 12px;
      }
      h1 {
        font-size: 28px;
        color: var(--accent);
      }
      h2 {
        font-size: 18px;
      }
      .grid {
        display: grid;
        gap: 16px;
        grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
        margin-bottom: 16px;
      }
      .card {
        background: rgba(18, 26, 43, 0.92);
        border: 1px solid var(--border);
        border-radius: 16px;
        padding: 16px;
        box-shadow: 0 18px 45px rgba(0, 0, 0, 0.22);
      }
      .muted {
        color: var(--muted);
      }
      pre {
        white-space: pre-wrap;
        word-break: break-word;
        background: rgba(7, 12, 24, 0.8);
        border: 1px solid var(--border);
        border-radius: 12px;
        padding: 12px;
        overflow: auto;
      }
      ul {
        padding-left: 20px;
      }
      .pill {
        display: inline-block;
        border-radius: 999px;
        padding: 4px 10px;
        border: 1px solid var(--border);
        margin-right: 8px;
        margin-bottom: 8px;
      }
    </style>
  </head>
  <body data-nonce="${nonce}">
    <h1>Requestly Copilot</h1>
    <div class="grid">
      <section class="card">
        <h2>Execution</h2>
        <div class="pill">${escapeHtml(result.method)}</div>
        <div class="pill">${escapeHtml(result.url)}</div>
        <p><strong>Status:</strong> ${result.statusCode}</p>
        <p><strong>Response Time:</strong> ${result.responseTimeMs} ms</p>
      </section>
      <section class="card">
        <h2>Payloads</h2>
        <p class="muted">AI-generated test inputs for fast replay and debugging.</p>
        <p><strong>Valid</strong></p>
        <pre>${escapeHtml(JSON.stringify(payloads.validPayload, null, 2))}</pre>
        <p><strong>Invalid</strong></p>
        <pre>${escapeHtml(JSON.stringify(payloads.invalidPayload, null, 2))}</pre>
        <p><strong>Edge Case</strong></p>
        <pre>${escapeHtml(JSON.stringify(payloads.edgeCasePayload, null, 2))}</pre>
      </section>
    </div>
    <section class="card">
      <h2>Response Body</h2>
      <pre>${escapeHtml(formattedResponseBody)}</pre>
    </section>
    ${
      debugSuggestion
        ? `<section class="card">
            <h2>Debug Suggestions</h2>
            <p>${escapeHtml(debugSuggestion.summary)}</p>
            <ul>${debugSuggestion.suggestions.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>
           </section>`
        : ""
    }
  </body>
  </html>`;
}

function formatResponseBody(responseBody: string): string {
  if (!responseBody) {
    return "(empty response body)";
  }

  try {
    return JSON.stringify(JSON.parse(responseBody), null, 2);
  } catch {
    return responseBody;
  }
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
