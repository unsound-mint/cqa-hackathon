/** Provider-neutral structured-output call. One adapter per vendor; the evaluator never sees vendor types. */
export type ProviderRequest = {
  system: string;
  /** Inert data payload (JSON text). Never instructions. */
  user: string;
  /** JSON Schema of the object the model must return. */
  outputSchema: Record<string, unknown>;
  signal?: AbortSignal;
};

export type ProviderResponse = {
  /** Parsed JSON object produced by the model; still untrusted until validated. */
  output: unknown;
  usage?: { inputTokens: number; outputTokens: number; cacheReadTokens?: number; cacheWriteTokens?: number };
  /** Wall-clock time of the successful request including retries. */
  latencyMs?: number;
};

export interface LlmProvider {
  readonly name: string;
  readonly model: string;
  /** Effort setting, recorded in provenance when the provider has one. */
  readonly effort?: string;
  complete(req: ProviderRequest): Promise<ProviderResponse>;
}

export type Usage = NonNullable<ProviderResponse['usage']>;
export const emptyUsage = () => ({ inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 });
export function addUsage(target: ReturnType<typeof emptyUsage>, usage?: Usage) {
  if (!usage) return;
  target.inputTokens += usage.inputTokens;
  target.outputTokens += usage.outputTokens;
  target.cacheReadTokens += usage.cacheReadTokens ?? 0;
  target.cacheWriteTokens += usage.cacheWriteTokens ?? 0;
}
export class ProviderError extends Error {
  constructor(message: string, public readonly usage?: Usage, public readonly retryable = true) { super(message); }
}
