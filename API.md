# The local API

Draggy can serve an OpenAI-compatible API on your computer. Most tools that let you change the OpenAI base URL will then run on your local models instead (Codex, Claude Code, Continue, Cline, Open WebUI, Zed, a lot of Obsidian plugins, your own scripts). Tools that only speak Ollama work too.

It only listens on `127.0.0.1` and it needs a key. Nothing leaves your computer unless the request goes to a cloud provider you added yourself.

## Turning it on

- Open Settings, then API
- Tick "Serve an OpenAI-compatible API on this computer"
- Copy the base URL and the key

The base URL is `http://127.0.0.1:11500/v1` unless you changed the port. Send the key as `Authorization: Bearer <key>` (Anthropic-style clients can send it as `x-api-key` instead).

To check it works:

```bash
curl http://127.0.0.1:11500/v1/chat/completions \
  -H "Authorization: Bearer YOUR_KEY" \
  -H "Content-Type: application/json" \
  -d '{"model": "YOUR_MODEL", "messages": [{"role": "user", "content": "Hello"}]}'
```

`GET /v1/models` lists the model ids you can use.

## Agent or model

Draggy can answer in two ways:

- Agent: the full Draggy agent, with web search and page reading, same as in the app
- Model only: the request goes straight to the model and the client handles everything else

You pick the default under "Answer API requests with". A few requests skip that setting. Asking for the model `draggy-agent` always gets the agent. A request with `tools`, `response_format` or images always goes to the model, since the client wants to handle those itself.

Coding tools (Codex, Cline, Claude Code and so on) send their own tools, so they always end up on the model. You don't need to change anything for them.

## Endpoints

- `POST /v1/chat/completions` (streaming, tools, JSON mode, images)
- `POST /v1/completions`
- `POST /v1/embeddings`
- `POST /v1/responses`, plus `GET` and `DELETE /v1/responses/{id}` (the OpenAI Responses API, which Codex uses)
- `POST /v1/messages` and `POST /v1/messages/count_tokens` (the Anthropic Messages API, which Claude Code uses)
- `GET /v1/models` and `GET /v1/models/{id}`
- The Ollama routes under `/api` (`chat`, `generate`, `embed`, `tags`, `show` and so on)

Stored responses (`previous_response_id`) are kept in memory until Draggy closes. The built-in web search tool in both the OpenAI and Anthropic formats runs through Draggy's own search, so it works with local models too. Reasoning comes back as thinking blocks or reasoning items when "Send reasoning" is on.

## Settings

Everything lives in Settings, then API. Most of it you can leave alone. The ones I'd look at first:

- Default model, used when a client asks for a model you don't have
- Aliases, for tools that insist on a model name (map it to one of yours)
- List cloud models, so models from providers you added show up in `/v1/models`
- Default sampling (temperature, top p, top k and so on), and whether those override what the client sends
- Extra llama-server arguments

Note: extra llama-server arguments apply the next time a model loads, not right away. Arguments Draggy already manages (the port, the model path and a few others) get refused.

The rest is limits (parallel requests, queue wait, timeout, max body size), a system prompt added to every request, and whether reasoning text gets sent back to the client.

Under Access you can allow browser origins (for web apps and plugins that call the API from a page) and let the Ollama routes work without the key.

The request log at the bottom shows the last requests with their model, status, time and tokens. It never keeps prompts or replies. "Copy as curl" on a row gives you the same request to run yourself.

## Setting up tools

In all of these, replace `YOUR_KEY` and `YOUR_MODEL` with your own. Model ids come from `/v1/models`.

### Codex CLI

In `~/.codex/config.toml`:

```toml
model = "YOUR_MODEL"
model_provider = "draggy"

[model_providers.draggy]
name = "Draggy"
base_url = "http://127.0.0.1:11500/v1"
env_key = "DRAGGY_API_KEY"
wire_api = "responses"
```

Set `DRAGGY_API_KEY` to your key, then run `codex`.

### Claude Code

```bash
export ANTHROPIC_BASE_URL=http://127.0.0.1:11500
export ANTHROPIC_API_KEY=YOUR_KEY
claude
```

Claude Code asks for Claude models by name. Draggy doesn't have those, so it answers with your default model. If you want a specific one, add an alias from the Claude model name to your model.

### Continue

In `~/.continue/config.yaml`:

```yaml
models:
  - name: Draggy
    provider: openai
    model: YOUR_MODEL
    apiBase: http://127.0.0.1:11500/v1
    apiKey: YOUR_KEY
```

### Cline

Pick "OpenAI Compatible" as the API provider, then fill in:

- Base URL: `http://127.0.0.1:11500/v1`
- API key: your key
- Model ID: your model

### Open WebUI

In Admin settings, then Connections, add an OpenAI API connection with `http://127.0.0.1:11500/v1` and your key. Your models show up in the model picker after that.

### Zed

In Zed's `settings.json`:

```json
{
  "language_models": {
    "openai_compatible": {
      "Draggy": {
        "api_url": "http://127.0.0.1:11500/v1",
        "available_models": [{ "name": "YOUR_MODEL", "max_tokens": 32768 }]
      }
    }
  }
}
```

Zed asks for the key in the agent panel settings.

### Obsidian

Most AI plugins (Copilot, Smart Connections, Text Generator) have an "OpenAI compatible" or custom provider option. Use `http://127.0.0.1:11500/v1` and your key.

Note: Obsidian plugins run inside a web page, so the request comes with an origin. Add `app://obsidian.md` to the allowed origins in Draggy's API settings or it gets blocked.

### Tools that use Ollama

Point them at `http://127.0.0.1:11500` instead of `http://localhost:11434`. Most Ollama tools don't send a key, so turn on "Allow Ollama routes without the key" under Access.

### Anything else

If the tool lets you set an OpenAI base URL, it should work. Use `http://127.0.0.1:11500/v1`, your key and a model id from `/v1/models`. If it doesn't, open an issue and say which tool it was.

