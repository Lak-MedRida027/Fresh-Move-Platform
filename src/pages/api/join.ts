import type { APIRoute } from 'astro';
import { createJoinHandler, createRateLimiter } from '../../lib/join-handler';

// The only on-demand route: runs as a Vercel serverless function.
export const prerender = false;

const handle = createJoinHandler({
  // Server-only secrets, read at request time. Never imported by client code.
  config: () => ({
    webhookUrl: process.env.SHEETS_WEBHOOK_URL,
    webhookSecret: process.env.SHEETS_WEBHOOK_SECRET,
  }),
  fetch: (...args) => fetch(...args),
  now: () => Date.now(),
  rateLimiter: createRateLimiter(5, 10 * 60 * 1000),
  log: (message, detail) => console.warn(message, detail ?? ''),
});

export const POST: APIRoute = ({ request, clientAddress }) => handle(request, clientAddress);

// Any other method → 405 with an Allow header.
export const ALL: APIRoute = ({ request }) => handle(request);
