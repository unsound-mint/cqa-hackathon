import { addUsage, emptyUsage, ProviderError, type LlmProvider, type ProviderRequest, type ProviderResponse } from './provider.js';

export type Effort = 'low' | 'medium' | 'high' | 'xhigh' | 'max';
export const EFFORTS: readonly Effort[] = ['low', 'medium', 'high', 'xhigh', 'max'];

export type AnthropicOptions = {
  apiKey: string;
  model: string;
  /** Thinking depth. Haiku 5.5 defaults to 'medium' when omitted; we send it explicitly so runs are comparable. */
  effort?: Effort;
  baseUrl?: string;
  timeoutMs?: number;
  /** Retries for 429/5xx/network errors. */
  retries?: number;
  retryDelayMs?: number;
  fetch?: typeof fetch;
};

type Body = {
  content?: { type: string; input?: unknown }[];
  stop_reason?: string;
  stop_details?: { category?: string | null } | null;
  usage?: { input_tokens: number; output_tokens: number; cache_read_input_tokens?: number; cache_creation_input_tokens?: number };
};

/**
 * Messages API with a tool whose input is the answer. Request shape follows the current model docs:
 * - no `temperature`/`top_p`/`top_k`: Haiku 5.5 rejects non-default values with a 400, and API version 2026-10-21 rejects any;
 * - `tool_choice: auto` plus a prompt instruction, because a forced tool call makes Haiku 5.5 skip thinking;
 * - explicit `output_config.effort`, and a `max_tokens` large enough to hold thinking plus the answer;
 * - the stable system prompt is cache-marked (it silently does nothing below the model's minimum prefix size).
 * - strict tool input grammar; the evaluator supplies a closed, request-specific schema.
 * No SDK dependency; the stop reason is checked, so a truncated or refused answer is a clear error, not bad JSON.
 */
export class AnthropicProvider implements LlmProvider {
  readonly name = 'anthropic';
  readonly model: string;
  readonly effort: Effort;
  constructor(private readonly o: AnthropicOptions) {
    this.model = o.model;
    this.effort = o.effort ?? 'medium';
  }

  async complete(req: ProviderRequest): Promise<ProviderResponse> {
    const doFetch = this.o.fetch ?? fetch;
    const retries = this.o.retries ?? 3;
    const started = Date.now();
    let lastStatus = 0;
    const usage = emptyUsage();
    // A reply without the tool call is also retried once: with `auto` the model may answer in prose.
    let missingTool = 0;
    for (let attempt = 0; attempt <= retries; attempt++) {
      if (attempt > 0) await new Promise((r) => setTimeout(r, (this.o.retryDelayMs ?? 1000) * 2 ** (attempt - 1)));
      try {
        const res = await doFetch(`${this.o.baseUrl ?? 'https://api.anthropic.com'}/v1/messages`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-api-key': this.o.apiKey, 'anthropic-version': '2023-06-01' },
          body: JSON.stringify({
            model: this.o.model,
            max_tokens: 16000,
            output_config: { effort: this.effort },
            system: [{ type: 'text', text: req.system, cache_control: { type: 'ephemeral' } }],
            messages: [{ role: 'user', content: req.user }],
            tools: [{ name: 'submit_evaluation', strict: true, description: 'Submit the structured evaluation. Call this exactly once, as your final action.', input_schema: req.outputSchema }],
            tool_choice: { type: 'auto' },
          }),
          signal: req.signal ?? AbortSignal.timeout(this.o.timeoutMs ?? 120_000),
        });
        lastStatus = res.status;
        if (res.ok) {
          const body = (await res.json()) as Body;
          const u = body.usage;
          addUsage(usage, u ? { inputTokens: u.input_tokens, outputTokens: u.output_tokens, cacheReadTokens: u.cache_read_input_tokens, cacheWriteTokens: u.cache_creation_input_tokens } : undefined);
          if (body.stop_reason === 'refusal') throw new ProviderError(`model refused (${body.stop_details?.category ?? 'no category'})`, usage, false);
          if (body.stop_reason === 'max_tokens') throw new ProviderError('model output was cut off at max_tokens', usage);
          const tool = body.content?.find((c) => c.type === 'tool_use');
          if (!tool) {
            if (++missingTool > 1) throw new ProviderError('model returned no tool call', usage);
            continue;
          }
          return {
            output: tool.input,
            usage,
            latencyMs: Date.now() - started,
          };
        }
        if (res.status < 500 && res.status !== 429) break;
      } catch (e) {
        if (e instanceof ProviderError) throw e;
        lastStatus = 0; // network/timeout: retry; details dropped on purpose
      }
    }
    throw new ProviderError(`provider request failed (status ${lastStatus || 'network error'})`, usage, lastStatus === 0 || lastStatus === 429 || lastStatus >= 500);
  }
}
