import type { APIRoute } from 'astro';
import { createJoinHandler } from '../../lib/join-handler';
import { dbLimit, guardDeps, serviceClient } from '../../lib/server-deps';

export const prerender = false;

const handle = createJoinHandler({
  ...guardDeps(),
  // 5 sign-ups per phone per hour.
  limitPhone: (phone) => dbLimit(`join:phone:${phone}`, 5, 3600),
  saveMember: async (m) => {
    const { error } = await serviceClient().rpc('join_member', {
      p_full_name: m.fullName,
      p_phone: m.phone,
      p_wilaya_code: m.wilayaCode,
      p_age: m.age,
      p_consent: m.consent,
    });
    if (error) throw new Error(error.code ?? 'rpc_failed');
  },
});

export const POST: APIRoute = ({ request, clientAddress }) => handle(request, clientAddress);
// Any other method → 405 with an Allow header.
export const ALL: APIRoute = ({ request }) => handle(request);
