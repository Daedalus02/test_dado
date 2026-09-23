/** Paesi in cui mostrare il banner in modalità "eu": UE + SEE + Regno Unito. */
const GDPR_COUNTRIES = new Set([
  'AT', 'BE', 'BG', 'HR', 'CY', 'CZ', 'DK', 'EE', 'FI', 'FR', 'DE', 'GR', 'HU', 'IE',
  'IT', 'LV', 'LT', 'LU', 'MT', 'NL', 'PL', 'PT', 'RO', 'SK', 'SI', 'ES', 'SE',
  'IS', 'LI', 'NO', 'GB',
]);

type BannerMode = 'eu' | 'always' | 'off';

function bannerMode(): BannerMode {
  const mode = process.env.CONSENT_BANNER;
  return mode === 'always' || mode === 'off' ? mode : 'eu';
}

/**
 * In modalità "eu" il banner compare per paesi GDPR e quando il paese è sconosciuto
 * (es. in locale o fuori da Vercel): nel dubbio si chiede il consenso.
 */
export function shouldShowConsentBanner(country: string | null): boolean {
  const mode = bannerMode();
  if (mode === 'always') return true;
  if (mode === 'off') return false;
  return country === null || GDPR_COUNTRIES.has(country);
}
