/**
 * Trip filters: terrain + region radios. Keeps the choice in the URL
 * (?terrain=…&region=…) so filtered views can be shared and the region cards
 * on the home page can link straight to a filtered list.
 */
const form = document.querySelector<HTMLFormElement>('[data-trip-filters]');
const items = Array.from(document.querySelectorAll<HTMLElement>('[data-trip]'));
const countEl = document.querySelector<HTMLElement>('[data-trip-count]');
const emptyEl = document.querySelector<HTMLElement>('[data-trip-empty]');

function selected(name: string): string {
  const input = form?.querySelector<HTMLInputElement>(`input[name="${name}"]:checked`);
  return input?.value ?? '';
}

function select(name: string, value: string): void {
  const input =
    form?.querySelector<HTMLInputElement>(`input[name="${name}"][value="${CSS.escape(value)}"]`) ??
    form?.querySelector<HTMLInputElement>(`input[name="${name}"][value=""]`);
  if (input) input.checked = true;
}

function apply(updateUrl: boolean): void {
  if (!form) return;
  const terrain = selected('terrain');
  const region = selected('region');
  let visible = 0;
  for (const item of items) {
    const terrains = (item.dataset.terrainList ?? '').split(' ');
    const show = (!terrain || terrains.includes(terrain)) && (!region || item.dataset.region === region);
    item.hidden = !show;
    if (show) visible++;
  }
  const template = form.dataset.countTemplate ?? '{count}';
  if (countEl) countEl.textContent = template.replace('{count}', String(visible));
  if (emptyEl) emptyEl.hidden = visible > 0;

  if (updateUrl) {
    const url = new URL(window.location.href);
    if (terrain) url.searchParams.set('terrain', terrain);
    else url.searchParams.delete('terrain');
    if (region) url.searchParams.set('region', region);
    else url.searchParams.delete('region');
    window.history.replaceState(null, '', url);
  }
}

if (form) {
  const params = new URLSearchParams(window.location.search);
  select('terrain', params.get('terrain') ?? '');
  select('region', params.get('region') ?? '');
  apply(false);
  form.addEventListener('change', () => apply(true));
  form.addEventListener('submit', (e) => e.preventDefault());
  form.addEventListener('reset', () => {
    // Let the browser reset the radios first, then re-apply.
    window.setTimeout(() => apply(true), 0);
  });
}

export {};
