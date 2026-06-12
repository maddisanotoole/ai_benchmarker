import { useEffect, useRef, useState } from "react";
import benchmarkQuestionDefaults from "./benchmarkQuestions.json";
import copyIcon from "./assets/copy.svg";
import "./App.css";

type ChatMessage = {
  id: number;
  role: "user" | "assistant";
  text: string;
  status?: "error";
  model?: string;
  durationMs?: number;
};

type OllamaModel = {
  name: string;
  model?: string;
  modified_at?: string;
  size?: number;
  details?: {
    family?: string;
    parameter_size?: string;
    quantization_level?: string;
  };
};

type BenchmarkQuestion = {
  id: string;
  title: string;
  prompt: string;
  enabled: boolean;
  sortOrder?: number;
};

type BenchmarkResult = {
  id: string;
  runId: string;
  model: string;
  questionId: string;
  questionTitle: string;
  durationMs: number;
  responseText?: string;
  responseLength: number;
  status: "complete" | "error";
  error?: string;
};

type ActiveTab = "chat" | "benchmarks";

const API_BASE_URL =
  import.meta.env.VITE_API_BASE_URL ?? "http://localhost:8000/api/ollama";
const API_URL = import.meta.env.VITE_API_URL ?? `${API_BASE_URL}/generate`;
const MODELS_API_URL =
  import.meta.env.VITE_MODELS_API_URL ?? `${API_BASE_URL}/models`;
const BENCHMARKS_API_URL =
  import.meta.env.VITE_BENCHMARKS_API_URL ??
  `${API_BASE_URL.replace(/\/ollama$/, "")}/benchmarks`;
const DEFAULT_MODEL_NAME = import.meta.env.VITE_OLLAMA_MODEL ?? "llama2";

const defaultBenchmarkQuestions: BenchmarkQuestion[] =
  benchmarkQuestionDefaults.map((question) => ({
    ...question,
    enabled: true,
  }));

