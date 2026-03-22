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
  const fields = inferExpectedFields(apiCode);
  const validPayload = Object.fromEntries(fields.map((field) => [field.name, buildValidValue(field)]));
  const invalidPayload = Object.fromEntries(fields.map((field) => [field.name, buildInvalidValue(field)]));
  const edgeCasePayload = Object.fromEntries(fields.map((field) => [field.name, buildEdgeCaseValue(field)]));

  if (!fields.length) {
    return {
      validPayload: {},
      invalidPayload: {},
      edgeCasePayload: {},
      notes: notes ?? "No request body fields could be inferred from the route code, so empty fallback payloads were generated."
    };
  }

  return {
    validPayload,
    invalidPayload,
    edgeCasePayload,
    notes: notes ?? `Fallback payloads were inferred from route code fields: ${fields.map((field) => field.name).join(", ")}.`
  };
}

type InferredFieldType = "string" | "number" | "boolean" | "array" | "object";

interface InferredField {
  name: string;
  type: InferredFieldType;
}

function inferExpectedFields(apiCode: string): InferredField[] {
  const fields = new Map<string, InferredField>();

  collectDestructuredFields(apiCode, fields);
  collectObjectLiteralFields(apiCode, fields);
  collectMongooseSchemaFields(apiCode, fields);
  collectPropertyAccessFields(apiCode, fields);

  return Array.from(fields.values());
}

function collectDestructuredFields(apiCode: string, fields: Map<string, InferredField>): void {
  const destructureRegexes = [
    /const\s*\{([^}]+)\}\s*=\s*req\.body/g,
    /const\s*\{([^}]+)\}\s*=\s*body/g,
    /const\s*\{([^}]+)\}\s*=\s*payload/g,
    /const\s*\{([^}]+)\}\s*=\s*data/g
  ];

  for (const regex of destructureRegexes) {
    for (const match of apiCode.matchAll(regex)) {
      const entries = match[1]
        .split(",")
        .map((part) => part.trim())
        .filter(Boolean);

      for (const entry of entries) {
        const [rawName] = entry.split(/[:=]/).map((part) => part.trim());
        if (rawName) {
          upsertField(fields, rawName, inferFieldType(apiCode, rawName));
        }
      }
    }
  }
}

function collectObjectLiteralFields(apiCode: string, fields: Map<string, InferredField>): void {
  const zodObjectRegex = /z\.object\s*\(\s*\{([\s\S]*?)\}\s*\)/g;

  for (const match of apiCode.matchAll(zodObjectRegex)) {
    const body = match[1];
    for (const propMatch of body.matchAll(/([A-Za-z_$][\w$]*)\s*:\s*([^\n,}]+)/g)) {
      const name = propMatch[1];
      const schemaSource = propMatch[2];
      upsertField(fields, name, inferTypeFromSchemaSource(name, schemaSource, apiCode));
    }
  }
}

function collectPropertyAccessFields(apiCode: string, fields: Map<string, InferredField>): void {
  const propertyRegexes = [
    /req\.body\.([A-Za-z_$][\w$]*)/g,
    /body\.([A-Za-z_$][\w$]*)/g,
    /payload\.([A-Za-z_$][\w$]*)/g,
    /data\.([A-Za-z_$][\w$]*)/g
  ];

  for (const regex of propertyRegexes) {
    for (const match of apiCode.matchAll(regex)) {
      const name = match[1];
      upsertField(fields, name, inferFieldType(apiCode, name));
    }
  }
}

function collectMongooseSchemaFields(apiCode: string, fields: Map<string, InferredField>): void {
  for (const match of apiCode.matchAll(/([A-Za-z_$][\w$]*)\s*:\s*Boolean\b/g)) {
    upsertField(fields, match[1], "boolean");
  }

  for (const match of apiCode.matchAll(/([A-Za-z_$][\w$]*)\s*:\s*Number\b/g)) {
    upsertField(fields, match[1], "number");
  }

  for (const match of apiCode.matchAll(/([A-Za-z_$][\w$]*)\s*:\s*String\b/g)) {
    upsertField(fields, match[1], "string");
  }

  for (const match of apiCode.matchAll(/([A-Za-z_$][\w$]*)\s*:\s*\[\s*(String|Number|Boolean)\s*\]/g)) {
    upsertField(fields, match[1], "array");
  }

  for (const match of apiCode.matchAll(/([A-Za-z_$][\w$]*)\s*:\s*\{\s*type\s*:\s*(Boolean|Number|String|\[[^\]]+\])/g)) {
    const fieldName = match[1];
    const schemaType = match[2];

    if (schemaType === "Boolean") {
      upsertField(fields, fieldName, "boolean");
    } else if (schemaType === "Number") {
      upsertField(fields, fieldName, "number");
    } else if (schemaType === "String") {
      upsertField(fields, fieldName, "string");
    } else {
      upsertField(fields, fieldName, "array");
    }
  }
}

