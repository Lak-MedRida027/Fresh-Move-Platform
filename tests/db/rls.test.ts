import { randomUUID } from 'node:crypto';
import { beforeAll, describe, expect, it } from 'vitest';
import { anon, denied, makeTrip, makeUser, phone, reserve, reserveArgs, service, type DB, type TestUser } from './helpers';

type Table = 'members' | 'reservations' | 'admin_users' | 'audit_log' | 'settings' | 'rate_limits';
const PRIVATE_TABLES: Table[] = ['members', 'reservations', 'admin_users', 'audit_log', 'settings', 'rate_limits'];

let user: TestUser; // signed in, not an admin
let noMfa: TestUser; // admin row, but session without MFA (aal1)
let organizer: TestUser;
let owner: TestUser;
let memberId: string;
let reservationId: string;
let openTripId: string;
let draftTripId: string;

beforeAll(async () => {
  [user, noMfa, organizer, owner] = await Promise.all([
    makeUser(),
    makeUser({ role: 'organizer', mfa: false }),
    makeUser({ role: 'organizer', mfa: true }),
    makeUser({ role: 'owner', mfa: true }),
  ]);
  const open = await makeTrip();
  const draft = await makeTrip({ status: 'draft' });
  openTripId = open.id;
  draftTripId = draft.id;
  const p = phone();
  const r = await reserve(open.id, p);
  const { data: m } = await service.from('members').select('id').eq('phone', p).single();
  memberId = m!.id;
  const { data: res } = await service.from('reservations').select('id').eq('code', r.code).single();
  reservationId = res!.id;
  // Something in the audit log to (fail to) read.
  await owner.client.from('trips').update({ featured: true }).eq('id', open.id);
});

async function expectNoAccess(client: DB, label: string) {
  for (const table of PRIVATE_TABLES) {
    const read = await client.from(table).select('*').limit(5);
    expect(denied(read), `${label} select ${table}`).toBe(true);
  }
  // Writes: an error, or zero affected rows (RLS filtered).
  const ins = await client.from('members').insert({ full_name: 'Hacker', phone: phone(), wilaya_code: '16', age: 30 }).select();
  expect(denied(ins), `${label} insert members`).toBe(true);
  const upd = await client.from('members').update({ notes: 'x' }).eq('id', memberId).select();
  expect(denied(upd), `${label} update members`).toBe(true);
  const del = await client.from('members').delete().eq('id', memberId).select();
  expect(denied(del), `${label} delete members`).toBe(true);
  const updR = await client.from('reservations').update({ admin_note: 'x' }).eq('id', reservationId).select();
  expect(denied(updR), `${label} update reservations`).toBe(true);
  const insR = await client.from('reservations').insert({ code: 'FM-AAAAA', trip_id: openTripId, status: 'confirmed' }).select();
  expect(denied(insR), `${label} insert reservations`).toBe(true);
  const delR = await client.from('reservations').delete().eq('id', reservationId).select();
  expect(denied(delR), `${label} delete reservations`).toBe(true);
  const insA = await client.from('admin_users').insert({ user_id: user.id, role: 'owner' }).select();
  expect(denied(insA), `${label} insert admin_users`).toBe(true);
  const insL = await client.from('audit_log').insert({ action: 'x', entity: 'x' }).select();
  expect(denied(insL), `${label} insert audit_log`).toBe(true);
  const updS = await client.from('settings').update({ retention_months: 1 }).eq('id', true).select();
  expect(denied(updS), `${label} update settings`).toBe(true);

  // Trips: can't write; can't see drafts.
  const insT = await client.from('trips').insert({ slug: `x-${Date.now()}`, title_ar: 'x', title_en: 'x', region: 'aures', terrain: ['mountain'] }).select();
  expect(denied(insT), `${label} insert trips`).toBe(true);
  const updT = await client.from('trips').update({ title_en: 'pwned' }).eq('id', openTripId).select();
  expect(denied(updT), `${label} update trips`).toBe(true);
  const draft = await client.from('trips').select('id').eq('id', draftTripId);
  expect(denied(draft), `${label} read draft trip`).toBe(true);

  // Server-only functions are not callable directly.
  for (const [fn, args] of [
    ['reserve_seat', reserveArgs(openTripId)],
    ['join_member', { p_full_name: 'X Y', p_phone: phone(), p_wilaya_code: '16', p_age: 20, p_consent: true }],
    ['reservation_status', { p_phone: phone(), p_code: 'FM-AAAAA' }],
    ['hit_rate_limit', { p_key: 'x', p_max: 1, p_window_seconds: 60 }],
    ['expire_holds', {}],
    ['anonymise_old_reservations', {}],
  ] as const) {
    const res = await client.rpc(fn as never, args as never);
    expect(res.error, `${label} rpc ${fn}`).not.toBeNull();
  }
  // Admin functions refuse non-admins.
  const conf = await client.rpc('admin_confirm', { p_reservation_id: reservationId, p_payment_method: 'cash', p_amount_paid_da: 1 });
  expect(conf.error, `${label} admin_confirm`).not.toBeNull();

  // Nothing changed.
  const { data: still } = await service.from('members').select('id, notes').eq('id', memberId).single();
  expect(still).toMatchObject({ id: memberId, notes: null });
  const { data: t } = await service.from('trips').select('title_en').eq('id', openTripId).single();
  expect(t!.title_en).toBe('Test trip');
}

