import { ExtensionConfig } from "./config";
import { DebugSuggestion, PayloadSet, RouteGroupPlan } from "./types";

export async function generatePayloads(apiCode: string, config: ExtensionConfig): Promise<PayloadSet> {
  if (config.aiProvider === "gemini" && config.geminiApiKey) {
    const prompt = [
      "You generate payloads for API testing.",
      "Analyze the following API code and infer the expected request body.",
      apiCode
    ].join("\n\n");

    try {
      return await callGeminiJson<PayloadSet>(prompt, config, {
        type: "object",
        properties: {
          validPayload: { type: "object" },
          invalidPayload: { type: "object" },
          edgeCasePayload: { type: "object" },
          notes: { type: "string" }
        },
        required: ["validPayload", "invalidPayload", "edgeCasePayload"]
      });
    } catch (error) {
      return buildFallbackPayloads(apiCode, toProviderFallbackNote("Gemini", error));
    }
  }

  if (config.aiProvider !== "smolify" || !config.smolifyApiKey) {
    return buildFallbackPayloads(apiCode);
  }

  const prompt = [
    "You generate payloads for API testing.",
    "Return only valid JSON with this exact shape:",
    '{ "validPayload": {}, "invalidPayload": {}, "edgeCasePayload": {}, "notes": "string" }',
    "Analyze the following API code and infer the expected request body.",
    apiCode
  ].join("\n\n");

  const responseText = await callSmolify(prompt, config);
  try {
    const parsed = JSON.parse(responseText) as PayloadSet;
    return {
      validPayload: parsed.validPayload ?? {},
      invalidPayload: parsed.invalidPayload ?? {},
      edgeCasePayload: parsed.edgeCasePayload ?? {},
      notes: parsed.notes
    };
  } catch {
    return buildFallbackPayloads(apiCode, responseText);
  }
}

export async function generateDebugSuggestions(
  apiCode: string,
  payload: unknown,
  responseBody: string,
  statusCode: number,
  config: ExtensionConfig
): Promise<DebugSuggestion> {
  if (config.aiProvider === "gemini" && config.geminiApiKey) {
    const prompt = [
      "You are debugging a failing API request.",
      "API code:",
      apiCode,
      "Payload:",
      JSON.stringify(payload, null, 2),
      `Status code: ${statusCode}`,
      "Response body:",
      responseBody
    ].join("\n\n");

    try {
      return await callGeminiJson<DebugSuggestion>(prompt, config, {
        type: "object",
        properties: {
          summary: { type: "string" },
          suggestions: {
            type: "array",
            items: { type: "string" }
          }
        },
        required: ["summary", "suggestions"]
      });
    } catch (error) {
      return {
        summary: toProviderFallbackNote("Gemini", error),
        suggestions: [
          "Check whether the payload shape matches what the route expects.",
          "Verify required fields and data types before retrying.",
          "Use the Requestly session to inspect the exact request body and headers."
        ]
      };
    }
  }

  if (config.aiProvider !== "smolify" || !config.smolifyApiKey) {
    return {
      summary: "Local fallback guidance is enabled, so the Smolify call was skipped.",
      suggestions: [
        "Check whether the payload shape matches what the route expects.",
        "Verify required fields and data types before retrying.",
        "Use the Requestly session to inspect the exact request body and headers."
      ]
    };
  }

  const prompt = [
    "You are debugging a failing API request.",
    "Return only valid JSON with this exact shape:",
    '{ "summary": "string", "suggestions": ["string"] }',
    "API code:",
    apiCode,
    "Payload:",
    JSON.stringify(payload, null, 2),
    `Status code: ${statusCode}`,
    "Response body:",
    responseBody
  ].join("\n\n");

  const responseText = await callSmolify(prompt, config);
  try {
    const parsed = JSON.parse(responseText) as DebugSuggestion;
    return {
      summary: parsed.summary ?? "AI generated debug summary.",
      suggestions: Array.isArray(parsed.suggestions) ? parsed.suggestions : []
    };
  } catch {
    return {
      summary: "Smolify response could not be parsed, so showing the raw guidance.",
      suggestions: [responseText]
    };
  }
}

