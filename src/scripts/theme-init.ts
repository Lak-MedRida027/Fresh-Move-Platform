/**
 * Theme bootstrap. Rendered inline in <head> (before first paint) so there is
 * no flash of the wrong theme. The CSP in vercel.json allows exactly this
 * script by its SHA-256 hash; tests/unit/csp.test.ts fails if they drift.
 * Keep it ES5 and tiny. localStorage can throw in in-app browsers.
 */
export const THEME_STORAGE_KEY = 'fm-theme';

export const THEME_INIT_SCRIPT =
  "(function(){var d=document.documentElement,t=null;try{t=localStorage.getItem('fm-theme')}catch(e){}if(t!=='light'&&t!=='dark'){t=window.matchMedia&&window.matchMedia('(prefers-color-scheme: light)').matches?'light':'dark'}d.setAttribute('data-theme',t);d.className+=' js'})();";
