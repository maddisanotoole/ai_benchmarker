import { FastifyInstance, FastifyReply } from "fastify";
import { request } from "undici";

async function streamToString(stream: NodeJS.ReadableStream) {
  const chunks: Uint8Array[] = [];
  for await (const chunk of stream as AsyncIterable<Uint8Array>) {
    chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
  }
  return Buffer.concat(chunks).toString("utf-8");
}

const blockedResponseHeaders = new Set([
  "access-control-allow-credentials",
  "access-control-allow-headers",
  "access-control-allow-methods",
  "access-control-allow-origin",
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
]);

function copyUpstreamHeaders(
  reply: FastifyReply,
  headers: Record<string, string | string[] | undefined>,
) {
  for (const [key, value] of Object.entries(headers)) {
    if (!value || blockedResponseHeaders.has(key.toLowerCase())) continue;
    reply.header(key, Array.isArray(value) ? value.join(", ") : value);
  }
}

export default async function (fastify: FastifyInstance) {
  fastify.post("/generate", async (req, reply) => {
    const target = process.env.OLLAMA_URL || "http://localhost:11434";
    const url = `${target}/api/generate`;
    const body = JSON.stringify(req.body || {});
    const timeoutMs = Number(process.env.OLLAMA_TIMEOUT_MS) || 60000;

    fastify.log.info({ url, body }, "proxying /api/ollama/generate request");

    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), timeoutMs);

    try {
      const {
        statusCode,
        headers,
        body: upstream,
      } = await request(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body,
        signal: ac.signal,
      });

      clearTimeout(timer);
      fastify.log.info({ statusCode, headers }, "upstream ollama response");

      if (statusCode >= 400) {
        const errorText = await streamToString(
          upstream as NodeJS.ReadableStream,
        );
        fastify.log.error(
          { statusCode, errorText },
          "upstream ollama error response",
        );

        reply.status(statusCode);
        copyUpstreamHeaders(reply, headers);
        return reply.send(errorText);
      }

      reply.status(statusCode);
      copyUpstreamHeaders(reply, headers);
      return reply.send(upstream as NodeJS.ReadableStream);
    } catch (err) {
      clearTimeout(timer);
      fastify.log.error({ err, url, body }, "error proxying ollama request");
      if ((err as any).name === "AbortError") {
        return reply.status(504).send({ error: "Upstream request timed out" });
      }
      return reply.status(502).send({ error: "Upstream request failed" });
    }
  });
}
