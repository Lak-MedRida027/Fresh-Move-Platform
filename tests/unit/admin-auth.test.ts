import { describe, expect, it } from 'vitest';
import { linkType, passwordProblem, validTokenHash } from '../../src/lib/admin/auth';
import { ADMIN_MFA, ADMIN_PUBLIC } from '../../src/lib/admin/paths';

describe('admin email links', () => {
  it('only invitation and reset links', () => {
    expect(linkType('invite')).toBe('invite');
    expect(linkType('recovery')).toBe('recovery');
    for (const t of ['signup', 'magiclink', 'email_change', '', null, 1]) expect(linkType(t)).toBeNull();
  });
  it('token hashes are plain tokens', () => {
    expect(validTokenHash('a'.repeat(56))).toBe(true);
    expect(validTokenHash('pkce_0123456789abcdef0123')).toBe(true);
    for (const t of ['short', 'a'.repeat(201), 'abc"><script>xxxxxxxxxxxxxxxxxxx', `${'a'.repeat(30)}/../x`, null]) expect(validTokenHash(t)).toBe(false);
  });
});

describe('passwords', () => {
  it('length, match, obvious ones', () => {
    expect(passwordProblem('short', 'short')).toBe('pw_short');
    expect(passwordProblem('x'.repeat(201), 'x'.repeat(201))).toBe('pw_short');
    expect(passwordProblem('a long enough one', 'a long enough 0ne')).toBe('pw_mismatch');
    expect(passwordProblem('aaaaaaaaaaaaaa', 'aaaaaaaaaaaaaa')).toBe('pw_weak');
    expect(passwordProblem('FreshMove2026!!', 'FreshMove2026!!')).toBe('pw_weak');
    expect(passwordProblem('my password is long', 'my password is long')).toBe('pw_weak');
    expect(passwordProblem('amina.benali rocks', 'amina.benali rocks', 'amina.benali@example.com')).toBe('pw_weak');
    expect(passwordProblem('quiet desert stars at 4am', 'quiet desert stars at 4am', 'amina@example.com')).toBeNull();
  });
});

describe('which admin pages need what', () => {
  it('no session: sign in, the email link page, forgot password', () => {
    for (const p of ['/admin/login/', '/en/admin/auth/confirm/', '/admin/api/confirm/', '/admin/forgot/', '/en/admin/api/forgot']) expect(ADMIN_PUBLIC.test(p), p).toBe(true);
    for (const p of ['/admin/', '/admin/password/', '/admin/api/password/', '/admin/members/', '/admin/auth/confirm/x/']) expect(ADMIN_PUBLIC.test(p), p).toBe(false);
  });
  it('password-only session: MFA, sign out, choose a password; nothing else', () => {
    for (const p of ['/admin/mfa/', '/en/admin/api/mfa/', '/admin/api/logout/', '/admin/password/', '/en/admin/api/password/']) expect(ADMIN_MFA.test(p), p).toBe(true);
    for (const p of ['/admin/', '/admin/members/', '/admin/api/export/', '/admin/passwordx/']) expect(ADMIN_MFA.test(p), p).toBe(false);
  });
});
