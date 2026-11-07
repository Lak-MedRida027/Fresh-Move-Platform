import type { APIRoute } from 'astro';
import { createReserveHandler, ReserveError, type ReserveResult } from '../../lib/reserve-handler';
import { dbLimit, guardDeps, serviceClient } from '../../lib/server-deps';

export const prerender = false;

const handle = createReserveHandler({
  ...guardDeps(),
  // 6 reservation attempts per phone per 10 minutes.
  limitPhone: (phone) => dbLimit(`reserve:phone:${phone}`, 6, 600),
  reserve: async (r) => {
    const { data, error } = await serviceClient().rpc('reserve_seat', {
      p_trip_id: r.tripId,
      p_full_name: r.fullName,
      p_phone: r.phone,
      p_wilaya_code: r.wilayaCode,
      p_age: r.age,
      p_consent: r.consent,
    });
    if (error) throw new ReserveError(error.code === 'P0001' ? error.message : 'rpc_failed');
    return data as unknown as ReserveResult;
  },
});

export const POST: APIRoute = ({ request, clientAddress }) => handle(request, clientAddress);
export const ALL: APIRoute = ({ request }) => handle(request);