export async function generateRouteGroupingPlan(
  routeSummaries: Array<{ key: string; method: string; path: string; filePath: string }>,
  config: ExtensionConfig
): Promise<RouteGroupPlan> {
  if (config.aiProvider === "gemini" && config.geminiApiKey) {
    const prompt = [
      "You are organizing API endpoints into a Requestly collection.",
      "Group related routes into practical folders for debugging and testing.",
      "Use the provided route keys exactly as-is.",
      JSON.stringify(routeSummaries, null, 2)
    ].join("\n\n");

    try {
      const parsed = await callGeminiJson<RouteGroupPlan>(prompt, config, {
        type: "object",
        properties: {
          collectionName: { type: "string" },
          description: { type: "string" },
          folders: {
            type: "array",
            items: {
              type: "object",
              properties: {
                name: { type: "string" },
                routeKeys: {
                  type: "array",
                  items: { type: "string" }
                }
              },
              required: ["name", "routeKeys"]
            }
          }
        },
        required: ["collectionName", "description", "folders"]
      });

      return normalizeRoutePlan(parsed, routeSummaries);
    } catch {
      return buildFallbackRoutePlan(routeSummaries);
    }
  }

  if (config.aiProvider !== "smolify" || !config.smolifyApiKey) {
    return buildFallbackRoutePlan(routeSummaries);
  }

  const prompt = [
    "You are organizing API endpoints into a Requestly collection.",
    "Return only valid JSON with this exact shape:",
    '{ "collectionName": "string", "description": "string", "folders": [{ "name": "string", "routeKeys": ["METHOD /path"] }] }',
    "Group related routes into practical folders for debugging and testing.",
    "Use the provided route keys exactly as-is.",
    JSON.stringify(routeSummaries, null, 2)
  ].join("\n\n");

  const responseText = await callSmolify(prompt, config);
  try {
    const parsed = JSON.parse(responseText) as RouteGroupPlan;
    return normalizeRoutePlan(parsed, routeSummaries);
  } catch {
    return buildFallbackRoutePlan(routeSummaries);
  }
}

async function callGeminiJson<T>(prompt: string, config: ExtensionConfig, schema: GeminiSchema): Promise<T> {
  const response = await fetch(
    `${config.geminiApiUrl}/models/${encodeURIComponent(config.geminiModel)}:generateContent`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": config.geminiApiKey
      },
      body: JSON.stringify({
        contents: [
          {
            role: "user",
            parts: [{ text: prompt }]
          }
        ],
        generationConfig: {
          temperature: 0.2,
          responseMimeType: "application/json",
          responseJsonSchema: schema
        }
      })
    }
  );

  if (!response.ok) {
    throw new Error(`Gemini request failed with ${response.status} ${response.statusText}`);
  }

  const data = await response.json() as GeminiResponse;
  const content = extractGeminiText(data);
  return JSON.parse(stripCodeFence(content)) as T;
}

async function callSmolify(prompt: string, config: ExtensionConfig): Promise<string> {
  const response = await fetch(config.smolifyApiUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${config.smolifyApiKey}`
    },
    body: JSON.stringify({
      model: config.smolifyModel,
      messages: [
        {
          role: "user",
          content: prompt
        }
      ],
      temperature: 0.2
    })
  });

  if (!response.ok) {
    throw new Error(`Smolify request failed with ${response.status} ${response.statusText}`);
  }

  const data = await response.json() as {
    choices?: Array<{ message?: { content?: string } }>;
  };

  const content = data.choices?.[0]?.message?.content;
  if (!content) {
    throw new Error("Smolify response did not include content.");
  }

  return stripCodeFence(content);
}

function stripCodeFence(content: string): string {
  return content.replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/\s*```$/, "").trim();
}

