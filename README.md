# Requestly Copilot

Requestly Copilot is a hackathon-ready VS Code extension that finds API routes in your code, generates test payloads locally by default or through Gemini/Smolify, and runs requests through the Requestly proxy so they show up in Requestly for interception and debugging.

## What It Does

- Adds `Run in Requestly` and `Debug with AI` CodeLens actions above supported API routes
- Detects:
  - Express routes like `app.get(...)`, `app.post(...)`, `router.put(...)`
  - Next.js App Router handlers like `export async function GET()` in `app/**/route.ts`
- Extracts method and route path
- Generates:
  - valid payload
  - invalid payload
  - edge case payload
- Executes the request through the Requestly proxy using the configured Requestly proxy URL
- Shows status code, response body, and response time in a VS Code webview
- In debug mode, shows local fallback suggestions by default and can use Gemini or Smolify
- Generates an AI-organized OpenAPI import file that Requestly can turn into collections and grouped requests
- Generates a Postman collection file from detected routes and grouping

## Project Structure

```text
src/
  ai.ts
  codeLensProvider.ts
  config.ts
  extension.ts
  collectionGenerator.ts
  requestExecutor.ts
  routeDetector.ts
  types.ts
  webview.ts
package.json
tsconfig.json
README.md
```

## How Requestly Is Used

This extension does not replace Requestly. It intentionally sends requests to the Requestly proxy first.

- Proxy URL default: `http://localhost:8282`
- Target API default base URL: `http://localhost.requestly.io:3000`
- The extension forwards the target API URL in headers like `X-Requestly-Target-Url`

Important:

- Your local Requestly proxy should be running and configured to forward traffic to your API.
- Update `requestlyCopilot.proxyUrl` to the exact host and port shown in the Requestly desktop app.
- Prefer `localhost.requestly.io` over `localhost` for the API base URL so Requestly can reliably intercept the traffic.

For collections, the extension generates an OpenAPI file that you can import into Requestly API Client. This is the safest MVP because Requestly officially documents OpenAPI import, while a public REST API for programmatically creating collections/folders was not documented in the sources checked.

## Setup

1. Open this folder in VS Code.
2. Run `npm install`.
3. Run `npm run build`.
4. Press `F5` to launch the Extension Development Host.
5. In the Extension Development Host, open a project that contains Express or Next.js API routes.
6. Make sure your API server is running, for example on `http://localhost:3000`.
7. Set `requestlyCopilot.baseUrl` to `http://localhost.requestly.io:3000` or your equivalent local host.
8. Make sure the Requestly desktop app is running and copy the proxy host and port shown in the app into `requestlyCopilot.proxyUrl`.
9. If Requestly shows something like `192.168.x.x:8281`, use that exact value.
10. Configure the extension settings if needed:
   - `requestlyCopilot.baseUrl`
   - `requestlyCopilot.proxyUrl`
   - `requestlyCopilot.aiProvider`
   - `requestlyCopilot.geminiApiKey`
   - `requestlyCopilot.geminiModel`
   - `requestlyCopilot.smolifyApiUrl`
   - `requestlyCopilot.smolifyApiKey`
   - `requestlyCopilot.smolifyModel`
   - `requestlyCopilot.collectionOutputPath`

## Example Usage Flow

1. Open an API route file.
2. Click `Run in Requestly` above the route.
3. The extension reads the route code and generates a structured payload set locally by default.
4. It sends the request through the Requestly proxy.
5. You see the response in a VS Code webview and the request should appear in Requestly.
6. Click `Debug with AI` to retry with invalid or edge-case payloads.
7. If the request fails, the extension shows local debugging suggestions by default.

## AI Collections And Folders

Run the command `Requestly Copilot: Generate Requestly Collection`.

What happens:

1. The extension scans the workspace for supported Express and Next.js App Router routes.
2. The extension groups the routes into practical folders such as `Users`, `Auth`, or `Orders`.
3. The extension writes an OpenAPI file to `.requestly/requestly-copilot.openapi.json` by default.
4. Import that file into Requestly API Client to create a collection with grouped endpoints.

If `requestlyCopilot.aiProvider` is set to `local`, the extension uses smart grouping based on route segments and filenames. If it is set to `gemini`, the extension uses the Gemini API for payload generation, debug suggestions, and route grouping.

## Postman Collection Export

Run the command `Requestly Copilot: Generate Postman Collection`.

What happens:

1. The extension scans the workspace for supported routes.
2. The extension groups the routes using the same AI/local grouping plan.
3. The extension writes a Postman collection file to `.requestly/requestly-copilot.postman.json` by default.
4. Import that file into Postman.

## Gemini Setup

1. Create a Gemini API key in Google AI Studio.
2. Set `requestlyCopilot.aiProvider` to `gemini`.
3. Add your key to a workspace `.env` file as `GEMINI_API_KEY=...` or `REQUESTLY_COPILOT_GEMINI_API_KEY=...`.
4. Optionally change `requestlyCopilot.geminiModel` from the default `gemini-2.5-flash`.

The Gemini integration uses the official Gemini `generateContent` API with structured JSON output.

## Supported Examples

### Express

```ts
app.post("/api/users", async (req, res) => {
  const { name, email } = req.body;
  res.json({ ok: true, name, email });
});
```

### Next.js App Router

```ts
export async function POST(request: Request) {
  const body = await request.json();
  return Response.json({ ok: true, body });
}
```

If the file is `app/api/users/[id]/route.ts`, the detected route becomes `/api/users/:id` and the request executor replaces the dynamic segment with `123`.

## Smolify Response Shape

If you later switch `requestlyCopilot.aiProvider` to `smolify`, the extension expects Smolify to return JSON in this format:

```json
{
  "validPayload": {},
  "invalidPayload": {},
  "edgeCasePayload": {},
  "notes": "Optional notes"
}
```

For debug suggestions:

```json
{
  "summary": "Why the request likely failed",
  "suggestions": [
    "Suggestion 1",
    "Suggestion 2"
  ]
}
```

## Notes

- Default mode: `requestlyCopilot.aiProvider = local`
- Recommended local base URL: `http://localhost.requestly.io:3000`
- Recommended proxy URL: use the exact host and port shown in the Requestly desktop app
- To enable Gemini, set `requestlyCopilot.aiProvider = gemini` and add `requestlyCopilot.geminiApiKey`.
- To enable Smolify later, set `requestlyCopilot.aiProvider = smolify` and add `requestlyCopilot.smolifyApiKey`.
- Postman collections are exported to `.requestly/requestly-copilot.postman.json` by default.
- GET and DELETE requests are sent without a request body.
- Dynamic route params like `:id` and `[id]` are replaced with `123`.
- This implementation is optimized for a hackathon MVP and can be extended later with auth headers, query param generation, richer route parsing, and saved request history.
- Requestly collections/folders are generated through OpenAPI export/import rather than a direct Requestly REST call, because that import flow is the documented integration path.
