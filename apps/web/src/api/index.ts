import { HttpCqaApi } from './HttpCqaApi';
import { richDemo } from './demoExtras';
import { MockCqaApi } from './MockCqaApi';
import type { CqaApi } from './CqaApi';

export * from './CqaApi';
export { HttpCqaApi } from './HttpCqaApi';
export { MockCqaApi } from './MockCqaApi';

/** Single place that picks the implementation. VITE_API_MODE=mock (default) | http; components never change. */
export function createApi(): CqaApi {
  const mode = import.meta.env.VITE_API_MODE ?? 'mock';
  if (mode === 'mock') return new MockCqaApi(richDemo());
  if (mode === 'http') return new HttpCqaApi();
  throw new Error(`VITE_API_MODE=${mode}: unknown mode. Use 'mock' or 'http'.`);
}
