import { beforeAll, describe, expect, it } from 'vitest';
import {
  makeTrip,
  makeUser,
  phone,
  reservationByCode,
  reserve,
  reserveArgs,
  service,
  type TestUser,
} from './helpers';

let owner: TestUser;
let organizer: TestUser;

beforeAll(async () => {
  owner = await makeUser({ role: 'owner', mfa: true });
  organizer = await makeUser({ role: 'organizer', mfa: true });
});

const CODE_RE = /^FM-[2-9A-HJ-NP-Z]{5}$/;

describe('reserve_seat', () => {
  it('30 parallel reservations on 5 seats → exactly 5 pending, 25 waitlist, no overbooking', async () => {
    const trip = await makeTrip({ capacity: 5 });
    const results = await Promise.all(Array.from({ length: 30 }, () => reserve(trip.id)));

    const statuses = results.map((r) => r.status);
    expect(statuses.filter((s) => s === 'pending')).toHaveLength(5);
    expect(statuses.filter((s) => s === 'waitlist')).toHaveLength(25);
    expect(new Set(results.map((r) => r.code)).size).toBe(30);
    results.forEach((r) => expect(r.code).toMatch(CODE_RE));

    const { data } = await service.from('reservations').select('status').eq('trip_id', trip.id);
    expect(data!.filter((r) => r.status === 'pending')).toHaveLength(5);
    expect(data!.filter((r) => r.status === 'waitlist')).toHaveLength(25);

    const { data: stats } = await service.rpc('trip_public_stats', { p_trip_ids: [trip.id] });
    expect(stats![0]).toMatchObject({ capacity: 5, seats_left: 0 });
  });

  it('pending reservation has a hold of hold_hours; seats_left counts down', async () => {
    const trip = await makeTrip({ capacity: 3, hold_hours: 24 });
    const r = await reserve(trip.id);
    expect(r.status).toBe('pending');
    expect(r.seats_left).toBe(2);
    const hours = (new Date(r.hold_expires_at!).getTime() - Date.now()) / 3_600_000;
    expect(hours).toBeGreaterThan(23.9);
    expect(hours).toBeLessThan(24.1);
  });

  it('same phone twice → one reservation, same code returned', async () => {
    const trip = await makeTrip();
    const p = phone();
    const first = await reserve(trip.id, p);
    const second = await reserve(trip.id, p);
    expect(second.code).toBe(first.code);
    expect(second.existing).toBe(true);
    const { count } = await service
      .from('reservations')
      .select('id', { count: 'exact', head: true })
      .eq('trip_id', trip.id);
    expect(count).toBe(1);
  });

  it('same phone in parallel still yields a single reservation', async () => {
    const trip = await makeTrip();
    const p = phone();
    const results = await Promise.all(Array.from({ length: 5 }, () => reserve(trip.id, p)));
    expect(new Set(results.map((r) => r.code)).size).toBe(1);
  });

  it('upserts the member by phone; a public booking never changes an existing member', async () => {
    const trip1 = await makeTrip();
    const trip2 = await makeTrip();
    const p = phone();
    await reserve(trip1.id, p);
    // Someone else typing this phone number can't rename the member.
    await service.rpc('reserve_seat', { ...reserveArgs(trip2.id, p), p_full_name: 'Hacker Name', p_wilaya_code: '16', p_age: 60 });
    const { data } = await service.from('members').select('*').eq('phone', p);
    expect(data).toHaveLength(1);
    expect(data![0]).toMatchObject({ full_name: 'Lina Benali', wilaya_code: '05', age: 25, source: 'reservation' });
    expect(data![0]!.consent_at).not.toBeNull();
  });

  it('an admin-added booking may update the member details', async () => {
    const trip = await makeTrip();
    const p = phone();
    await reserve((await makeTrip()).id, p);
    const { error } = await organizer.client.rpc('admin_add_manual_reservation', {
      p_trip_id: trip.id, p_full_name: 'Lina Benali-Amrani', p_phone: p, p_wilaya_code: '16', p_age: 26,
    });
    expect(error).toBeNull();
    const { data } = await service.from('members').select('*').eq('phone', p).single();
    expect(data).toMatchObject({ full_name: 'Lina Benali-Amrani', wilaya_code: '16', age: 26 });
  });

  it('an expired hold frees its seat even before the expiry job runs', async () => {
    const trip = await makeTrip({ capacity: 1 });
    const a = await reserve(trip.id);
    expect(a.status).toBe('pending');
    expect((await reserve(trip.id)).status).toBe('waitlist');

    await service
      .from('reservations')
      .update({ hold_expires_at: new Date(Date.now() - 60_000).toISOString() })
      .eq('code', a.code);

    const c = await reserve(trip.id);
    expect(c.status).toBe('pending');
    // A is still "pending" in the table until the job runs, but not counted.
    expect((await reservationByCode(a.code)).status).toBe('pending');
    const { data: expired } = await service.rpc('expire_holds');
    expect(expired).toBeGreaterThanOrEqual(1);
    expect((await reservationByCode(a.code)).status).toBe('expired');
  });

  it('the same person can book again after their hold expired', async () => {
    const trip = await makeTrip({ capacity: 2 });
    const p = phone();
    const first = await reserve(trip.id, p);
    await service
      .from('reservations')
      .update({ hold_expires_at: new Date(Date.now() - 1000).toISOString() })
      .eq('code', first.code);
    const second = await reserve(trip.id, p);
    expect(second.existing).toBe(false);
    expect(second.code).not.toBe(first.code);
    expect((await reservationByCode(first.code)).status).toBe('expired');
  });

  it.each([
    ['draft trip', { status: 'draft' }, 'trip_not_open'],
    ['closed trip', { status: 'closed' }, 'trip_not_open'],
    ['deadline passed', { registration_deadline: new Date(Date.now() - 1000).toISOString() }, 'registration_closed'],
  ])('rejects %s', async (_label, patch, code) => {
    const trip = await makeTrip(patch as never);
    const { error } = await service.rpc('reserve_seat', reserveArgs(trip.id));
    expect(error?.message).toBe(code);
  });

  it('rejects a trip that already started', async () => {
    const trip = await makeTrip();
    // Move dates into the past (bypass the API; status stays open).
    await service.from('trips').update({ start_date: '2020-01-01', end_date: '2020-01-02' }).eq('id', trip.id);
    const { error } = await service.rpc('reserve_seat', reserveArgs(trip.id));
    expect(error?.message).toBe('trip_past');
  });

  it.each([
    ['bad phone', { p_phone: '0661234567' }],
    ['bad wilaya', { p_wilaya_code: '70' }],
    ['too young', { p_age: 15 }],
    ['short name', { p_full_name: 'A' }],
  ])('validates input: %s', async (_l, patch) => {
    const trip = await makeTrip();
    const { error } = await service.rpc('reserve_seat', { ...reserveArgs(trip.id), ...patch });
    expect(error?.message).toBe('invalid_input');
  });

  it('requires consent', async () => {
    const trip = await makeTrip();
    const { error } = await service.rpc('reserve_seat', { ...reserveArgs(trip.id), p_consent: false });
    expect(error?.message).toBe('consent_required');
  });

  it('limits a person to 3 active pending holds across trips', async () => {
    const p = phone();
    const trips = await Promise.all([1, 2, 3, 4].map(() => makeTrip()));
    for (const t of trips.slice(0, 3)) expect((await reserve(t.id, p)).status).toBe('pending');
    const { error } = await service.rpc('reserve_seat', reserveArgs(trips[3]!.id, p));
    expect(error?.message).toBe('too_many_pending');
  });
});

