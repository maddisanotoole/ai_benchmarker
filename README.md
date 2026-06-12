# AI Benchmarker

A local AI chat and benchmarking app for Ollama models.

The project has two parts:

- `client/` - React + Vite web app with Chat and Benchmarks tabs.
- `server/` - Fastify API that proxies Ollama requests and stores benchmark runs in SQLite.

## Prerequisites

- Node.js and npm
- Ollama running locally
- At least one Ollama model installed

## Install Ollama

Download the installer from <https://ollama.com/download>.

Windows PowerShell:

```powershell
irm https://ollama.com/install.ps1 | iex
```

macOS/Linux:

```sh
curl -fsSL https://ollama.com/install.sh | sh
```

## Install Models

Browse available models at <https://ollama.com/library>.

Examples:

```sh
ollama pull llama3.2:1b
ollama pull llama3.2:3b
ollama pull gemma3:4b
ollama pull mistral:7b
ollama pull llama3.1:8b
ollama pull qwen2.5-coder:7b
ollama pull mistral-nemo:12b
ollama pull phi4:14b
ollama pull gemma3:27b
```

Check installed models:

```sh
ollama list
```

## Setup

Install dependencies for the client and server:

```sh
npm run setup
```

## Run Locally

Start the API server:

```sh
npm run server
```

In a second terminal, start the client:

```sh
npm run client
```

Open the Vite URL shown in the client terminal, usually <http://localhost:5173>.

The server listens on <http://localhost:8000> by default and expects Ollama at <http://localhost:11434>.

## Features

- Chat with any locally installed Ollama model.
- Stream model responses through the Fastify proxy.
- Select models for benchmark runs.
- Add, edit, enable, and disable benchmark questions.
- Save benchmark runs and results to SQLite.
- Export benchmark results as CSV for Excel.

## Configuration

Server environment variables:

| Variable | Default | Description |
| --- | --- | --- |
| `PORT` | `8000` | Fastify API port |
| `CLIENT_ORIGIN` | `http://localhost:5173` | Allowed CORS origin |
| `OLLAMA_URL` | `http://localhost:11434` | Ollama API base URL |
| `OLLAMA_TIMEOUT_MS` | `60000` | Upstream Ollama request timeout |

Client environment variables:

| Variable | Default | Description |
| --- | --- | --- |
| `VITE_API_BASE_URL` | `http://localhost:8000/api/ollama` | Ollama proxy base URL |
| `VITE_API_URL` | `http://localhost:8000/api/ollama/generate` | Generate endpoint |
| `VITE_MODELS_API_URL` | `http://localhost:8000/api/ollama/models` | Models endpoint |

## Data

Benchmark data is stored by the server in:

```text
server/data/benchmarks.sqlite
```

On first run, benchmark questions are seeded from:

```text
server/benchmarkQuestions.json
```

The client also bundles `client/benchmarkQuestions.json` as a fallback when the API data is unavailable.

## Scripts

From the repo root:

| Command | Description |
| --- | --- |
| `npm run setup` | Install client and server dependencies |
| `npm run client` | Start the Vite client |
| `npm run server` | Start the Fastify server in TypeScript dev mode |
| `npm run dev` | Alias for the client dev server |
| `npm run build` | Build client and server |
| `npm run start:server` | Start the compiled server |

## Resources

- [Ollama model library](https://ollama.com/library)
- [Using Ollama with TypeScript: A Simple Guide](https://medium.com/@jonigl/using-ollama-with-typescript-a-simple-guide-20f5e8d3827c)
