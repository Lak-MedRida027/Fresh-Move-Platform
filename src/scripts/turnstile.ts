/**
 * Cloudflare Turnstile, loaded lazily: the script is injected the first time a
 * person interacts with a protected form (no cost on page load). Renders the
 * widget into [data-turnstile] in the page language and theme.
 */
interface TurnstileApi {
  render: (el: HTMLElement, opts: Record<string, unknown>) => string;
  reset: (id?: string) => void;
}
declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

const SCRIPT = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
let loading: Promise<TurnstileApi> | null = null;

function loadScript(): Promise<TurnstileApi> {
  loading ??= new Promise((resolve, reject) => {
    if (window.turnstile) return resolve(window.turnstile);
    const s = document.createElement('script');
    s.src = SCRIPT;
    s.async = true;
    s.onload = () => (window.turnstile ? resolve(window.turnstile) : reject(new Error('turnstile missing')));
    s.onerror = () => {
      loading = null;
      reject(new Error('turnstile failed to load'));
    };
    document.head.append(s);
  });
  return loading;
}

export interface TurnstileHandle {
  /** Resolves with a token (waits up to `timeoutMs` for the challenge to finish). */
  token: (timeoutMs?: number) => Promise<string>;
  reset: () => void;
}

/** Attach Turnstile to a form; starts on first focus/input inside it. */
export function attachTurnstile(form: HTMLFormElement): TurnstileHandle {
  const box = form.querySelector<HTMLElement>('[data-turnstile]');
  let current = '';
  let widgetId: string | undefined;
  let waiters: ((t: string) => void)[] = [];

  const start = async () => {
    if (!box || widgetId !== undefined) return;
    widgetId = '';
    try {
      const api = await loadScript();
      widgetId = api.render(box, {
        sitekey: box.dataset.sitekey,
        language: document.documentElement.lang.startsWith('ar') ? 'ar' : 'en',
        theme: document.documentElement.dataset.theme === 'light' ? 'light' : 'dark',
        size: 'flexible',
        callback: (t: string) => {
          current = t;
          waiters.forEach((w) => w(t));
          waiters = [];
        },
        'expired-callback': () => {
          current = '';
        },
      });
    } catch {
      widgetId = undefined; // allow a retry on the next interaction
    }
  };
  form.addEventListener('focusin', start, { once: false });
  form.addEventListener('pointerdown', start, { once: false });

  return {
    token: (timeoutMs = 10_000) => {
      void start();
      if (current) return Promise.resolve(current);
      return new Promise((resolve) => {
        const timer = setTimeout(() => resolve(''), timeoutMs);
        waiters.push((t) => {
          clearTimeout(timer);
          resolve(t);
        });
      });
    },
    reset: () => {
      current = '';
      if (widgetId) window.turnstile?.reset(widgetId);
    },
  };
}