function upsertField(fields: Map<string, InferredField>, name: string, type: InferredFieldType): void {
  if (!fields.has(name)) {
    fields.set(name, { name, type });
    return;
  }

  const existing = fields.get(name);
  if (existing && existing.type === "string" && type !== "string") {
    fields.set(name, { name, type });
  }
}

function inferFieldType(apiCode: string, fieldName: string): InferredFieldType {
  const lowerName = fieldName.toLowerCase();
  const fieldPattern = escapeRegex(fieldName);

  if (new RegExp(`${fieldPattern}\\s*:\\s*z\\.number\\b|typeof\\s+${fieldPattern}\\s*===\\s*["']number["']|Number\\(${fieldPattern}\\)`).test(apiCode)) {
    return "number";
  }

  if (new RegExp(`${fieldPattern}\\s*:\\s*z\\.boolean\\b|typeof\\s+${fieldPattern}\\s*===\\s*["']boolean["']`).test(apiCode)) {
    return "boolean";
  }

  if (new RegExp(`${fieldPattern}\\s*:\\s*z\\.array\\b|Array\\.isArray\\(${fieldPattern}\\)`).test(apiCode)) {
    return "array";
  }

  if (new RegExp(`${fieldPattern}\\s*:\\s*z\\.object\\b`).test(apiCode)) {
    return "object";
  }

  if (/(^|_)(id|count|age|price|amount|qty|quantity|index|page|limit|offset)$/.test(lowerName)) {
    return "number";
  }

  if (/^(is|has|can|should)[A-Z_]|^(is|has|can|should)/.test(fieldName)) {
    return "boolean";
  }

  if (/(completed|enabled|disabled|published|verified|active|archived|deleted|done|visible|checked)$/.test(lowerName)) {
    return "boolean";
  }

  if (/(list|items|tags|ids|values)$/.test(lowerName)) {
    return "array";
  }

  return "string";
}

function inferTypeFromSchemaSource(fieldName: string, schemaSource: string, apiCode: string): InferredFieldType {
  if (schemaSource.includes("z.number")) {
    return "number";
  }
  if (schemaSource.includes("z.boolean")) {
    return "boolean";
  }
  if (schemaSource.includes("z.array")) {
    return "array";
  }
  if (schemaSource.includes("z.object")) {
    return "object";
  }

  return inferFieldType(apiCode, fieldName);
}

function buildValidValue(field: InferredField): unknown {
  const lowerName = field.name.toLowerCase();

  switch (field.type) {
    case "number":
      return lowerName.includes("price") || lowerName.includes("amount") ? 99.99 : 123;
    case "boolean":
      return true;
    case "array":
      return lowerName.includes("id") ? [1, 2, 3] : ["item-1", "item-2"];
    case "object":
      return {};
    case "string":
    default:
      if (lowerName.includes("email")) {
        return "demo@example.com";
      }
      if (lowerName.includes("name")) {
        return "Demo User";
      }
      if (lowerName.includes("title")) {
        return "Demo title";
      }
      if (lowerName.includes("description") || lowerName.includes("content")) {
        return "Demo description";
      }
      if (lowerName.includes("status")) {
        return "active";
      }
      if (lowerName.includes("phone")) {
        return "9876543210";
      }
      if (lowerName.includes("url")) {
        return "https://example.com";
      }
      return `sample-${field.name}`;
  }
}

function buildInvalidValue(field: InferredField): unknown {
  switch (field.type) {
    case "number":
      return "not-a-number";
    case "boolean":
      return "not-a-boolean";
    case "array":
      return "not-an-array";
    case "object":
      return "not-an-object";
    case "string":
    default:
      return field.name.toLowerCase().includes("email") ? "invalid-email" : null;
  }
}

function buildEdgeCaseValue(field: InferredField): unknown {
  switch (field.type) {
    case "number":
      return 0;
    case "boolean":
      return false;
    case "array":
      return [];
    case "object":
      return {};
    case "string":
    default:
      return "";
  }
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
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
