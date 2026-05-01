import { preview, generate } from "./pipeline";
import { translate } from "./translate";
import { renderUI } from "./ui";
import type { Env, GenerateRequest, PreviewRequest, TranslateRequest } from "./types";

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/" && request.method === "GET") {
      return new Response(renderUI(), {
        headers: { "Content-Type": "text/html; charset=utf-8" },
      });
    }

    if (url.pathname === "/preview" && request.method === "POST") {
      let body: PreviewRequest;
      try {
        body = await request.json() as PreviewRequest;
      } catch {
        return new Response("Invalid JSON", { status: 400 });
      }
      const { koboToken, serverUrl, assetUid } = body;
      if (!koboToken || !serverUrl || !assetUid) {
        return new Response("Missing koboToken, serverUrl, or assetUid", { status: 400 });
      }
      try {
        const rows = await preview(serverUrl, assetUid, koboToken);
        return Response.json(rows);
      } catch (err) {
        return new Response(err instanceof Error ? err.message : String(err), { status: 502 });
      }
    }

    if (url.pathname === "/generate" && request.method === "POST") {
      let body: GenerateRequest;
      try {
        body = await request.json() as GenerateRequest;
      } catch {
        return new Response("Invalid JSON", { status: 400 });
      }
      const { koboToken, serverUrl, assetUid, voice } = body;
      if (!koboToken || !serverUrl || !assetUid || !voice) {
        return new Response("Missing required fields", { status: 400 });
      }

      const { readable, writable } = new TransformStream();
      const writer = writable.getWriter();
      const encoder = new TextEncoder();

      // Run pipeline in background, stream SSE results
      (async () => {
        try {
          for await (const result of generate(body, env.OPENAI_API_KEY)) {
            await writer.write(encoder.encode(`data: ${JSON.stringify(result)}\n\n`));
          }
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          await writer.write(encoder.encode(`data: ${JSON.stringify({ question: "__pipeline__", status: "error", message: msg })}\n\n`));
        } finally {
          await writer.close();
        }
      })();

      return new Response(readable, {
        headers: {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
        },
      });
    }

    if (url.pathname === "/translate" && request.method === "POST") {
      let body: TranslateRequest;
      try {
        body = await request.json() as TranslateRequest;
      } catch {
        return new Response("Invalid JSON", { status: 400 });
      }
      const { koboToken, serverUrl, assetUid, targetIso, targetLangLabel } = body;
      if (!koboToken || !serverUrl || !assetUid || !targetIso || !targetLangLabel) {
        return new Response("Missing required fields", { status: 400 });
      }

      const { readable, writable } = new TransformStream();
      const writer = writable.getWriter();
      const encoder = new TextEncoder();

      (async () => {
        try {
          for await (const result of translate(body, env.OPENAI_API_KEY)) {
            await writer.write(encoder.encode(`data: ${JSON.stringify(result)}\n\n`));
          }
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          await writer.write(encoder.encode(`data: ${JSON.stringify({ item: "__pipeline__", status: "error", message: msg })}\n\n`));
        } finally {
          await writer.close();
        }
      })();

      return new Response(readable, {
        headers: {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
        },
      });
    }

    return new Response("Not Found", { status: 404 });
  },
} satisfies ExportedHandler<Env>;
