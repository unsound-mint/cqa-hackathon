import { ProviderError, type LlmProvider, type ProviderRequest, type ProviderResponse } from './provider.js';

export type AnthropicOptions = {
  apiKey: string;
  model: string;
  baseUrl?: string;
  timeoutMs?: number;
  /** Retries for 429/5xx/network errors. */
  retries?: number;
  retryDelayMs?: number;
  fetch?: typeof fetch;
};

/** Messages API with a forced tool call, which yields schema-shaped JSON. No SDK dependency. */
export class AnthropicProvider implements LlmProvider {
  readonly name = 'anthropic';
  readonly model: string;
  constructor(private readonly o: AnthropicOptions) {
    this.model = o.model;
  }

  async complete(req: ProviderRequest): Promise<ProviderResponse> {
    const doFetch = this.o.fetch ?? fetch;
    const retries = this.o.retries ?? 3;
    let lastStatus = 0;
    for (let attempt = 0; attempt <= retries; attempt++) {
      if (attempt > 0) await new Promise((r) => setTimeout(r, (this.o.retryDelayMs ?? 1000) * 2 ** (attempt - 1)));
      try {
        const res = await doFetch(`${this.o.baseUrl ?? 'https://api.anthropic.com'}/v1/messages`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-api-key': this.o.apiKey, 'anthropic-version': '2023-06-01' },
          body: JSON.stringify({
            model: this.o.model,
            max_tokens: 8000,
            temperature: 0,
            system: req.system,
            messages: [{ role: 'user', content: req.user }],
            tools: [{ name: 'submit_evaluation', description: 'Submit the structured evaluation.', input_schema: req.outputSchema }],
            tool_choice: { type: 'tool', name: 'submit_evaluation' },
          }),
          signal: req.signal ?? AbortSignal.timeout(this.o.timeoutMs ?? 120_000),
        });
        lastStatus = res.status;
        if (res.ok) {
          const body = (await res.json()) as { content?: { type: string; input?: unknown }[]; usage?: { input_tokens: number; output_tokens: number } };
          const tool = body.content?.find((c) => c.type === 'tool_use');
          if (!tool) throw new ProviderError('model returned no tool call');
          return { output: tool.input, usage: body.usage ? { inputTokens: body.usage.input_tokens, outputTokens: body.usage.output_tokens } : undefined };
        }
        if (res.status < 500 && res.status !== 429) break;
      } catch (e) {
        if (e instanceof ProviderError) throw e;
        lastStatus = 0; // network/timeout: retry; details dropped on purpose
      }
    }
    throw new ProviderError(`provider request failed (status ${lastStatus || 'network error'})`);
  }
}
