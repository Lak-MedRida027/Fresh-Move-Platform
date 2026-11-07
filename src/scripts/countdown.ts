/** Live "time left" for [data-countdown] elements (registration deadline). */
document.querySelectorAll<HTMLElement>('[data-countdown]').forEach((el) => {
  const deadline = Date.parse(el.dataset.countdown ?? '');
  const days = el.dataset.templateDays ?? '';
  const soon = el.dataset.templateSoon ?? '';
  if (Number.isNaN(deadline)) return;
  const tick = () => {
    const ms = deadline - Date.now();
    if (ms <= 0) {
      el.textContent = el.dataset.closed ?? '';
      return;
    }
    const minutes = Math.floor(ms / 60_000);
    const d = Math.floor(minutes / 1440);
    const h = Math.floor((minutes % 1440) / 60);
    const m = minutes % 60;
    el.textContent = (d > 0 ? days : soon)
      .replace('{days}', String(d))
      .replace('{hours}', String(h))
      .replace('{minutes}', String(m));
  };
  tick();
  window.setInterval(tick, 30_000);
});

export {};
