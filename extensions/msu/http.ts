// "http" tool: the model can send an HTTP request, for example to read docs or to test a local server.
// permissions.ts decides if the student must allow the request first.

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

const MAX_CHARS = 50_000;
const TIMEOUT_MS = 30_000;

const PARAMS = Type.Object({
  url: Type.String({ description: "Full URL, for example https://example.com/page or http://localhost:3000/api" }),
  method: Type.Optional(Type.String({ description: "HTTP method. Default: GET" })),
  headers: Type.Optional(Type.Record(Type.String(), Type.String(), { description: "Request headers" })),
  body: Type.Optional(Type.String({ description: "Request body, for example JSON text" })),
  raw: Type.Optional(Type.Boolean({ description: "If true, return HTML as it is. Default: HTML becomes plain text" })),
});

// Plain text from HTML, so a web page does not fill the context with markup.
function htmlToText(html: string): string {
  return html
    .replace(/<(script|style|noscript|svg)[\s\S]*?<\/\1>/gi, "")
    .replace(/<(br|\/p|\/div|\/li|\/h[1-6]|\/tr|\/title)[^>]*>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s*\n+/g, "\n\n")
    .trim();
}

export function registerHttpTool(pi: ExtensionAPI) {
  pi.registerTool({
    name: "http",
    label: "HTTP",
    description: `Send an HTTP request and return the status, the content type, and the body (at most ${MAX_CHARS} characters).`,
    promptSnippet: "Send HTTP requests (read web pages and docs, call APIs, test local servers)",
    parameters: PARAMS,
    async execute(_id, params, signal) {
      const method = (params.method ?? "GET").toUpperCase();
      const timeout = AbortSignal.timeout(TIMEOUT_MS);
      const res = await fetch(params.url, {
        method,
        headers: params.headers,
        body: params.body,
        redirect: "follow",
        signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
      });
      const type = res.headers.get("content-type") ?? "";
      let body = await res.text();
      if (type.includes("html") && !params.raw) body = htmlToText(body);
      const cut = body.length > MAX_CHARS;
      if (cut) body = body.slice(0, MAX_CHARS);
      const text = [
        `${method} ${res.url}`,
        `Status: ${res.status} ${res.statusText}`,
        `Content-Type: ${type || "unknown"}`,
        "",
        body,
        cut ? `\n[Body cut at ${MAX_CHARS} characters.]` : "",
      ].join("\n");
      return { content: [{ type: "text", text }], details: { status: res.status } };
    },
  });
}
