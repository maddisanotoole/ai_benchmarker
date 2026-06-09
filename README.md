# Overview

# Setup your local env

## 1. Install Ollama on your device

Can get installer at https://ollama.com/download/windows

OR:

For Windows, in powershell:

```powershell
irm https://ollama.com/install.ps1 | iex
```

For Mac, in terminal:

```sh
curl -fsSL https://ollama.com/install.sh | sh
```

## 2. Install models

Available models: https://ollama.com/library

Install desired models

e.g :

```sh
ollama pull llama3.2:1b
```

See installed models with:

```sh
ollama list
```

## 3. Setup repo

In repo:

```bash
npm install
```

# Resources:

More info on self hosting ai models

- [Using Ollama with TypeScript: A Simple Guide](https://medium.com/@jonigl/using-ollama-with-typescript-a-simple-guide-20f5e8d3827c)