function extractGeminiText(data: GeminiResponse): string {
  const candidate = data.candidates?.[0];
  const part = candidate?.content?.parts?.find((entry) => typeof entry.text === "string");
  if (!part?.text) {
    throw new Error("Gemini response did not include text content.");
  }

  return part.text;
}

function toProviderFallbackNote(providerName: string, error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return `${providerName} was configured, but the response could not be used. Falling back to local generation. Details: ${message}`;
}

function buildFallbackPayloads(apiCode: string, notes?: string): PayloadSet {
  const lowerCode = apiCode.toLowerCase();
  const looksLikeId = lowerCode.includes("id");
  const looksLikeEmail = lowerCode.includes("email");
  const looksLikeName = lowerCode.includes("name");

  return {
    validPayload: {
      ...(looksLikeName ? { name: "Demo User" } : {}),
      ...(looksLikeEmail ? { email: "demo@example.com" } : {}),
      ...(looksLikeId ? { id: 123 } : {}),
      sample: "value"
    },
    invalidPayload: {
      id: "not-a-number",
      email: "invalid-email",
      sample: null
    },
    edgeCasePayload: {
      ...(looksLikeName ? { name: "" } : {}),
      ...(looksLikeEmail ? { email: "very.long.alias+test@example.com" } : {}),
      ...(looksLikeId ? { id: 0 } : {}),
      sample: ""
    },
    notes: notes ?? "Fallback payloads were generated locally because the local provider is enabled or Smolify did not return valid JSON."
  };
}

function buildFallbackRoutePlan(
  routeSummaries: Array<{ key: string; method: string; path: string; filePath: string }>
): RouteGroupPlan {
  const buckets = new Map<string, string[]>();

  for (const route of routeSummaries) {
    const folderName = inferFolderName(route.path, route.filePath);
    const existing = buckets.get(folderName) ?? [];
    existing.push(route.key);
    buckets.set(folderName, existing);
  }

  return {
    collectionName: "Requestly Copilot Collection",
    description: "AI-assisted collection generated from detected API routes.",
    folders: Array.from(buckets.entries()).map(([name, routeKeys]) => ({
      name,
      routeKeys
    }))
  };
}

function normalizeRoutePlan(
  parsed: RouteGroupPlan,
  routeSummaries: Array<{ key: string; method: string; path: string; filePath: string }>
): RouteGroupPlan {
  const validKeys = new Set(routeSummaries.map((route) => route.key));
  const folders = Array.isArray(parsed.folders)
    ? parsed.folders.map((folder) => ({
        name: folder.name || "General",
        routeKeys: Array.isArray(folder.routeKeys)
          ? folder.routeKeys.filter((key) => validKeys.has(key))
          : []
      })).filter((folder) => folder.routeKeys.length > 0)
    : [];

  if (!folders.length) {
    return buildFallbackRoutePlan(routeSummaries);
  }

  return {
    collectionName: parsed.collectionName || "Requestly Copilot Collection",
    description: parsed.description || "Generated by Requestly Copilot.",
    folders
  };
}

type GeminiSchema = {
  type: "object" | "array" | "string" | "number" | "integer" | "boolean";
  properties?: Record<string, GeminiSchema>;
  items?: GeminiSchema;
  required?: string[];
};

interface GeminiResponse {
  candidates?: Array<{
    content?: {
      parts?: Array<{
        text?: string;
      }>;
    };
  }>;
}

function inferFolderName(path: string, filePath: string): string {
  const firstSegment = path.split("/").filter(Boolean)[0];
  if (firstSegment) {
    return capitalize(firstSegment.replace(/[:[\]]/g, ""));
  }

  const normalized = filePath.replace(/\\/g, "/");
  const fileName = normalized.split("/").pop()?.replace(/\.(t|j)sx?$/, "") || "General";
  return capitalize(fileName);
}

function capitalize(value: string): string {
  if (!value) {
    return "General";
  }

  return value.charAt(0).toUpperCase() + value.slice(1);
}
