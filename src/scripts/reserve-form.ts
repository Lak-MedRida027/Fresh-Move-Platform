/** Reservation form → POST /api/reserve, then the success screen with the code. */
import { setupMemberForm, type ApiBody } from './member-form';

interface ReserveBody extends ApiBody {
  code: string;
  status: 'pending' | 'waitlist' | 'confirmed';
  holdExpiresAt: string | null;
  existing: boolean;
}

const lang = document.documentElement.lang.startsWith('ar') ? 'ar-DZ' : 'en-GB';
const formatHold = (iso: string) =>
  new Intl.DateTimeFormat(lang, {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone: 'Africa/Algiers',
  }).format(new Date(iso));

document.querySelectorAll<HTMLFormElement>('[data-reserve-form]').forEach((form) => {
  const root = form.closest<HTMLElement>('[data-reserve-root]')!;
  const done = root.querySelector<HTMLElement>('[data-success]')!;
  const text = JSON.parse(form.dataset.successText ?? '{}') as Record<string, string>;
  const statusLabels = JSON.parse(form.dataset.statusLabels ?? '{}') as Record<string, string>;
  const $ = <T extends HTMLElement>(sel: string) => done.querySelector<T>(sel)!;

  setupMemberForm(form, {
    endpoint: '/api/reserve',
    extraPayload: () => ({ tripId: form.dataset.tripId }),
    onSuccess: (raw) => {
      const body = raw as ReserveBody;
      $('[data-success-title]').textContent = text[body.status] ?? text.pending ?? '';
      $('[data-existing]').hidden = !body.existing;
      $('[data-code]').textContent = body.code;
      $('[data-status]').textContent = statusLabels[body.status] ?? body.status;
      const hold = $('[data-hold]');
      if (body.status === 'pending' && body.holdExpiresAt) {
        hold.textContent = (text.holdUntil ?? '{date}').replace('{date}', formatHold(body.holdExpiresAt));
        hold.hidden = false;
      }
      $('[data-next-pending]').hidden = body.status !== 'pending';
      $('[data-next-waitlist]').hidden = body.status !== 'waitlist';

      const copy = $<HTMLButtonElement>('[data-copy]');
      const copyLabel = $('[data-copy-label]');
      copy.addEventListener('click', async () => {
        try {
          await navigator.clipboard.writeText(body.code);
          copyLabel.textContent = text.copied ?? '✓';
          setTimeout(() => (copyLabel.textContent = text.copy ?? ''), 2500);
        } catch {
          // Clipboard blocked (some in-app browsers): select the code instead.
          const range = document.createRange();
          range.selectNodeContents($('[data-code]'));
          window.getSelection()?.removeAllRanges();
          window.getSelection()?.addRange(range);
        }
      });

      root.querySelector<HTMLElement>('[data-reserve-intro]')!.hidden = true;
      root.querySelector<HTMLElement>('#reserve-title')!.hidden = true;
      form.hidden = true;
      done.hidden = false;
      $('[data-success-title]').focus();
    },
  });
});
