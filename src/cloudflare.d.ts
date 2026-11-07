/**
 * The few Cloudflare runtime types the server code uses. We generate only the
 * Env bindings (`wrangler types --include-runtime=false`), because the full
 * Workers runtime types replace DOM types and break the browser scripts.
 */
interface RateLimit {
  limit(options: { key: string }): Promise<{ success: boolean }>;
}

interface ScheduledController {
  readonly scheduledTime: number;
  readonly cron: string;
  noRetry(): void;
}

interface ExecutionContext {
  waitUntil(promise: Promise<unknown>): void;
  passThroughOnException(): void;
}

interface ExportedHandler<E = Cloudflare.Env> {
  fetch?: (request: Request, env: E, ctx: ExecutionContext) => Response | Promise<Response>;
  scheduled?: (controller: ScheduledController, env: E, ctx: ExecutionContext) => void | Promise<void>;
}

declare module 'cloudflare:workers' {
  export const env: Cloudflare.Env;
}

interface ImportMetaEnv {
  readonly SITE_URL?: string;
  readonly PUBLIC_SUPABASE_URL: string;
  readonly PUBLIC_SUPABASE_ANON_KEY: string;
  readonly PUBLIC_TURNSTILE_SITE_KEY: string;
}
