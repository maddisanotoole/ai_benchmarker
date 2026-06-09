import Fastify from "fastify";
import dotenv from "dotenv";
import cors from "@fastify/cors";
import { request } from "undici";
import ollamaRoutes from "./ollamaProxy.js";

dotenv.config();

const app = Fastify({ logger: true });

app.register(cors, {
  origin: process.env.CLIENT_ORIGIN || "http://localhost:5173",
});

app.register(ollamaRoutes, { prefix: "/api/ollama" });

const port = Number(process.env.PORT) || 8000;
const ollamaBase = process.env.OLLAMA_URL || "http://localhost:11434";

async function logOllamaModels() {
  try {
    const { statusCode, body } = await request(`${ollamaBase}/api/ps`, {
      method: "GET",
      headers: { "content-type": "application/json" },
    });

    const text = await new Response(body as any).text();
    app.log.info({ statusCode, response: text }, "ollama model list");
  } catch (err) {
    app.log.error({ err, ollamaBase }, "failed to fetch ollama model list");
  }
}

async function start() {
  await logOllamaModels();

  await app.listen({ port, host: "0.0.0.0" });
  app.log.info(`Server listening on ${port}`);
}

start().catch((err) => {
  app.log.error(err);
  process.exit(1);
});