describe('RLS: public and non-admins have no access to private data', () => {
  it('anon (publishable key)', async () => {
    await expectNoAccess(anon(), 'anon');
  });

  it('signed-in user who is not an admin', async () => {
    await expectNoAccess(user.client, 'user');
  });

  it('admin without MFA (aal1) is treated as non-admin', async () => {
    await expectNoAccess(noMfa.client, 'admin-no-mfa');
    const { data } = await noMfa.client.rpc('is_admin_pending_mfa');
    expect(data).toBe(true);
  });

  it('anon can read open and completed trips and their stats, not drafts', async () => {
    const completed = await makeTrip({ status: 'completed' });
    const client = anon();
    const { data } = await client.from('trips').select('id, status').in('id', [openTripId, completed.id, draftTripId]);
    expect(data!.map((t) => t.status).sort()).toEqual(['completed', 'open']);
    const stats = await client.rpc('trip_public_stats', { p_trip_ids: [openTripId, draftTripId] });
    expect(stats.data!.map((s) => s.trip_id)).toEqual([openTripId]);
    expect(Object.keys(stats.data![0]!).sort()).toEqual(['capacity', 'seats_left', 'trip_id']);
  });
});

describe('RLS: admins', () => {
  it('organizer (MFA) reads members, reservations, drafts; edits trips', async () => {
    const c = organizer.client;
    expect((await c.from('members').select('id').eq('id', memberId)).data).toHaveLength(1);
    expect((await c.from('reservations').select('id').eq('id', reservationId)).data).toHaveLength(1);
    expect((await c.from('trips').select('id').eq('id', draftTripId)).data).toHaveLength(1);
    const upd = await c.from('trips').update({ summary_en: 'Edited' }).eq('id', draftTripId).select();
    expect(upd.data).toHaveLength(1);
    const note = await c.from('reservations').update({ admin_note: 'called' }).eq('id', reservationId).select();
    expect(note.data).toHaveLength(1);
  });

  it('organizer cannot change reservation status directly (only via functions)', async () => {
    const res = await organizer.client.from('reservations').update({ status: 'confirmed' } as never).eq('id', reservationId);
    expect(res.error).not.toBeNull();
  });

  it('organizer: owner-only actions fail', async () => {
    const c = organizer.client;
    const del = await c.from('members').delete().eq('id', memberId).select();
    expect(denied(del)).toBe(true);
    const newAdmin = await c.from('admin_users').insert({ user_id: user.id, role: 'organizer' }).select();
    expect(denied(newAdmin)).toBe(true);
    const promote = await c.from('admin_users').update({ role: 'owner' }).eq('user_id', organizer.id).select();
    expect(denied(promote)).toBe(true);
    const log = await c.from('audit_log').select('*').limit(1);
    expect(denied(log)).toBe(true);
    const settings = await c.from('settings').update({ retention_months: 6 }).eq('id', true).select();
    expect(denied(settings)).toBe(true);
    const delTrip = await c.from('trips').delete().eq('id', draftTripId).select();
    expect(denied(delTrip)).toBe(true);
  });

  it('owner reads the audit log and manages admins and settings', async () => {
    const c = owner.client;
    const log = await c.from('audit_log').select('*').eq('entity', 'trips').eq('entity_id', openTripId);
    expect(log.data!.length).toBeGreaterThan(0);
    expect(log.data![0]!.actor_user_id).toBe(owner.id);
    const add = await c.from('admin_users').insert({ user_id: user.id, role: 'organizer' }).select();
    expect(add.data).toHaveLength(1);
    await c.from('admin_users').delete().eq('user_id', user.id);
    const s = await c.from('settings').update({ retention_months: 12 }).eq('id', true).select();
    expect(s.data).toHaveLength(1);
  });

  it('the last owner cannot be removed or demoted', async () => {
    // Make this owner the only owner for the duration of the check.
    const { data: owners } = await service.from('admin_users').select('user_id').eq('role', 'owner');
    const others = owners!.map((o) => o.user_id).filter((id) => id !== owner.id);
    await service.from('admin_users').update({ role: 'organizer' }).in('user_id', others);
    try {
      const demote = await owner.client.from('admin_users').update({ role: 'organizer' }).eq('user_id', owner.id);
      expect(demote.error?.message).toBe('last_owner');
    } finally {
      await service.from('admin_users').update({ role: 'owner' }).in('user_id', others);
    }
  });

  it('publishing requires alt text on every image', async () => {
    const trip = await makeTrip({ status: 'draft' });
    expect((await service.from('trip_images').insert(image(trip.id))).error).toBeNull();
    const res = await organizer.client.from('trips').update({ status: 'open' }).eq('id', trip.id);
    expect(res.error?.message).toBe('missing_alt_text');
    await service.from('trip_images').update({ alt_ar: 'بوستر', alt_en: 'Poster' }).eq('trip_id', trip.id);
    expect((await organizer.client.from('trips').update({ status: 'open' }).eq('id', trip.id)).error).toBeNull();
  });

  it('closing a trip also requires alt text (closed trips are public)', async () => {
    const trip = await makeTrip({ status: 'draft' });
    await service.from('trip_images').insert(image(trip.id));
    const res = await organizer.client.from('trips').update({ status: 'closed' }).eq('id', trip.id);
    expect(res.error?.message).toBe('missing_alt_text');
  });

  it('photo files must live at trips/<trip>/<image>-<size>.webp', async () => {
    const trip = await makeTrip({ status: 'draft' });
    const bad = { ...image(trip.id), path_md: `trips/${trip.id}/other-md.webp` };
    expect((await service.from('trip_images').insert(bad)).error?.message).toMatch(/trip_images_paths/);
  });

  it('the public never sees a photo that lacks alt text, even on a public trip', async () => {
    const trip = await makeTrip({ status: 'open' });
    const withAlt = { ...image(trip.id), alt_ar: 'صورة', alt_en: 'Photo' };
    const without = { ...image(trip.id), alt_ar: '', alt_en: '' };
    expect((await service.from('trip_images').insert([withAlt, without])).error).toBeNull();
    const { data } = await anon().from('trip_images').select('id').eq('trip_id', trip.id);
    expect(data?.map((r) => r.id)).toEqual([withAlt.id]);
    const { data: adminView } = await organizer.client.from('trip_images').select('id').eq('trip_id', trip.id);
    expect(adminView).toHaveLength(2);
  });

  it('admins reorder photos in one call; bad lists and non-admins are refused', async () => {
    const trip = await makeTrip({ status: 'draft' });
    const imgs = [image(trip.id), image(trip.id), image(trip.id)];
    await service.from('trip_images').insert(imgs);
    const order = [imgs[2]!.id, imgs[0]!.id, imgs[1]!.id];
    expect((await organizer.client.rpc('admin_reorder_images', { p_trip_id: trip.id, p_ids: order })).error).toBeNull();
    const { data } = await service.from('trip_images').select('id').eq('trip_id', trip.id).order('sort_order');
    expect(data?.map((r) => r.id)).toEqual(order);

    const partial = await organizer.client.rpc('admin_reorder_images', { p_trip_id: trip.id, p_ids: order.slice(1) });
    expect(partial.error?.message).toBe('invalid_input');
    const dup = await organizer.client.rpc('admin_reorder_images', { p_trip_id: trip.id, p_ids: [order[0]!, order[0]!, order[1]!] });
    expect(dup.error?.message).toBe('invalid_input');
    expect(denied(await noMfa.client.rpc('admin_reorder_images', { p_trip_id: trip.id, p_ids: order }))).toBe(true);
    expect(denied(await anon().rpc('admin_reorder_images', { p_trip_id: trip.id, p_ids: order }))).toBe(true);
  });
});

function image(tripId: string) {
  const id = randomUUID();
  const path = (size: string) => `trips/${tripId}/${id}-${size}.webp`;
  return { id, trip_id: tripId, kind: 'poster' as const, path_sm: path('sm'), path_md: path('md'), path_lg: path('lg'), width: 1080, height: 1350 };
}
