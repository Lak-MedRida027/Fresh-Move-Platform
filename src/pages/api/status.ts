import type { APIRoute } from 'astro';
import { createStatusHandler, type StatusResult } from '../../lib/status-handler';
import { dbLimit, guardDeps, serviceClient } from '../../lib/server-deps';

export const prerender = false;

const handle = createStatusHandler({
  ...guardDeps(),
  // 10 lookups per phone and per code per hour.
  limit: (key) => dbLimit(key, 10, 3600),
  lookup: async (phone, code) => {
    const { data, error } = await serviceClient().rpc('reservation_status', { p_phone: phone, p_code: code });
    if (error) throw new Error(error.code ?? 'rpc_failed');
    return (data as unknown as StatusResult | null) ?? null;
  },
});

export const POST: APIRoute = ({ request, clientAddress }) => handle(request, clientAddress);
export const ALL: APIRoute = ({ request }) => handle(request);
