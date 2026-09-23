'use client';

import { useEffect, useState } from 'react';
import { getConsent, setConsent } from '@/lib/consent-client';

export function ConsentBanner() {
  // Nascosto al primo render per evitare mismatch di idratazione con localStorage.
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    setVisible(getConsent() === null);
  }, []);

  if (!visible) return null;

  const choose = (value: 'accepted' | 'declined') => {
    setConsent(value);
    setVisible(false);
  };

  return (
    <div className="consent" role="dialog" aria-live="polite" aria-label="Informativa privacy">
      <p>
        Registriamo l&apos;accesso a questa pagina (IP, browser, provenienza) a fini statistici.
        <br />
        Raccogliamo dati aggregati di visione (quanto del video viene guardato), senza login né
        identificativi personali.
      </p>
      <div className="consent-actions">
        <button type="button" className="secondary" onClick={() => choose('declined')}>
          Rifiuta
        </button>
        <button type="button" onClick={() => choose('accepted')}>
          Accetta
        </button>
      </div>
    </div>
  );
}
