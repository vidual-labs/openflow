// localStorage / sessionStorage access that never throws.
//
// Merely reading `window.localStorage` throws a SecurityError when the browser
// blocks site data for the page — e.g. a form embedded on another site while
// the visitor blocks third-party cookies, or "block all cookies" settings. An
// uncaught throw in an effect unmounts the whole React tree, so the visitor got
// a blank page instead of the form. These helpers treat blocked storage like
// empty storage: nothing is remembered, everything else keeps working.

function storageOf(kind) {
  try {
    return kind === 'session' ? window.sessionStorage : window.localStorage;
  } catch {
    return null;
  }
}

export function readStorage(kind, key) {
  try {
    return storageOf(kind)?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

// Returns true when the value was stored.
export function writeStorage(kind, key, value) {
  try {
    const storage = storageOf(kind);
    if (!storage) return false;
    storage.setItem(key, value);
    return true;
  } catch {
    return false;
  }
}
