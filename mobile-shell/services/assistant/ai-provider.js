// Provider port of the assistant Service (epic #44). The routerai.ru adapter
// speaks the OpenAI-compatible API; until #31 the key comes from Profile with
// each request (ui/ai-key.js keeps it on the device). The mock adapter answers
// tests. The key never appears in error texts.

// The models the assistant can run on. The model changes only here, never in
// the UI. Haiku takes no sampling parameters; its system prompt and tools are
// cached. GLM stays as the fallback.
export const AI_MODELS = Object.freeze({
  haiku: Object.freeze({ model: "anthropic/claude-haiku-5.5", reasoningEffort: "low", temperature: null, promptCache: true }),
  glm: Object.freeze({ model: "z-ai/glm-5.3-flash", reasoningEffort: "low", temperature: 0.2, promptCache: false }),
});

export const AI_PROVIDER_CONFIG = Object.freeze({
  baseUrl: "https://routerai.ru",
  ...AI_MODELS.haiku,
  maxTokens: 16000,
  timeoutMs: 120_000,
  retries: 2,
  retryDelayMs: 1500,
});

export const AI_PROVIDER_NAME = "routerai.ru";

export const AI_ERROR_TEXTS = {
  no_key: "Ключ ИИ не задан. Добавьте его в Профиле.",
  auth: "Ключ не подошёл: провайдер его не принял.",
  payment: "На балансе ключа не хватает средств.",
  rate: "Слишком много запросов к ИИ. Попробуйте через минуту.",
  server: "Сервис ИИ временно недоступен. Попробуйте позже.",
  timeout: "ИИ не ответил за 2 минуты. Попробуйте ещё раз.",
  network: "Нет соединения с сервисом ИИ. Проверьте интернет.",
  bad_response: "Сервис ИИ вернул непонятный ответ.",
  request: "Сервис ИИ отклонил запрос.",
};

export class AiError extends Error {
  constructor(kind, status = 0) {
    super(AI_ERROR_TEXTS[kind] || AI_ERROR_TEXTS.request);
    this.name = "AiError";
    this.kind = kind;
    this.status = status;
  }
}

// A transport performs one HTTP request: ({ method, url, headers, body,
// timeoutMs, signal }) → { status, text }. It throws an error with `kind`
// "network" or "timeout" when the request did not reach the provider.
// `fetchImpl` is the platform fetch.
export function fetchTransport(fetchImpl) {
  return async ({ method, url, headers, body, signal }) => {
    let response;
    try {
      response = await fetchImpl(url, { method, headers, body, signal });
    } catch (error) {
      if (signal?.aborted) throw new AiError("timeout");
      throw new AiError("network");
    }
    return { status: response.status, text: await response.text().catch(() => "") };
  };
}

