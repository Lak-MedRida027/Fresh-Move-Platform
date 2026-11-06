/**
 * Accessible gallery lightbox built on <dialog>.
 * - showModal() makes the rest of the page inert (focus stays inside).
 * - Esc closes (native), arrows navigate (mirrored in RTL), swipe on touch.
 * - Focus returns to the thumbnail that opened it.
 */
const dialog = document.querySelector<HTMLDialogElement>('[data-lightbox]');
const items = Array.from(document.querySelectorAll<HTMLButtonElement>('[data-gallery-item]'));

if (dialog && items.length) {
  const img = dialog.querySelector<HTMLImageElement>('[data-lightbox-img]')!;
  const counter = dialog.querySelector<HTMLElement>('[data-lightbox-counter]')!;
  const template = dialog.dataset.counterTemplate ?? '{n} / {total}';
  const rtl = document.documentElement.dir === 'rtl';
  let index = 0;
  let opener: HTMLButtonElement | null = null;

  const show = (i: number) => {
    index = (i + items.length) % items.length;
    const item = items[index]!;
    img.src = item.dataset.full ?? '';
    img.alt = item.dataset.alt ?? '';
    counter.textContent = template.replace('{n}', String(index + 1)).replace('{total}', String(items.length));
  };
  const next = () => show(index + 1);
  const prev = () => show(index - 1);

  const open = (i: number, from: HTMLButtonElement) => {
    opener = from;
    show(i);
    dialog.showModal();
    dialog.querySelector<HTMLButtonElement>('[data-lightbox-close]')?.focus();
  };

  items.forEach((item, i) => item.addEventListener('click', () => open(i, item)));
  dialog.querySelector('[data-lightbox-close]')?.addEventListener('click', () => dialog.close());
  dialog.querySelector('[data-lightbox-next]')?.addEventListener('click', next);
  dialog.querySelector('[data-lightbox-prev]')?.addEventListener('click', prev);

  dialog.addEventListener('close', () => {
    img.removeAttribute('src');
    opener?.focus();
  });

  // Click on the dark area (not the photo or a button) closes.
  dialog.addEventListener('click', (e) => {
    const target = e.target as HTMLElement;
    if (target === dialog || target.classList.contains('lightbox__frame')) dialog.close();
  });

  dialog.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowRight') {
      e.preventDefault();
      if (rtl) prev();
      else next();
    } else if (e.key === 'ArrowLeft') {
      e.preventDefault();
      if (rtl) next();
      else prev();
    } else if (e.key === 'Home') {
      e.preventDefault();
      show(0);
    } else if (e.key === 'End') {
      e.preventDefault();
      show(items.length - 1);
    } else if (e.key === 'Tab') {
      // Keep Tab cycling inside the dialog (some in-app browsers don't trap it).
      const focusables = Array.from(dialog.querySelectorAll<HTMLElement>('button'));
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last?.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first?.focus();
      }
    }
  });

  // Swipe: left/right, mirrored in RTL.
  let startX = 0;
  let startY = 0;
  let tracking = false;
  dialog.addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'mouse') return;
    tracking = true;
    startX = e.clientX;
    startY = e.clientY;
  });
  dialog.addEventListener('pointerup', (e) => {
    if (!tracking) return;
    tracking = false;
    const dx = e.clientX - startX;
    const dy = e.clientY - startY;
    if (Math.abs(dx) < 50 || Math.abs(dx) < Math.abs(dy)) return;
    const forward = rtl ? dx > 0 : dx < 0;
    if (forward) next();
    else prev();
  });
  dialog.addEventListener('pointercancel', () => {
    tracking = false;
  });
}

export {};