function App() {
  const [activeTab, setActiveTab] = useState<ActiveTab>("chat");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [models, setModels] = useState<OllamaModel[]>([]);
  const [selectedModel, setSelectedModel] = useState(DEFAULT_MODEL_NAME);
  const [benchmarkModelNames, setBenchmarkModelNames] = useState<string[]>([]);
  const [benchmarkQuestions, setBenchmarkQuestions] = useState<
    BenchmarkQuestion[]
  >(defaultBenchmarkQuestions);
  const [benchmarkResults, setBenchmarkResults] = useState<BenchmarkResult[]>(
    [],
  );
  const [benchmarkRunning, setBenchmarkRunning] = useState(false);
  const [benchmarkStatus, setBenchmarkStatus] = useState("");
  const [modelsLoading, setModelsLoading] = useState(true);
  const [prompt, setPrompt] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [copiedMessageId, setCopiedMessageId] = useState<number | null>(null);
  const [thinkingStep, setThinkingStep] = useState(1);
  const messageEndRef = useRef<HTMLDivElement | null>(null);
  const promptRef = useRef<HTMLTextAreaElement | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const streamBufferRef = useRef("");
  const nextMessageIdRef = useRef(1);
  const copiedTimeoutRef = useRef<number | null>(null);

  const createMessage = (
    role: ChatMessage["role"],
    text: string,
    options?: Pick<ChatMessage, "status" | "model" | "durationMs">,
  ): ChatMessage => ({
    id: nextMessageIdRef.current++,
    role,
    text,
    ...options,
  });

  useEffect(() => {
    messageEndRef.current?.scrollIntoView({
      behavior: "smooth",
      block: "nearest",
    });
  }, [messages]);

  useEffect(() => {
    let active = true;

    async function loadModels() {
      setModelsLoading(true);
      try {
        const response = await fetch(MODELS_API_URL);
        if (!response.ok) {
          const payload = await response.text();
          throw new Error(payload || `Server returned ${response.status}`);
        }

        const payload = (await response.json()) as { models?: OllamaModel[] };
        const availableModels = payload.models ?? [];
        if (!active) return;

        setModels(availableModels);
        setBenchmarkModelNames((current) => {
          const availableNames = availableModels.map((model) => model.name);
          const stillAvailable = current.filter((name) =>
            availableNames.includes(name),
          );
          return stillAvailable.length > 0 ? stillAvailable : availableNames;
        });
        if (
          availableModels.length > 0 &&
          !availableModels.some((model) => model.name === selectedModel)
        ) {
          setSelectedModel(availableModels[0].name);
        }
      } catch (err) {
        if (!active) return;
        const message =
          err instanceof Error ? err.message : "Failed to load models";
        setError(message);
      } finally {
        if (active) setModelsLoading(false);
      }
    }

    loadModels();

    return () => {
      active = false;
    };
  }, [selectedModel]);

  useEffect(() => {
    return () => {
      if (copiedTimeoutRef.current !== null) {
        window.clearTimeout(copiedTimeoutRef.current);
      }
    };
  }, []);

  useEffect(() => {
    let active = true;

    async function loadBenchmarkData() {
      try {
        const [questionsResponse, resultsResponse] = await Promise.all([
          fetch(`${BENCHMARKS_API_URL}/questions`),
          fetch(`${BENCHMARKS_API_URL}/results`),
        ]);

        if (!questionsResponse.ok) {
          throw new Error("Failed to load benchmark questions");
        }
        if (!resultsResponse.ok) {
          throw new Error("Failed to load benchmark results");
        }

        const questionsPayload = (await questionsResponse.json()) as {
          questions?: BenchmarkQuestion[];
        };
        const resultsPayload = (await resultsResponse.json()) as {
          results?: BenchmarkResult[];
        };

        if (!active) return;
        setBenchmarkQuestions(
          questionsPayload.questions?.length
            ? questionsPayload.questions
            : defaultBenchmarkQuestions,
        );
        setBenchmarkResults(resultsPayload.results ?? []);
      } catch (err) {
        console.error("Failed to load benchmark data", err);
        if (active) {
          setError("Using bundled benchmark defaults; database is unavailable");
        }
      }
    }

    void loadBenchmarkData();

    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!loading) {
      setThinkingStep(1);
      return;
    }

    const intervalId = window.setInterval(() => {
      setThinkingStep((current) => (current === 3 ? 1 : current + 1));
    }, 450);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [loading]);

  const appendAssistantText = (chunk: string) => {
    setMessages((prev) => {
      if (prev.length === 0) return prev;
      const next = [...prev];
      const last = next[next.length - 1];
      if (last.role === "assistant") {
        next[next.length - 1] = { ...last, text: last.text + chunk };
      }
      return next;
    });
  };

  const processStreamChunk = (chunk: string) => {
    const buffer = `${streamBufferRef.current}${chunk}`;
    const lines = buffer.split(/\r?\n/);
    streamBufferRef.current = lines.pop() ?? "";

    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const parsed = JSON.parse(line);
        console.debug("Parsed NDJSON line", parsed);
        if (typeof parsed.response === "string") {
          appendAssistantText(parsed.response);
        } else {
          appendAssistantText(line);
        }
      } catch (err) {
        console.debug("Failed to parse NDJSON line", line, err);
        appendAssistantText(line);
      }
    }
  };

  const submitPrompt = async (text: string, retryMessageId?: number) => {
    const trimmed = text.trim();
    if (!trimmed || loading) return;

    setError("");
    const userMessage =
      retryMessageId === undefined ? createMessage("user", trimmed) : null;
    const responseStartedAt = performance.now();
    const assistantMessage = createMessage("assistant", "", {
      model: selectedModel,
    });
    const userMessageId = retryMessageId ?? userMessage?.id;
    const assistantMessageId = assistantMessage.id;

    if (userMessageId === undefined) return;

    setMessages((prev) => {
      const next =
        userMessage !== null
          ? [...prev, userMessage]
          : prev.map((message) =>
              message.id === retryMessageId
                ? { ...message, status: undefined }
                : message,
            );

      return [...next, assistantMessage];
    });
    setLoading(true);

    const controller = new AbortController();
    abortControllerRef.current = controller;
    streamBufferRef.current = "";

    const payload = {
      model: selectedModel,
      prompt: trimmed,
      stream: true,
    };
    console.debug("Chat request", { API_URL, selectedModel, payload });

    try {
      const response = await fetch(API_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });
      console.debug("Chat response received", {
        status: response.status,
        statusText: response.statusText,
        ok: response.ok,
        url: response.url,
      });

      if (!response.ok) {
        const payload = await response.text();
        console.error("Chat request failed", {
          status: response.status,
          statusText: response.statusText,
          payload,
        });
        throw new Error(payload || `Server returned ${response.status}`);
      }

      if (!response.body) {
        throw new Error("No streaming response");
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let done = false;

      while (!done) {
        const { value, done: readerDone } = await reader.read();
        if (readerDone) {
          done = true;
          const remainder = streamBufferRef.current;
          if (remainder.trim()) {
            processStreamChunk("\n" + remainder);
            streamBufferRef.current = "";
          }
          break;
        }
        if (value) {
          processStreamChunk(decoder.decode(value, { stream: true }));
        }
      }

      const durationMs = Math.round(performance.now() - responseStartedAt);
      setMessages((prev) =>
        prev.map((item) =>
          item.id === assistantMessageId ? { ...item, durationMs } : item,
        ),
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : "Request failed";
      setError(message);
      setMessages((prev) => {
        let next = [...prev];
        const last = next[next.length - 1];
        if (last?.role === "assistant") {
          next = next.slice(0, -1);
        }
        return next.map((item) =>
          item.id === userMessageId ? { ...item, status: "error" } : item,
        );
      });
    } finally {
      setLoading(false);
      abortControllerRef.current = null;
    }
  };

  const sendPrompt = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const trimmed = prompt.trim();
    if (!trimmed || loading) return;

    void submitPrompt(trimmed);
    setPrompt("");
    if (promptRef.current) {
      promptRef.current.style.height = "auto";
    }
  };

  const retryPrompt = (message: ChatMessage) => {
    void submitPrompt(message.text, message.id);
  };

  const editPrompt = (message: ChatMessage) => {
    setPrompt(message.text);
    requestAnimationFrame(() => {
      if (!promptRef.current) return;
      resizePromptInput(promptRef.current);
      promptRef.current.focus();
    });
  };

  const copyMessage = async (message: ChatMessage) => {
    try {
      await navigator.clipboard.writeText(message.text);
      setCopiedMessageId(message.id);

      if (copiedTimeoutRef.current !== null) {
        window.clearTimeout(copiedTimeoutRef.current);
      }

      copiedTimeoutRef.current = window.setTimeout(() => {
        setCopiedMessageId(null);
        copiedTimeoutRef.current = null;
      }, 1600);
    } catch (err) {
      console.error("Failed to copy message", err);
      setError("Failed to copy message to clipboard");
    }
  };

  const formatDuration = (durationMs?: number) => {
    if (durationMs === undefined) return "";
    if (durationMs < 1000) return `${durationMs} ms`;
    return `${(durationMs / 1000).toFixed(2)} s`;
  };

  const stopStreaming = () => {
    abortControllerRef.current?.abort();
    abortControllerRef.current = null;
    setLoading(false);
  };

  const resizePromptInput = (element: HTMLTextAreaElement) => {
    element.style.height = "auto";
    element.style.height = `${element.scrollHeight}px`;
  };

  const handlePromptChange = (
    event: React.ChangeEvent<HTMLTextAreaElement>,
  ) => {
    setPrompt(event.target.value);
    resizePromptInput(event.target);
  };

  const handlePromptKeyDown = (
    event: React.KeyboardEvent<HTMLTextAreaElement>,
  ) => {
    if (event.key !== "Enter" || event.shiftKey) return;
    event.preventDefault();
    event.currentTarget.form?.requestSubmit();
  };

  const toggleBenchmarkModel = (modelName: string) => {
    setBenchmarkModelNames((current) =>
      current.includes(modelName)
        ? current.filter((name) => name !== modelName)
        : [...current, modelName],
    );
  };

  const updateBenchmarkQuestion = (
    id: string,
    updates: Partial<BenchmarkQuestion>,
  ) => {
    setBenchmarkQuestions((current) =>
      current.map((question) =>
        question.id === id ? { ...question, ...updates } : question,
      ),
    );
  };

  const addBenchmarkQuestion = () => {
    const id = `custom-${Date.now()}`;
    setBenchmarkQuestions((current) => [
      ...current,
      {
        id,
        title: "Custom question",
        prompt: "",
        enabled: true,
      },
    ]);
  };

  const saveBenchmarkQuestions = async () => {
    const response = await fetch(`${BENCHMARKS_API_URL}/questions`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        questions: benchmarkQuestions.map((question, index) => ({
          ...question,
          sortOrder: question.sortOrder ?? index,
        })),
      }),
    });

    if (!response.ok) {
      const message = await response.text();
      throw new Error(message || "Failed to save benchmark questions");
    }

    const payload = (await response.json()) as {
      questions?: BenchmarkQuestion[];
    };
    if (payload.questions) {
      setBenchmarkQuestions(payload.questions);
      return payload.questions;
    }
    return benchmarkQuestions;
  };

  const createBenchmarkRun = async () => {
    const response = await fetch(`${BENCHMARKS_API_URL}/runs`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });

    if (!response.ok) {
      const message = await response.text();
      throw new Error(message || "Failed to create benchmark run");
    }

    const payload = (await response.json()) as { run?: { id: string } };
    if (!payload.run?.id) {
      throw new Error("Benchmark run response did not include an id");
    }
    return payload.run.id;
  };

  const completeBenchmarkRun = async (
    runId: string,
    status: "complete" | "error",
  ) => {
    await fetch(`${BENCHMARKS_API_URL}/runs/${runId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    });
  };

  const saveBenchmarkResult = async (result: BenchmarkResult) => {
    const response = await fetch(`${BENCHMARKS_API_URL}/results`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(result),
    });

    if (!response.ok) {
      const message = await response.text();
      throw new Error(message || "Failed to save benchmark result");
    }

    const payload = (await response.json()) as { result?: BenchmarkResult };
    return payload.result ?? result;
  };

  const runSingleBenchmark = async (
    runId: string,
    modelName: string,
    question: BenchmarkQuestion,
  ): Promise<BenchmarkResult> => {
    const startedAt = performance.now();

    try {
      const response = await fetch(API_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: modelName,
          prompt: question.prompt,
          stream: false,
        }),
      });

      const text = await response.text();
      if (!response.ok) {
        throw new Error(text || `Server returned ${response.status}`);
      }

      const parsed = JSON.parse(text) as { response?: string };
      const responseText = parsed.response ?? text;
      return {
        id: `${modelName}-${question.id}-${startedAt}`,
        runId,
        model: modelName,
        questionId: question.id,
        questionTitle: question.title,
        durationMs: Math.round(performance.now() - startedAt),
        responseText,
        responseLength: responseText.length,
        status: "complete",
      };
    } catch (err) {
      return {
        id: `${modelName}-${question.id}-${startedAt}`,
        runId,
        model: modelName,
        questionId: question.id,
        questionTitle: question.title,
        durationMs: Math.round(performance.now() - startedAt),
        responseText: "",
        responseLength: 0,
        status: "error",
        error: err instanceof Error ? err.message : "Benchmark failed",
      };
    }
  };

  const runBenchmarks = async () => {
    const selectedQuestions = benchmarkQuestions.filter(
      (question) => question.enabled && question.prompt.trim(),
    );

    if (benchmarkModelNames.length === 0 || selectedQuestions.length === 0) {
      setError("Select at least one model and one benchmark question");
      return;
    }

    setError("");
    setBenchmarkRunning(true);
    let runId = "";
    let runHadError = false;

    const totalRuns = benchmarkModelNames.length * selectedQuestions.length;
    let completedRuns = 0;

    try {
      const savedQuestions = await saveBenchmarkQuestions();
      const questionsById = new Map(
        savedQuestions.map((question) => [question.id, question]),
      );
      const runnableQuestions = selectedQuestions.map(
        (question) => questionsById.get(question.id) ?? question,
      );
      runId = await createBenchmarkRun();
      setBenchmarkResults((current) =>
        current.filter((result) => result.runId !== runId),
      );

      for (const modelName of benchmarkModelNames) {
        for (const question of runnableQuestions) {
          setBenchmarkStatus(
            `Running ${modelName} on ${question.title} (${completedRuns + 1}/${totalRuns})`,
          );
          const result = await runSingleBenchmark(runId, modelName, question);
          if (result.status === "error") runHadError = true;
          const savedResult = await saveBenchmarkResult(result);
          completedRuns += 1;
          setBenchmarkResults((current) => [savedResult, ...current]);
        }
      }
      await completeBenchmarkRun(runId, runHadError ? "error" : "complete");
      setBenchmarkStatus(`Completed ${completedRuns}/${totalRuns} runs`);
    } catch (err) {
      if (runId) {
        await completeBenchmarkRun(runId, "error");
      }
      setError(err instanceof Error ? err.message : "Benchmark failed");
    } finally {
      setBenchmarkRunning(false);
    }
  };

  const averageDurationForModel = (modelName: string) => {
    const completed = benchmarkResults.filter(
      (result) => result.model === modelName && result.status === "complete",
    );
    if (completed.length === 0) return "";
    const total = completed.reduce((sum, result) => sum + result.durationMs, 0);
    return formatDuration(Math.round(total / completed.length));
  };

  const benchmarkResultModels = Array.from(
    new Set(benchmarkResults.map((result) => result.model)),
  );

  const benchmarkResultQuestions = Array.from(
    new Map(
      benchmarkResults.map((result) => [
        result.questionId,
        {
          id: result.questionId,
          title: result.questionTitle,
        },
      ]),
    ).values(),
  );

  const findBenchmarkResult = (questionId: string, model: string) =>
    benchmarkResults.find(
      (result) => result.questionId === questionId && result.model === model,
    );

  const escapeCsvCell = (value: string | number | null | undefined) => {
    const text = String(value ?? "");
    if (!/[",\r\n]/.test(text)) return text;
    return `"${text.replaceAll('"', '""')}"`;
  };

  const exportBenchmarkResults = () => {
    if (benchmarkResults.length === 0) return;

    const headers = ["Question", ...benchmarkResultModels];
    const rows = benchmarkResultQuestions.map((question) => [
      question.title,
      ...benchmarkResultModels.map((model) => {
        const result = findBenchmarkResult(question.id, model);
        if (!result) return "";
        const status =
          result.status === "error" ? `Error: ${result.error ?? "Error"}` : "Complete";
        return `${formatDuration(result.durationMs)} | ${result.responseLength} chars | ${status}`;
      }),
    ]);
    const csv = [headers, ...rows]
      .map((row) => row.map(escapeCsvCell).join(","))
      .join("\r\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");

    link.href = url;
    link.download = `benchmark-results-${timestamp}.csv`;
    document.body.append(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  };

  const renderChatTab = () => (
    <>
      <div className="chat-window">
        {messages.length === 0 ? (
          <div className="placeholder">Type a prompt below and press Send.</div>
        ) : (
          messages.map((message) => {
            const showResponseInfo =
              message.role === "assistant" && message.durationMs !== undefined;
            const showStreamingPlaceholder =
              message.role === "assistant" &&
              loading &&
              !message.text &&
              message.durationMs === undefined;
            const showCopyButton =
              message.text &&
              (message.role !== "assistant" || message.durationMs !== undefined);

            return (
              <div
                key={message.id}
                className={`message ${message.role === "user" ? "user" : "assistant"}${
                  message.status === "error" ? " errored" : ""
                }`}
              >
                <div className="message-role">
                  {message.role === "user" ? "You" : "Assistant"}
                </div>
                <pre>
                  {showStreamingPlaceholder
                    ? ".".repeat(thinkingStep)
                    : message.text}
                </pre>
                <div className="message-footer">
                  {showResponseInfo ? (
                    <div className="message-meta">
                      <span>{message.model ?? "Unknown"}</span>
                      <span>{formatDuration(message.durationMs)}</span>
                    </div>
                  ) : (
                    <span />
                  )}
                  <div className="message-actions">
                    {showCopyButton ? (
                      <button
                        type="button"
                        className={`message-icon-action${
                          copiedMessageId === message.id ? " copied" : ""
                        }`}
                        onClick={() => void copyMessage(message)}
                        aria-label={
                          copiedMessageId === message.id
                            ? "Message copied"
                            : "Copy message"
                        }
                        title={
                          copiedMessageId === message.id
                            ? "Copied"
                            : "Copy message"
                        }
                      >
                        <img src={copyIcon} alt="" aria-hidden="true" />
                      </button>
                    ) : null}
                    {message.status === "error" ? (
                      <>
                        <button
                          type="button"
                          className="message-action"
                          onClick={() => retryPrompt(message)}
                          disabled={loading}
                        >
                          Retry
                        </button>
                        <button
                          type="button"
                          className="message-action"
                          onClick={() => editPrompt(message)}
                          disabled={loading}
                        >
                          Edit
                        </button>
                      </>
                    ) : null}
                  </div>
                </div>
              </div>
            );
          })
        )}
        <div ref={messageEndRef} />
      </div>

      <form className="chat-form" onSubmit={sendPrompt}>
        <label htmlFor="prompt" className="sr-only">
          Prompt
        </label>
        <textarea
          id="prompt"
          ref={promptRef}
          value={prompt}
          onChange={handlePromptChange}
          onKeyDown={handlePromptKeyDown}
          placeholder="Ask a question or send a prompt..."
          rows={1}
          disabled={loading}
        />
        <div className="form-actions">
          <button type="submit" disabled={loading || !prompt.trim()}>
            {loading ? "Waiting..." : "Send"}
          </button>
          {loading && (
            <button type="button" className="secondary" onClick={stopStreaming}>
              Stop
            </button>
          )}
          {error ? <p className="error">{error}</p> : null}
        </div>
      </form>
    </>
  );

  const renderBenchmarksTab = () => (
    <div className="benchmark-view">
      <section className="benchmark-section">
        <div className="section-heading">
          <h2>Models</h2>
          <p>{benchmarkModelNames.length} selected</p>
        </div>
        <div className="model-checklist">
          {models.length === 0 ? (
            <p className="empty-note">
              {modelsLoading ? "Loading models..." : "No models found"}
            </p>
          ) : (
            models.map((model) => (
              <label key={model.name} className="check-row">
                <input
                  type="checkbox"
                  checked={benchmarkModelNames.includes(model.name)}
                  onChange={() => toggleBenchmarkModel(model.name)}
                  disabled={benchmarkRunning}
                />
                <span>
                  <strong>{model.name}</strong>
                  {model.details?.parameter_size ? (
                    <small>{model.details.parameter_size}</small>
                  ) : null}
                </span>
              </label>
            ))
          )}
        </div>
      </section>

      <section className="benchmark-section question-section">
        <div className="section-heading">
          <h2>Questions</h2>
          <button
            type="button"
            className="secondary"
            onClick={addBenchmarkQuestion}
            disabled={benchmarkRunning}
          >
            Add question
          </button>
        </div>
        <div className="question-list">
          {benchmarkQuestions.map((question) => (
            <article key={question.id} className="question-item">
              <label className="check-row compact">
                <input
                  type="checkbox"
                  checked={question.enabled}
                  onChange={(event) =>
                    updateBenchmarkQuestion(question.id, {
                      enabled: event.target.checked,
                    })
                  }
                  disabled={benchmarkRunning}
                />
                <span>Include</span>
              </label>
              <input
                className="question-title"
                value={question.title}
                onChange={(event) =>
                  updateBenchmarkQuestion(question.id, {
                    title: event.target.value,
                  })
                }
                disabled={benchmarkRunning}
              />
              <textarea
                value={question.prompt}
                onChange={(event) =>
                  updateBenchmarkQuestion(question.id, {
                    prompt: event.target.value,
                  })
                }
                disabled={benchmarkRunning}
                rows={3}
              />
            </article>
          ))}
        </div>
      </section>

      <section className="benchmark-section results-section">
        <div className="benchmark-actions">
          <button
            type="button"
            onClick={() => void runBenchmarks()}
            disabled={benchmarkRunning}
          >
            {benchmarkRunning ? "Running..." : "Run benchmarking"}
          </button>
          <button
            type="button"
            className="secondary"
            onClick={exportBenchmarkResults}
            disabled={benchmarkRunning || benchmarkResults.length === 0}
          >
            Export to Excel
          </button>
          {benchmarkStatus ? <p>{benchmarkStatus}</p> : null}
        </div>

        {benchmarkResults.length > 0 ? (
          <div className="results-grid">
            <table>
              <thead>
                <tr>
                  <th>Question</th>
                  {benchmarkResultModels.map((model) => (
                    <th key={model}>
                      <span>{model}</span>
                      {averageDurationForModel(model) ? (
                        <small>Avg {averageDurationForModel(model)}</small>
                      ) : null}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {benchmarkResultQuestions.map((question) => (
                  <tr key={question.id}>
                    <th scope="row">{question.title}</th>
                    {benchmarkResultModels.map((model) => {
                      const result = findBenchmarkResult(question.id, model);
                      return (
                        <td key={`${question.id}-${model}`}>
                          {result ? (
                            <div
                              className={`result-cell ${result.status === "error" ? "error-cell" : ""}`}
                            >
                              <strong>{formatDuration(result.durationMs)}</strong>
                              <span>{result.responseLength} chars</span>
                              {result.status === "error" ? (
                                <small>{result.error ?? "Error"}</small>
                              ) : null}
                            </div>
                          ) : (
                            <span className="empty-result">-</span>
                          )}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="empty-note">Run a benchmark to populate results.</p>
        )}
      </section>
    </div>
  );

  return (
    <main className="chat-app">
      <section className="chat-panel">
        <header className="chat-header">
          <div>
            <p className="eyebrow">AI Benchmarker</p>
            {loading
              ? "Streaming response..."
              : benchmarkRunning
                ? "Benchmarking..."
                : "Ready"}
          </div>
          <div className="header-controls">
            <div className="tab-list" role="tablist" aria-label="App views">
              <button
                type="button"
                className={activeTab === "chat" ? "active" : ""}
                onClick={() => setActiveTab("chat")}
              >
                Chat
              </button>
              <button
                type="button"
                className={activeTab === "benchmarks" ? "active" : ""}
                onClick={() => setActiveTab("benchmarks")}
              >
                Benchmarks
              </button>
            </div>
            <label className="model-picker">
              <span>Chat model</span>
              <select
                value={selectedModel}
                onChange={(event) => setSelectedModel(event.target.value)}
                disabled={loading || modelsLoading || models.length === 0}
              >
                {models.length === 0 ? (
                  <option value={selectedModel}>
                    {modelsLoading ? "Loading models..." : selectedModel}
                  </option>
                ) : (
                  models.map((model) => (
                    <option key={model.name} value={model.name}>
                      {model.name}
                    </option>
                  ))
                )}
              </select>
            </label>
          </div>
        </header>

        {activeTab === "chat" ? renderChatTab() : renderBenchmarksTab()}
      </section>
    </main>
  );
}

export default App;
