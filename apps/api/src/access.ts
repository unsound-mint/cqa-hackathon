import { timingSafeEqual } from 'node:crypto';
import type { FastifyReply, FastifyRequest } from 'fastify';

const COOKIE = 'cqa_token';
const safeEqual = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

function cookieToken(header: string | undefined): string | undefined {
  for (const part of (header ?? '').split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === COOKIE) return decodeURIComponent(v.join('='));
  }
  return undefined;
}

/**
 * Optional shared key for running the app on a local network (HOST=0.0.0.0) so another person can use the
 * labeling page. Open the link with ?token=KEY once; the browser then keeps a cookie. /health stays open.
 * Not user authentication: there are no identities, only "knows the key".
 */
export function accessGuard(token: string) {
  return async (req: FastifyRequest, reply: FastifyReply) => {
    const url = new URL(req.url, 'http://local');
    if (url.pathname === '/health') return;
    const given = url.searchParams.get('token');
    if (given !== null && safeEqual(given, token)) {
      url.searchParams.delete('token');
      return reply.header('set-cookie', `${COOKIE}=${encodeURIComponent(token)}; HttpOnly; SameSite=Lax; Path=/`).redirect(url.pathname + url.search);
    }
    const cookie = cookieToken(req.headers.cookie);
    if (cookie !== undefined && safeEqual(cookie, token)) return;
    return reply.code(401).type('text/html; charset=utf-8').send('<!doctype html><meta charset="utf-8"><p>Нужен ключ доступа. Откройте ссылку, которую вам прислали (с <code>?token=…</code>).</p>');
  };
}