describe('admin seat actions', () => {
  it('confirm over capacity is blocked; owner override works and is logged', async () => {
    const trip = await makeTrip({ capacity: 1 });
    await reserve(trip.id); // takes the only seat
    const waiting = await reserve(trip.id);
    expect(waiting.status).toBe('waitlist');
    const w = await reservationByCode(waiting.code);

    let res = await organizer.client.rpc('admin_confirm', {
      p_reservation_id: w.id, p_payment_method: 'cash', p_amount_paid_da: 2500,
    });
    expect(res.error?.message).toBe('over_capacity');

    res = await organizer.client.rpc('admin_confirm', {
      p_reservation_id: w.id, p_payment_method: 'cash', p_amount_paid_da: 2500, p_override_capacity: true,
    });
    expect(res.error?.message).toBe('owner_only');

    res = await owner.client.rpc('admin_confirm', {
      p_reservation_id: w.id, p_payment_method: 'cash', p_amount_paid_da: 2500, p_override_capacity: true,
    });
    expect(res.error).toBeNull();
    const after = await reservationByCode(waiting.code);
    expect(after).toMatchObject({ status: 'confirmed', payment_method: 'cash', amount_paid_da: 2500, confirmed_by: owner.id });

    const { data: log } = await service
      .from('audit_log').select('*').eq('entity_id', w.id).eq('action', 'confirm_over_capacity');
    expect(log).toHaveLength(1);
    expect(log![0]!.actor_user_id).toBe(owner.id);
  });

  it('confirming a pending hold within capacity works for an organizer', async () => {
    const trip = await makeTrip({ capacity: 2 });
    const r = await reserve(trip.id);
    const row = await reservationByCode(r.code);
    const { error } = await organizer.client.rpc('admin_confirm', {
      p_reservation_id: row.id, p_payment_method: 'baridimob', p_amount_paid_da: 3000,
    });
    expect(error).toBeNull();
    const after = await reservationByCode(r.code);
    expect(after.status).toBe('confirmed');
    expect(after.hold_expires_at).toBeNull();
    // Logged by the audit trigger (admin write).
    const { data: log } = await service.from('audit_log').select('*').eq('entity_id', row.id).eq('action', 'update');
    expect(log!.length).toBeGreaterThanOrEqual(1);
  });

  it('promote from waitlist respects capacity and FIFO order', async () => {
    const trip = await makeTrip({ capacity: 1 });
    const a = await reserve(trip.id);
    const b = await reserve(trip.id);
    const c = await reserve(trip.id);
    expect([a.status, b.status, c.status]).toEqual(['pending', 'waitlist', 'waitlist']);

    let res = await organizer.client.rpc('admin_promote', { p_trip_id: trip.id });
    expect(res.error?.message).toBe('over_capacity');

    const aRow = await reservationByCode(a.code);
    res = await organizer.client.rpc('admin_cancel', { p_reservation_id: aRow.id, p_reason: 'changed plans' });
    expect(res.error).toBeNull();

    res = await organizer.client.rpc('admin_promote', { p_trip_id: trip.id });
    expect(res.error).toBeNull();
    expect((await reservationByCode(b.code)).status).toBe('pending');
    expect((await reservationByCode(c.code)).status).toBe('waitlist');
  });

  it('move to waitlist puts the person at the back of the queue', async () => {
    const trip = await makeTrip({ capacity: 1 });
    const a = await reserve(trip.id);
    const b = await reserve(trip.id);
    const aRow = await reservationByCode(a.code);
    expect((await organizer.client.rpc('admin_move_to_waitlist', { p_reservation_id: aRow.id })).error).toBeNull();
    await organizer.client.rpc('admin_promote', { p_trip_id: trip.id });
    expect((await reservationByCode(b.code)).status).toBe('pending'); // b was waiting first
    expect((await reservationByCode(a.code)).status).toBe('waitlist');
  });

  it('extend hold adds hours to a pending reservation', async () => {
    const trip = await makeTrip();
    const r = await reserve(trip.id);
    const row = await reservationByCode(r.code);
    const { data, error } = await organizer.client.rpc('admin_extend_hold', { p_reservation_id: row.id, p_hours: 24 });
    expect(error).toBeNull();
    const extended = new Date((data as { hold_expires_at: string }).hold_expires_at).getTime();
    expect(extended - new Date(r.hold_expires_at!).getTime()).toBeGreaterThan(23.9 * 3_600_000);
  });

  it('manual reservation (booked by DM) can be confirmed directly and ignores the deadline', async () => {
    const trip = await makeTrip({ capacity: 2, registration_deadline: new Date(Date.now() - 1000).toISOString() });
    const { data, error } = await organizer.client.rpc('admin_add_manual_reservation', {
      p_trip_id: trip.id, p_full_name: 'Yacine', p_phone: phone(), p_wilaya_code: '19', p_age: 30,
      p_confirm: true, p_note: 'Booked by Instagram DM',
    });
    expect(error).toBeNull();
    const row = await reservationByCode((data as { code: string }).code);
    expect(row).toMatchObject({ status: 'confirmed', source: 'admin', admin_note: 'Booked by Instagram DM' });
  });

  it('capacity cannot drop below confirmed seats', async () => {
    const trip = await makeTrip({ capacity: 2 });
    for (const r of [await reserve(trip.id), await reserve(trip.id)]) {
      const row = await reservationByCode(r.code);
      await organizer.client.rpc('admin_confirm', { p_reservation_id: row.id, p_payment_method: 'ccp', p_amount_paid_da: 1 });
    }
    const { error } = await organizer.client.from('trips').update({ capacity: 1 }).eq('id', trip.id);
    expect(error?.message).toBe('capacity_below_confirmed');
  });
});

