import { HttpCqaApi } from './HttpCqaApi';
import { richDemo, richDemoAppeals } from './demoExtras';
import { MockCqaApi } from './MockCqaApi';
import type { CqaApi } from './CqaApi';

export * from './CqaApi';
export { HttpCqaApi } from './HttpCqaApi';
export { MockCqaApi } from './MockCqaApi';

/** Single place that picks the implementation. Development defaults to mock; production defaults to HTTP. VITE_API_MODE overrides either.; components never change. */
export function createApi(): CqaApi {
  const mode = import.meta.env.VITE_API_MODE || (import.meta.env.PROD ? 'http' : 'mock');
  if (mode === 'mock') return new MockCqaApi(richDemo(), richDemoAppeals());
  if (mode === 'http') return new HttpCqaApi();
  throw new Error(`VITE_API_MODE=${mode}: unknown mode. Use 'mock' or 'http'.`);
}
