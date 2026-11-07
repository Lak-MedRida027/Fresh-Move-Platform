/**
 * Shared behaviour for forms built with MemberFields.astro (membership and
 * reservation): validation on blur and submit with the same rules as the
 * server (src/lib/membership.ts), inline errors + an announced summary,
 * Turnstile, loading state, and generic error messages.
 */
import { attachTurnstile } from './turnstile';
import {
  FIELDS,
  validateAge,
  validateConsent,
  validateName,
  validatePhone,
  validateWilaya,
  type ErrorCode,
  type Field,
} from '../lib/membership';

const PAGE_LOADED_AT = Date.now();

export interface ApiBody {
  ok?: boolean;
  error?: string;
  fields?: Partial<Record<Field, ErrorCode>>;
  [key: string]: unknown;
}

export interface MemberFormOptions {
  endpoint: string;
  /** Extra JSON fields (e.g. tripId). */
  extraPayload?: () => Record<string, unknown>;
  onSuccess: (body: ApiBody) => void;
}

/**
 * Error messages come from the form's data-error-messages JSON:
 * { default, rate_limited, captcha, …any API error code }.
 */
export function setupMemberForm(form: HTMLFormElement, opts: MemberFormOptions): void {
  const messages = JSON.parse(form.dataset.messages ?? '{}') as Record<ErrorCode, string>;
  const labels = JSON.parse(form.dataset.labels ?? '{}') as Record<Field, string>;
  const apiErrors = JSON.parse(form.dataset.errorMessages ?? '{}') as Record<string, string>;
  const summary = form.querySelector<HTMLElement>('[data-error-summary]')!;
  const list = form.querySelector<HTMLUListElement>('[data-error-list]')!;
  const submit = form.querySelector<HTMLButtonElement>('[data-submit]')!;
  const submitLabel = form.querySelector<HTMLElement>('[data-submit-label]')!;
  const idleLabel = submitLabel.textContent ?? '';
  const failure = form.querySelector<HTMLElement>('[data-failure]')!;
  const failureText = form.querySelector<HTMLElement>('[data-failure-text]')!;
  const turnstile = attachTurnstile(form);
  const touched = new Set<Field>();

  const input = (field: Field) => form.querySelector<HTMLInputElement | HTMLSelectElement>(`[data-field="${field}"]`)!;

  const validators: Record<Field, () => ErrorCode | null> = {
    fullName: () => validateName(input('fullName').value),
    phone: () => validatePhone(input('phone').value),
    wilaya: () => validateWilaya(input('wilaya').value),
    age: () => validateAge(input('age').value),
    consent: () => validateConsent((input('consent') as HTMLInputElement).checked),
  };

  function show(field: Field, code: ErrorCode | null) {
    const el = input(field);
    const error = form.querySelector<HTMLElement>(`[data-error-for="${field}"]`)!;
    if (code) {
      el.setAttribute('aria-invalid', 'true');
      error.textContent = messages[code] ?? code;
      error.hidden = false;
    } else {
      el.removeAttribute('aria-invalid');
      error.textContent = '';
      error.hidden = true;
    }
  }

  function check(field: Field): ErrorCode | null {
    const code = validators[field]();
    show(field, code);
    return code;
  }

  function renderSummary(errors: [Field, ErrorCode][]) {
    list.replaceChildren(
      ...errors.map(([field, code]) => {
        const li = document.createElement('li');
        const a = document.createElement('a');
        a.href = `#${input(field).id}`;
        a.textContent = `${labels[field]}: ${messages[code]}`;
        a.addEventListener('click', (e) => {
          e.preventDefault();
          input(field).focus();
        });
        li.append(a);
        return li;
      }),
    );
    summary.hidden = errors.length === 0;
  }

  for (const field of FIELDS) {
    const el = input(field);
    el.addEventListener('blur', () => {
      if (el.value !== '' || touched.has(field) || field === 'consent') {
        touched.add(field);
        check(field);
      }
    });
    el.addEventListener(field === 'consent' || field === 'wilaya' ? 'change' : 'input', () => {
      if (el.getAttribute('aria-invalid') === 'true') check(field);
    });
  }

  function setBusy(busy: boolean) {
    submit.disabled = busy;
    submit.setAttribute('aria-busy', String(busy));
    submitLabel.textContent = busy ? (form.dataset.sending ?? idleLabel) : idleLabel;
  }

  function fail(message: string) {
    failureText.textContent = message;
    failure.hidden = false;
  }

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    failure.hidden = true;

    const errors: [Field, ErrorCode][] = [];
    for (const field of FIELDS) {
      touched.add(field);
      const code = check(field);
      if (code) errors.push([field, code]);
    }
    renderSummary(errors);
    if (errors.length) {
      summary.focus();
      return;
    }

    setBusy(true);
    const data = new FormData(form);
    const payload = {
      fullName: String(data.get('fullName') ?? ''),
      phone: String(data.get('phone') ?? ''),
      wilaya: String(data.get('wilaya') ?? ''),
      age: String(data.get('age') ?? ''),
      consent: (input('consent') as HTMLInputElement).checked,
      lang: form.dataset.lang === 'en' ? 'en' : 'ar',
      sourcePage: window.location.pathname,
      website: String(data.get('website') ?? ''),
      startedAt: PAGE_LOADED_AT,
      turnstileToken: await turnstile.token(),
      ...opts.extraPayload?.(),
    };

    try {
      const res = await fetch(opts.endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const body = (await res.json().catch(() => ({}))) as ApiBody;

      if (res.ok && body.ok) {
        opts.onSuccess(body);
        return;
      }
      if (res.status === 400 && body.error === 'validation' && body.fields) {
        const serverErrors = Object.entries(body.fields) as [Field, ErrorCode][];
        serverErrors.forEach(([field, code]) => show(field, code));
        renderSummary(serverErrors);
        summary.focus();
        return;
      }
      const code = res.status === 429 ? 'rate_limited' : (body.error ?? 'default');
      fail(apiErrors[code] ?? apiErrors.default ?? '');
      turnstile.reset(); // tokens are single-use
    } catch {
      fail(apiErrors.default ?? '');
    } finally {
      setBusy(false);
    }
  });
}