export function createRouterAiProvider({
  getKey,
  transport,
  config = AI_PROVIDER_CONFIG,
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
} = {}) {
  const settings = { ...AI_PROVIDER_CONFIG, ...config };

  async function send(method, path, payload) {
    const key = String(getKey?.() || "").trim();
    if (!key) throw new AiError("no_key");
    const body = payload ? JSON.stringify(payload) : undefined;
    let attempt = 0;
    for (;;) {
      let response;
      try {
        response = await withTimeout(settings.timeoutMs, (signal) => transport({
          method,
          url: `${settings.baseUrl}${path}`,
          headers: {
            Authorization: `Bearer ${key}`,
            "Content-Type": "application/json",
            Accept: "application/json",
          },
          body,
          timeoutMs: settings.timeoutMs,
          signal,
        }));
      } catch (error) {
        const kind = typeof error?.kind === "string" && AI_ERROR_TEXTS[error.kind] ? error.kind : "network";
        if (kind === "network" && attempt < settings.retries) {
          attempt += 1;
          await sleep(settings.retryDelayMs * attempt);
          continue;
        }
        throw new AiError(kind);
      }
      // routerai.ru sometimes answers an empty 503 after ~10 s: retry 5xx.
      if (response.status >= 500 && attempt < settings.retries) {
        attempt += 1;
        await sleep(settings.retryDelayMs * attempt);
        continue;
      }
      if (response.status < 200 || response.status >= 300) throw new AiError(statusKind(response.status), response.status);
      try {
        return JSON.parse(response.text);
      } catch {
        throw new AiError("bad_response", response.status);
      }
    }
  }

  return {
    name: AI_PROVIDER_NAME,
    model: settings.model,
    hasKey: () => Boolean(String(getKey?.() || "").trim()),

    // GET /api/v1/key: a cheap call that only proves the key works.
    async checkKey() {
      try {
        const body = await send("GET", "/api/v1/key");
        const data = body?.data || {};
        return { ok: true, label: String(data.label || ""), usage: finiteOrNull(data.usage), limit: finiteOrNull(data.limit) };
      } catch (error) {
        return failure(error);
      }
    },

    // One chat completion. Returns the assistant message, possibly with tool calls.
    async complete({ messages, tools, responseFormat } = {}) {
      try {
        const payload = {
          model: settings.model,
          messages: settings.promptCache ? cacheSystemPrompt(messages) : messages,
          max_tokens: settings.maxTokens,
          reasoning: { effort: settings.reasoningEffort },
        };
        if (settings.temperature != null) payload.temperature = settings.temperature;
        if (tools?.length) {
          payload.tools = tools;
          payload.tool_choice = "auto";
        }
        if (responseFormat) payload.response_format = responseFormat;
        const body = await send("POST", "/api/v1/chat/completions", payload);
        const message = body?.choices?.[0]?.message;
        if (!message || typeof message !== "object") throw new AiError("bad_response");
        return { ok: true, message, usage: body.usage || null };
      } catch (error) {
        return failure(error);
      }
    },
  };
}

// The mock adapter for tests: `respond(request)` returns an assistant message
// (or { status } / throws AiError) for each completion; requests are recorded.
export function createMockProvider(respond, { hasKey = true, usage = () => null } = {}) {
  const requests = [];
  return {
    name: "mock",
    model: "mock",
    requests,
    hasKey: () => hasKey,
    async checkKey() {
      return hasKey ? { ok: true, label: "mock" } : failure(new AiError("no_key"));
    },
    async complete(request = {}) {
      requests.push(structuredClone(request));
      if (!hasKey) return failure(new AiError("no_key"));
      try {
        const message = await respond(request, requests.length - 1);
        if (message instanceof AiError) return failure(message);
        return { ok: true, message: typeof message === "string" ? { role: "assistant", content: message } : message, usage: usage(request, requests.length - 1) };
      } catch (error) {
        return failure(error);
      }
    },
  };
}

// The tools and the system prompt open every request of a thread (the
// provider puts the tools first): one breakpoint after the system prompt
// caches both.
function cacheSystemPrompt(messages) {
  const [first, ...rest] = messages || [];
  if (first?.role !== "system" || typeof first.content !== "string") return messages;
  return [{ role: "system", content: [{ type: "text", text: first.content, cache_control: { type: "ephemeral" } }] }, ...rest];
}

function failure(error) {
  const kind = error instanceof AiError ? error.kind : "network";
  return { ok: false, kind, status: error?.status || 0, reason: AI_ERROR_TEXTS[kind] || AI_ERROR_TEXTS.request };
}

function statusKind(status) {
  if (status === 401 || status === 403) return "auth";
  if (status === 402) return "payment";
  if (status === 429) return "rate";
  if (status >= 500) return "server";
  return "request";
}

async function withTimeout(ms, run) {
  const controller = typeof AbortController === "function" ? new AbortController() : null;
  let timer = null;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      controller?.abort();
      reject(new AiError("timeout"));
    }, ms);
  });
  try {
    return await Promise.race([run(controller?.signal), timeout]);
  } finally {
    clearTimeout(timer);
  }
}

function finiteOrNull(value) {
  const number = Number(value);
  return value == null || value === "" || !Number.isFinite(number) ? null : number;
}
