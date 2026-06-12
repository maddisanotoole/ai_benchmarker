import Database from "better-sqlite3";
import { mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";

export type BenchmarkQuestionRecord = {
  id: string;
  title: string;
  prompt: string;
  enabled: boolean;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
};

export type BenchmarkRunRecord = {
  id: string;
  startedAt: string;
  completedAt: string | null;
  status: "running" | "complete" | "error";
  notes: string | null;
};

export type BenchmarkResultRecord = {
  id: string;
  runId: string;
  questionId: string;
  questionTitle: string;
  model: string;
  durationMs: number;
  responseText: string;
  responseLength: number;
  status: "complete" | "error";
  error: string | null;
  createdAt: string;
};

type QuestionRow = {
  id: string;
  title: string;
  prompt: string;
  enabled: number;
  sort_order: number;
  created_at: string;
  updated_at: string;
};

type RunRow = {
  id: string;
  started_at: string;
  completed_at: string | null;
  status: "running" | "complete" | "error";
  notes: string | null;
};

type ResultRow = {
  id: string;
  run_id: string;
  question_id: string;
  question_title: string;
  model: string;
  duration_ms: number;
  response_text: string;
  response_length: number;
  status: "complete" | "error";
  error: string | null;
  created_at: string;
};

type SeedQuestion = {
  id: string;
  title: string;
  prompt: string;
};

const dbDirectory = path.resolve(process.cwd(), "data");
mkdirSync(dbDirectory, { recursive: true });

export const db = new Database(path.join(dbDirectory, "benchmarks.sqlite"));
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

db.exec(`
  CREATE TABLE IF NOT EXISTS benchmark_questions (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    prompt TEXT NOT NULL,
    enabled INTEGER NOT NULL DEFAULT 1,
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS benchmark_runs (
    id TEXT PRIMARY KEY,
    started_at TEXT NOT NULL,
    completed_at TEXT,
    status TEXT NOT NULL CHECK (status IN ('running', 'complete', 'error')),
    notes TEXT
  );

  CREATE TABLE IF NOT EXISTS benchmark_results (
    id TEXT PRIMARY KEY,
    run_id TEXT NOT NULL,
    question_id TEXT NOT NULL,
    question_title TEXT NOT NULL,
    model TEXT NOT NULL,
    duration_ms INTEGER NOT NULL,
    response_text TEXT NOT NULL DEFAULT '',
    response_length INTEGER NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('complete', 'error')),
    error TEXT,
    created_at TEXT NOT NULL,
    FOREIGN KEY (run_id) REFERENCES benchmark_runs(id) ON DELETE CASCADE,
    FOREIGN KEY (question_id) REFERENCES benchmark_questions(id) ON DELETE SET NULL
  );
`);

const questionCount = db
  .prepare("SELECT COUNT(*) AS count FROM benchmark_questions")
  .get() as { count: number };

if (questionCount.count === 0) {
  const seedPath = path.join(process.cwd(), "benchmarkQuestions.json");
  const questions = JSON.parse(readFileSync(seedPath, "utf-8")) as SeedQuestion[];
  const now = new Date().toISOString();
  const insert = db.prepare(`
    INSERT INTO benchmark_questions (
      id, title, prompt, enabled, sort_order, created_at, updated_at
    ) VALUES (
      @id, @title, @prompt, 1, @sortOrder, @createdAt, @updatedAt
    )
  `);

  const seed = db.transaction(() => {
    questions.forEach((question, index) => {
      insert.run({
        ...question,
        sortOrder: index,
        createdAt: now,
        updatedAt: now,
      });
    });
  });

  seed();
}

function mapQuestion(row: QuestionRow): BenchmarkQuestionRecord {
  return {
    id: row.id,
    title: row.title,
    prompt: row.prompt,
    enabled: row.enabled === 1,
    sortOrder: row.sort_order,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapRun(row: RunRow): BenchmarkRunRecord {
  return {
    id: row.id,
    startedAt: row.started_at,
    completedAt: row.completed_at,
    status: row.status,
    notes: row.notes,
  };
}

function mapResult(row: ResultRow): BenchmarkResultRecord {
  return {
    id: row.id,
    runId: row.run_id,
    questionId: row.question_id,
    questionTitle: row.question_title,
    model: row.model,
    durationMs: row.duration_ms,
    responseText: row.response_text,
    responseLength: row.response_length,
    status: row.status,
    error: row.error,
    createdAt: row.created_at,
  };
}

export function listBenchmarkQuestions() {
  const rows = db
    .prepare("SELECT * FROM benchmark_questions ORDER BY sort_order, created_at")
    .all() as QuestionRow[];
  return rows.map(mapQuestion);
}

export function upsertBenchmarkQuestions(
  questions: Array<{
    id?: string;
    title: string;
    prompt: string;
    enabled: boolean;
    sortOrder?: number;
  }>,
) {
  const now = new Date().toISOString();
  const upsert = db.prepare(`
    INSERT INTO benchmark_questions (
      id, title, prompt, enabled, sort_order, created_at, updated_at
    ) VALUES (
      @id, @title, @prompt, @enabled, @sortOrder, @createdAt, @updatedAt
    )
    ON CONFLICT(id) DO UPDATE SET
      title = excluded.title,
      prompt = excluded.prompt,
      enabled = excluded.enabled,
      sort_order = excluded.sort_order,
      updated_at = excluded.updated_at
  `);

  const write = db.transaction(() => {
    questions.forEach((question, index) => {
      upsert.run({
        id: question.id || randomUUID(),
        title: question.title,
        prompt: question.prompt,
        enabled: question.enabled ? 1 : 0,
        sortOrder: question.sortOrder ?? index,
        createdAt: now,
        updatedAt: now,
      });
    });
  });

  write();
  return listBenchmarkQuestions();
}

export function createBenchmarkRun(notes?: string) {
  const run = {
    id: randomUUID(),
    startedAt: new Date().toISOString(),
    completedAt: null,
    status: "running" as const,
    notes: notes || null,
  };

  db.prepare(`
    INSERT INTO benchmark_runs (id, started_at, completed_at, status, notes)
    VALUES (@id, @startedAt, @completedAt, @status, @notes)
  `).run(run);

  return run;
}

export function completeBenchmarkRun(
  id: string,
  status: "complete" | "error" = "complete",
) {
  db.prepare(`
    UPDATE benchmark_runs
    SET completed_at = @completedAt, status = @status
    WHERE id = @id
  `).run({
    id,
    status,
    completedAt: new Date().toISOString(),
  });

  const row = db
    .prepare("SELECT * FROM benchmark_runs WHERE id = ?")
    .get(id) as RunRow | undefined;
  return row ? mapRun(row) : null;
}

export function insertBenchmarkResult(result: {
  runId: string;
  questionId: string;
  questionTitle: string;
  model: string;
  durationMs: number;
  responseText: string;
  responseLength: number;
  status: "complete" | "error";
  error?: string | null;
}) {
  const row = {
    id: randomUUID(),
    ...result,
    error: result.error || null,
    createdAt: new Date().toISOString(),
  };

  db.prepare(`
    INSERT INTO benchmark_results (
      id, run_id, question_id, question_title, model, duration_ms,
      response_text, response_length, status, error, created_at
    ) VALUES (
      @id, @runId, @questionId, @questionTitle, @model, @durationMs,
      @responseText, @responseLength, @status, @error, @createdAt
    )
  `).run(row);

  const saved = db
    .prepare("SELECT * FROM benchmark_results WHERE id = ?")
    .get(row.id) as ResultRow;
  return mapResult(saved);
}

export function listBenchmarkResults() {
  const rows = db
    .prepare("SELECT * FROM benchmark_results ORDER BY created_at DESC")
    .all() as ResultRow[];
  return rows.map(mapResult);
}
