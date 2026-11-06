import { randomUUID } from 'node:crypto';
import { beforeAll, describe, expect, it } from 'vitest';
import { anon, makeUser, service, type TestUser } from './helpers';

// A minimal valid WebP (1×1) so uploads are realistic.
const WEBP = Buffer.from('UklGRiQAAABXRUJQVlA4IBgAAAAwAQCdASoBAAEAAwA0JaQAA3AA/vuUAAA=', 'base64');
const bucket = 'trip-images';
let admin: TestUser;
let user: TestUser;
let noMfa: TestUser;

beforeAll(async () => {
  [admin, user, noMfa] = await Promise.all([
    makeUser({ role: 'organizer', mfa: true }),
    makeUser(),
    makeUser({ role: 'organizer', mfa: false }),
  ]);
});

const path = () => `trips/test/${randomUUID()}-sm.webp`;
const upload = (client: typeof service, p: string, body: Buffer = WEBP, contentType = 'image/webp') =>
  client.storage.from(bucket).upload(p, body, { contentType, upsert: false });

describe('storage bucket trip-images', () => {
  it('is public-read, 15 MB, WebP only', async () => {
    const { data } = await service.storage.getBucket(bucket);
    expect(data).toMatchObject({ public: true, file_size_limit: 15728640, allowed_mime_types: ['image/webp'] });
  });

  it('anon cannot upload', async () => {
    const res = await upload(anon(), path());
    expect(res.error).not.toBeNull();
  });

  it('a signed-in non-admin and an admin without MFA cannot upload', async () => {
    expect((await upload(user.client, path())).error).not.toBeNull();
    expect((await upload(noMfa.client, path())).error).not.toBeNull();
  });

  it('admin (MFA) can upload, the file is publicly readable, and admin can delete', async () => {
    const p = path();
    const up = await upload(admin.client, p);
    expect(up.error).toBeNull();
    const url = anon().storage.from(bucket).getPublicUrl(p).data.publicUrl;
    const res = await fetch(url);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('image/webp');

    // Others can't delete it.
    await anon().storage.from(bucket).remove([p]);
    await user.client.storage.from(bucket).remove([p]);
    expect((await fetch(url)).status).toBe(200);

    const del = await admin.client.storage.from(bucket).remove([p]);
    expect(del.error).toBeNull();
    expect((await fetch(url)).status).not.toBe(200);
  });

  it('rejects non-WebP files even for admins', async () => {
    const res = await upload(admin.client, path().replace('.webp', '.jpg'), Buffer.from('fake'), 'image/jpeg');
    expect(res.error).not.toBeNull();
  });

  it('storage usage is admin-only', async () => {
    expect((await admin.client.rpc('admin_storage_usage')).data).toMatchObject({ quota_bytes: 1073741824 });
    expect((await user.client.rpc('admin_storage_usage')).error).not.toBeNull();
    expect((await anon().rpc('admin_storage_usage')).error).not.toBeNull();
  });
});
