/** Membership form → POST /api/join. */
import { setupMemberForm } from './member-form';

document.querySelectorAll<HTMLFormElement>('[data-join-form]').forEach((form) => {
  const root = form.closest<HTMLElement>('[data-join-root]')!;
  const success = root.querySelector<HTMLElement>('[data-success]')!;
  setupMemberForm(form, {
    endpoint: '/api/join',
    onSuccess: () => {
      form.hidden = true;
      success.hidden = false;
      success.querySelector<HTMLElement>('[data-success-title]')?.focus();
    },
  });
});
