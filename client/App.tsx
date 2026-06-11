import { useEffect, useRef, useState } from "react";
import "./App.css";

type ChatMessage = {
  role: "user" | "assistant";
  text: string;
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

const API_BASE_URL =
  import.meta.env.VITE_API_BASE_URL ?? "http://localhost:8000/api/ollama";
const API_URL = import.meta.env.VITE_API_URL ?? `${API_BASE_URL}/generate`;
const MODELS_API_URL =
  import.meta.env.VITE_MODELS_API_URL ?? `${API_BASE_URL}/models`;
const DEFAULT_MODEL_NAME = import.meta.env.VITE_OLLAMA_MODEL ?? "llama2";

function App() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [models, setModels] = useState<OllamaModel[]>([]);
  const [selectedModel, setSelectedModel] = useState(DEFAULT_MODEL_NAME);
  const [modelsLoading, setModelsLoading] = useState(true);
  const [prompt, setPrompt] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const messageEndRef = useRef<HTMLDivElement | null>(null);
  const promptRef = useRef<HTMLTextAreaElement | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const streamBufferRef = useRef("");

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

  const sendPrompt = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const trimmed = prompt.trim();
    if (!trimmed || loading) return;

    setError("");
    setMessages((prev) => [
      ...prev,
      { role: "user", text: trimmed },
      { role: "assistant", text: "" },
    ]);
    setPrompt("");
    if (promptRef.current) {
      promptRef.current.style.height = "auto";
    }
    setLoading(true);

    const controller = new AbortController();
    abortControllerRef.current = controller;

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
    } catch (err) {
      const message = err instanceof Error ? err.message : "Request failed";
      setError(message);
      setMessages((prev) => {
        const next = [...prev];
        const last = next[next.length - 1];
        if (last && last.role === "assistant") {
          last.text += "\n\n[Error] " + message;
        }
        return next;
      });
    } finally {
      setLoading(false);
      abortControllerRef.current = null;
    }
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

  return (
    <main className="chat-app">
      <section className="chat-panel">
        <header className="chat-header">
          <div>
            <p className="eyebrow">AI Chat</p>
            <h1>Send prompts and stream answers</h1>
          </div>
          <div className="status">
            {loading ? "Streaming response..." : "Ready to chat"}{" "}
            <label className="model-picker">
              <span>Model</span>
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

        <div className="chat-window">
          {messages.length === 0 ? (
            <div className="placeholder">
              Type a prompt below and press Send.
            </div>
          ) : (
            messages.map((message, index) => (
              <div
                key={index}
                className={`message ${message.role === "user" ? "user" : "assistant"}`}
              >
                <div className="message-role">
                  {message.role === "user" ? "You" : "Assistant"}
                </div>
                <pre>{message.text}</pre>
              </div>
            ))
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
              {loading ? "Waiting…" : "Send"}
            </button>
            {loading && (
              <button
                type="button"
                className="secondary"
                onClick={stopStreaming}
              >
                Stop
              </button>
            )}
          </div>
          {error ? <p className="error">{error}</p> : null}
        </form>
      </section>
    </main>
  );
}

export default App;
