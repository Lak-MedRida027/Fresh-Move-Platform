/** "Check my reservation": phone + code → POST /api/status → result panel. */
import { attachTurnstile } from './turnstile';
import { validatePhone } from '../lib/membership';
import { normalizeCode } from '../lib/reservation-code';

const PAGE_LOADED_AT = Date.now();
const form = document.querySelector<HTMLFormElement>('[data-status-form]');

if (form) {
  const messages = JSON.parse(form.dataset.messages ?? '{}') as Record<string, string>;
  const errors = JSON.parse(form.dataset.errors ?? '{}') as Record<string, string>;
  const statusLabels = JSON.parse(form.dataset.statusLabels ?? '{}') as Record<string, string>;
  const result = document.querySelector<HTMLElement>('[data-result]')!;
  const failure = form.querySelector<HTMLElement>('[data-failure]')!;
  const failureText = form.querySelector<HTMLElement>('[data-failure-text]')!;
  const submit = form.querySelector<HTMLButtonElement>('[data-submit]')!;
  const label = form.querySelector<HTMLElement>('[data-submit-label]')!;
  const idle = label.textContent ?? '';
  const turnstile = attachTurnstile(form);
  const lang = form.dataset.lang === 'en' ? 'en' : 'ar';
  const input = (f: string) => form.querySelector<HTMLInputElement>(`[data-field="${f}"]`)!;

  const show = (field: string, code: string | null) => {
    const el = input(field);
    const err = form.querySelector<HTMLElement>(`[data-error-for="${field}"]`)!;
    el.toggleAttribute('aria-invalid', !!code);
    if (code) el.setAttribute('aria-invalid', 'true');
    err.textContent = code ? (messages[code] ?? code) : '';
    err.hidden = !code;
  };
  const checkPhone = () => {
    const c = validatePhone(input('phone').value);
    show('phone', c);
    return c;
  };
  const checkCode = () => {
    const v = input('code').value.trim();
    const c = !v ? 'required' : normalizeCode(v) ? null : 'code.invalid';
    show('code', c);
    return c;
  };
  input('phone').addEventListener('blur', () => input('phone').value && checkPhone());
  input('code').addEventListener('blur', () => input('code').value && checkCode());

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    failure.hidden = true;
    result.hidden = true;
    const bad = [checkPhone(), checkCode()].some(Boolean);
    if (bad) {
      form.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus();
      return;
    }
    submit.disabled = true;
    submit.setAttribute('aria-busy', 'true');
    label.textContent = form.dataset.sending ?? idle;
    try {
      const res = await fetch('/api/status', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          phone: input('phone').value,
          code: input('code').value,
          lang,
          website: String(new FormData(form).get('website') ?? ''),
          startedAt: PAGE_LOADED_AT,
          turnstileToken: await turnstile.token(),
        }),
      });
      const body = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        error?: string;
        fields?: Record<string, string>;
        reservation?: {
          code: string;
          status: string;
          holdExpiresAt: string | null;
          trip: { slug: string; title: { ar: string; en: string } };
        };
      };
      turnstile.reset();
      if (res.ok && body.ok && body.reservation) {
        const r = body.reservation;
        result.querySelector('[data-r-code]')!.textContent = r.code;
        const trip = result.querySelector<HTMLAnchorElement>('[data-r-trip]')!;
        trip.textContent = r.trip.title[lang];
        trip.href = `${form.dataset.tripBase}${r.trip.slug}/`;
        result.querySelector('[data-r-status]')!.textContent = statusLabels[r.status] ?? r.status;
        const holdRow = result.querySelector<HTMLElement>('[data-r-hold-row]')!;
        holdRow.hidden = !(r.status === 'pending' && r.holdExpiresAt);
        if (r.holdExpiresAt) {
          result.querySelector('[data-r-hold]')!.textContent = new Intl.DateTimeFormat(lang === 'ar' ? 'ar-DZ' : 'en-GB', {
            weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Africa/Algiers',
          }).format(new Date(r.holdExpiresAt));
        }
        result.hidden = false;
        return;
      }
      if (res.status === 400 && body.error === 'validation' && body.fields) {
        Object.entries(body.fields).forEach(([f, c]) => show(f, c));
        return;
      }
      const code = res.status === 429 ? 'rate_limited' : (body.error ?? 'default');
      failureText.textContent = errors[code] ?? errors.default ?? '';
      failure.hidden = false;
    } catch {
      failureText.textContent = errors.default ?? '';
      failure.hidden = false;
    } finally {
      submit.disabled = false;
      submit.setAttribute('aria-busy', 'false');
      label.textContent = idle;
    }
  });
}

export {};
