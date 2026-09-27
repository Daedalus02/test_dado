export type VideoSource =
  /** Video HTML5 diretto: URL assoluto o path sotto /public. */
  | { type: 'html5'; src: string }
  /** Embed YouTube (IFrame Player API). `duration` (s) è il fallback se il player riporta 0. */
  | { type: 'youtube'; youtubeId: string; duration: number };

export type VideoConfig = VideoSource & { title: string };

/**
 * Mappa id -> video. Per aggiungere un video basta una nuova voce qui.
 * La sorgente può essere sovrascritta con la env VIDEO_SRC_<ID> (vedi getVideo): l'override
 * è sempre un video HTML5, anche se la voce configurata è YouTube.
 */
export const videos: Record<string, VideoConfig> = {
  sample: { title: 'Video di prova', type: 'html5', src: '/sample.mp4' },
  dado: { title: 'Dado', type: 'youtube', youtubeId: 'Oo1fQ7Oo12Q', duration: 10 },
};

export const VIDEO_ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

function envKey(id: string): string {
  return `VIDEO_SRC_${id.toUpperCase().replace(/[^A-Z0-9]/g, '_')}`;
}

export function getVideo(id: string): VideoConfig | null {
  if (!VIDEO_ID_RE.test(id)) return null;
  const fromEnv = process.env[envKey(id)];
  const configured = Object.prototype.hasOwnProperty.call(videos, id) ? videos[id] : undefined;
  if (fromEnv) return { title: configured?.title ?? id, type: 'html5', src: fromEnv };
  return configured ?? null;
}
