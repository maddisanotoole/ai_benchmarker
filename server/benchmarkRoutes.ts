import { FastifyInstance } from "fastify";
import {
  completeBenchmarkRun,
  createBenchmarkRun,
  insertBenchmarkResult,
  listBenchmarkQuestions,
  listBenchmarkResults,
  upsertBenchmarkQuestions,
} from "./db.js";

type QuestionPayload = {
  id?: string;
  title: string;
  prompt: string;
  enabled: boolean;
  sortOrder?: number;
};

type ResultPayload = {
  runId: string;
  questionId: string;
  questionTitle: string;
  model: string;
  durationMs: number;
  responseText?: string;
  responseLength: number;
  status: "complete" | "error";
  error?: string | null;
};

export default async function benchmarkRoutes(fastify: FastifyInstance) {
  fastify.get("/questions", async () => ({
    questions: listBenchmarkQuestions(),
  }));

  fastify.put<{ Body: { questions?: QuestionPayload[] } }>(
    "/questions",
    async (req, reply) => {
      const questions = req.body.questions;
      if (!Array.isArray(questions)) {
        return reply.status(400).send({ error: "questions must be an array" });
      }

      return {
        questions: upsertBenchmarkQuestions(questions),
      };
    },
  );

  fastify.post<{ Body: { notes?: string } }>("/runs", async (req) => ({
    run: createBenchmarkRun(req.body?.notes),
  }));

  fastify.patch<{
    Params: { id: string };
    Body: { status?: "complete" | "error" };
  }>("/runs/:id", async (req, reply) => {
    const run = completeBenchmarkRun(req.params.id, req.body.status);
    if (!run) return reply.status(404).send({ error: "Run not found" });
    return { run };
  });

  fastify.get("/results", async () => ({
    results: listBenchmarkResults(),
  }));

  fastify.post<{ Body: ResultPayload }>("/results", async (req, reply) => {
    const result = req.body;
    if (!result.runId || !result.questionId || !result.model) {
      return reply
        .status(400)
        .send({ error: "runId, questionId, and model are required" });
    }

    return {
      result: insertBenchmarkResult({
        ...result,
        responseText: result.responseText ?? "",
      }),
    };
  });
}