describe('status, membership, jobs', () => {
  it('reservation_status needs both phone and code; same null answer otherwise', async () => {
    const trip = await makeTrip();
    const p = phone();
    const r = await reserve(trip.id, p);
    const ok = await service.rpc('reservation_status', { p_phone: p, p_code: r.code.toLowerCase() });
    expect(ok.data).toMatchObject({ code: r.code, status: 'pending', trip: { slug: trip.slug } });
    const wrongPhone = await service.rpc('reservation_status', { p_phone: phone(), p_code: r.code });
    const wrongCode = await service.rpc('reservation_status', { p_phone: p, p_code: 'FM-ZZZZZ' });
    expect(wrongPhone.data).toBeNull();
    expect(wrongCode.data).toBeNull();
  });

  it('join_member upserts by phone, keeps the first consent and never overwrites details', async () => {
    const p = phone();
    const first = await service.rpc('join_member', {
      p_full_name: 'Sara', p_phone: p, p_wilaya_code: '06', p_age: 22, p_consent: true,
    });
    expect(first.data).toMatchObject({ ok: true, new: true });
    const { data: m1 } = await service.from('members').select('*').eq('phone', p).single();
    const second = await service.rpc('join_member', {
      p_full_name: 'Sara Amrani', p_phone: p, p_wilaya_code: '06', p_age: 23, p_consent: true,
    });
    expect(second.data).toMatchObject({ ok: true, new: false });
    const { data: m2 } = await service.from('members').select('*').eq('phone', p).single();
    expect(m2).toMatchObject({ full_name: 'Sara', age: 22, source: 'join_form', consent_at: m1!.consent_at });
  });

  it('hit_rate_limit allows N hits per window, then refuses', async () => {
    const key = `test:${phone()}`;
    const results = [];
    for (let i = 0; i < 4; i++) results.push((await service.rpc('hit_rate_limit', { p_key: key, p_max: 3, p_window_seconds: 600 })).data);
    expect(results).toEqual([true, true, true, false]);
  });

  it('retention anonymises old bookings and strips personal details from old audit entries', async () => {
    const trip = await makeTrip();
    const p = phone();
    const r = await reserve(trip.id, p);
    const res = await reservationByCode(r.code);
    const { data: m } = await service.from('members').select('id').eq('phone', p).single();
    // Admin activity that copies personal data into the audit log.
    await owner.client.from('reservations').update({ admin_note: 'paid at the bus' }).eq('id', res.id);
    await owner.client.from('members').update({ notes: 'call after 6pm' }).eq('id', m!.id);
    await owner.client.rpc('log_export', { p_entity: 'reservations', p_entity_id: trip.id, p_rows: 1, p_filter: { q: 'ali' } });
    // A recent entry about someone else must stay as it is.
    const other = await reserve(trip.id);
    const otherRes = await reservationByCode(other.code);
    await owner.client.from('reservations').update({ admin_note: 'recent note' }).eq('id', otherRes.id);

    // The trip ended long ago; the entries about this person are old too.
    await service.from('trips').update({ start_date: '2020-01-01', end_date: '2020-01-02', status: 'completed' }).eq('id', trip.id);
    for (const [entity, id] of [['reservations', res.id], ['members', m!.id], ['reservations', trip.id]] as const) {
      await service.from('audit_log').update({ created_at: '2020-02-01T00:00:00Z' }).eq('entity', entity).eq('entity_id', id);
    }

    const { data, error } = await service.rpc('apply_retention');
    expect(error).toBeNull();
    expect(data).toMatchObject({ anonymised: expect.any(Number), audit_redacted: expect.any(Number), rate_limits_deleted: expect.any(Number) });
    expect((data as { audit_redacted: number }).audit_redacted).toBeGreaterThanOrEqual(3);

    const row = await reservationByCode(r.code);
    expect(row).toMatchObject({ member_id: null, admin_note: null, status: 'pending' });
    expect(row.anonymised_at).not.toBeNull();

    const audit = async (entity: string, id: string) =>
      (await service.from('audit_log').select('action, before, after, redacted_at, actor_user_id').eq('entity', entity).eq('entity_id', id)).data ?? [];
    const resEntries = await audit('reservations', res.id);
    expect(resEntries.length).toBeGreaterThan(0);
    for (const e of resEntries) {
      expect(e.redacted_at).not.toBeNull();
      expect(JSON.stringify([e.before, e.after])).not.toMatch(/paid at the bus|member_id/);
      expect(e.after).toMatchObject({ status: 'pending' }); // the fact stays, the person goes
      expect(e.actor_user_id).toBe(owner.id);
    }
    for (const e of await audit('members', m!.id)) expect(e).toMatchObject({ before: null, after: null });
    const [exp] = (await audit('reservations', trip.id)).filter((e) => e.action === 'export');
    expect(exp!.after).toEqual({ rows: 1 });

    const [recent] = await audit('reservations', otherRes.id);
    expect(recent).toMatchObject({ redacted_at: null, after: { admin_note: 'recent note' } });
  });

  it('privacy delete: bookings stay for statistics, notes and audit details about the person go', async () => {
    const trip = await makeTrip();
    const p = phone();
    const r = await reserve(trip.id, p);
    const res = await reservationByCode(r.code);
    const { data: m } = await service.from('members').select('id').eq('phone', p).single();
    await owner.client.from('reservations').update({ admin_note: 'Sara, sister of Amine' }).eq('id', res.id);
    await owner.client.from('members').update({ notes: 'vegetarian' }).eq('id', m!.id);

    const { error } = await owner.client.from('members').delete().eq('id', m!.id);
    expect(error).toBeNull();
    const row = await reservationByCode(r.code);
    expect(row).toMatchObject({ member_id: null, admin_note: null, trip_id: trip.id, status: 'pending' });

    const { data: resEntries } = await service.from('audit_log').select('before, after').eq('entity', 'reservations').eq('entity_id', res.id);
    expect(resEntries!.length).toBeGreaterThan(0);
    expect(JSON.stringify(resEntries)).not.toMatch(/Sara|member_id|admin_note/);
    const { data: memEntries } = await service.from('audit_log').select('action, before, after, actor_user_id').eq('entity', 'members').eq('entity_id', m!.id);
    expect(memEntries!.map((e) => e.action).sort()).toEqual(['delete', 'update']);
    for (const e of memEntries!) expect(e).toMatchObject({ before: null, after: null, actor_user_id: owner.id });
    expect(JSON.stringify(memEntries)).not.toContain(p);
  });

  it('orphan photo files: only files no photo row points to, and only older ones', async () => {
    const trip = await makeTrip({ status: 'draft' });
    const kept = crypto.randomUUID();
    const path = (id: string, size: string) => `trips/${trip.id}/${id}-${size}.webp`;
    await service.from('trip_images').insert({
      id: kept, trip_id: trip.id, kind: 'poster', width: 100, height: 100,
      path_sm: path(kept, 'sm'), path_md: path(kept, 'md'), path_lg: path(kept, 'lg'),
    });
    const orphan = path(crypto.randomUUID(), 'md');
    const bytes = new Blob([new Uint8Array([82, 73, 70, 70])], { type: 'image/webp' });
    for (const name of [path(kept, 'sm'), orphan]) {
      expect((await service.storage.from('trip-images').upload(name, bytes, { contentType: 'image/webp' })).error).toBeNull();
    }
    try {
      const now = await service.rpc('orphan_image_objects', { p_min_age: '0 seconds', p_limit: 5000 });
      expect(now.error).toBeNull();
      const names = now.data!.map((r) => r.name);
      expect(names).toContain(orphan);
      expect(names).not.toContain(path(kept, 'sm'));
      expect(now.data![0]!.total_objects).toBeGreaterThanOrEqual(2);
      // Default: a day old at least, so uploads in progress are never touched.
      const fresh = await service.rpc('orphan_image_objects');
      expect(fresh.data!.map((r) => r.name)).not.toContain(orphan);
    } finally {
      await service.storage.from('trip-images').remove([path(kept, 'sm'), orphan]);
      await service.from('trips').delete().eq('id', trip.id);
    }
  });
});
