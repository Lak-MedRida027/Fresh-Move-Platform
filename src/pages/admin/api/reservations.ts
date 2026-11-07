/**
 * Reservation actions from the admin (plain form posts). Status changes go
 * through the database's admin_* functions (capacity re-checked under a lock,
 * audited). Middleware has already verified session + MFA + admin role.
 */
import type { APIRoute } from 'astro';
import { backTo, dbErrorCode, fail, intOrNull, notAllowed, ok, readForm, str } from '../../../lib/admin/forms';
import { purgeTrips } from '../../../lib/admin/purge';
import { normalizePhone, validateAge, validateName, validateWilaya } from '../../../lib/membership';

export const prerender = false;

const METHODS = ['baridimob', 'ccp', 'cash', 'other'] as const;
type Method = (typeof METHODS)[number];

export const POST: APIRoute = async (context) => {
  const admin = context.locals.admin;
  const form = await readForm(context);
  const back = backTo(form, '/reservations/');
  if (!admin) return fail(back, 'forbidden');
  const sb = admin.supabase;
  const action = str(form, 'action');
  const id = str(form, 'id');
  const tripId = str(form, 'trip_id');

  let error: { message?: string; code?: string } | null = null;
  let code: string;

  switch (action) {
    case 'confirm': {
      const method = str(form, 'method') as Method;
      const amount = intOrNull(form, 'amount');
      if (!METHODS.includes(method) || amount === null || amount < 0) return fail(back, 'invalid_input');
      ({ error } = await sb.rpc('admin_confirm', {
        p_reservation_id: id,
        p_payment_method: method,
        p_amount_paid_da: amount,
        p_override_capacity: form.get('override') === '1',
      }));
      code = 'confirmed';
      break;
    }
    case 'cancel':
      ({ error } = await sb.rpc('admin_cancel', { p_reservation_id: id, p_reason: str(form, 'reason').slice(0, 500) }));
      code = 'cancelled';
      break;
    case 'promote':
      ({ error } = await sb.rpc('admin_promote', { p_trip_id: tripId, p_reservation_id: id }));
      code = 'promoted';
      break;
    case 'promote_next':
      ({ error } = await sb.rpc('admin_promote', { p_trip_id: tripId }));
      code = 'promoted';
      break;
    case 'waitlist':
      ({ error } = await sb.rpc('admin_move_to_waitlist', { p_reservation_id: id }));
      code = 'waitlisted';
      break;
    case 'extend': {
      const hours = intOrNull(form, 'hours');
      if (hours === null || hours < 1 || hours > 336) return fail(back, 'invalid_input');
      ({ error } = await sb.rpc('admin_extend_hold', { p_reservation_id: id, p_hours: hours }));
      code = 'extended';
      break;
    }
    case 'note':
      ({ error } = await sb.from('reservations').update({ admin_note: str(form, 'note').slice(0, 2000) || null }).eq('id', id));
      code = 'noted';
      break;
    case 'add': {
      // Booked by Instagram DM: same validation rules as the public form.
      const phone = normalizePhone(str(form, 'phone'));
      const age = intOrNull(form, 'age');
      if (validateName(str(form, 'full_name')) || !phone || validateWilaya(str(form, 'wilaya')) || validateAge(age ?? '')) {
        return fail(back, 'invalid_input');
      }
      ({ error } = await sb.rpc('admin_add_manual_reservation', {
        p_trip_id: tripId,
        p_full_name: str(form, 'full_name'),
        p_phone: phone,
        p_wilaya_code: str(form, 'wilaya'),
        p_age: age!,
        p_confirm: form.get('confirm') === '1',
        p_note: str(form, 'note').slice(0, 2000) || undefined,
      }));
      code = 'added';
      break;
    }
    case 'bulk_confirm':
    case 'bulk_cancel': {
      const ids = form.getAll('ids').map(String).filter((x) => /^[0-9a-f-]{36}$/.test(x)).slice(0, 200);
      if (!ids.length) return fail(back, 'invalid_input');
      // Bulk confirm: one payment method; amount from the form, else each trip's price.
      const method = (METHODS.includes(str(form, 'method') as Method) ? str(form, 'method') : 'cash') as Method;
      const amount = intOrNull(form, 'amount');
      const { data: prices } = await sb.from('reservations').select('id, trip:trips(price_da)').in('id', ids);
      const priceOf = new Map(
        (prices ?? []).map((p) => [p.id, (p.trip as { price_da: number | null } | null)?.price_da ?? 0]),
      );
      let done = 0;
      for (const rid of ids) {
        const res =
          action === 'bulk_confirm'
            ? await sb.rpc('admin_confirm', {
                p_reservation_id: rid,
                p_payment_method: method,
                p_amount_paid_da: amount ?? priceOf.get(rid) ?? 0,
              })
            : await sb.rpc('admin_cancel', { p_reservation_id: rid, p_reason: str(form, 'reason').slice(0, 500) || 'bulk' });
        if (res.error) {
          error = res.error;
          break;
        }
        done++;
      }
      await purgeTrips(context);
      if (error) return fail(back, dbErrorCode(error));
      return ok(back, 'bulk', { n: String(done) });
    }
    default:
      return fail(back, 'invalid_input');
  }

  if (error) return fail(back, dbErrorCode(error));
  await purgeTrips(context);
  return ok(back, code);
};

export const ALL: APIRoute = () => notAllowed();
