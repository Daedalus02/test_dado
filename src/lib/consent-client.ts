// Preferenza di consenso salvata nel browser (preferenza tecnica, non tracciamento).

export type Consent = 'accepted' | 'declined' | null;

const KEY = 'vt-consent';
const EVENT = 'vt-consent-change';

export function getConsent(): Consent {
  try {
    const value = localStorage.getItem(KEY);
    return value === 'accepted' || value === 'declined' ? value : null;
  } catch {
    return null;
  }
}

export function setConsent(value: Exclude<Consent, null>): void {
  try {
    localStorage.setItem(KEY, value);
  } catch {
    // storage non disponibile: la scelta vale solo per questa pagina
  }
  window.dispatchEvent(new CustomEvent<Consent>(EVENT, { detail: value }));
}

export function onConsentChange(cb: (value: Consent) => void): () => void {
  const handler = (e: Event) => cb((e as CustomEvent<Consent>).detail);
  window.addEventListener(EVENT, handler);
  return () => window.removeEventListener(EVENT, handler);
}
