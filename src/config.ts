export interface VideoConfig {
  title: string;
  /** URL assoluto o path sotto /public. */
  src: string;
}

/**
 * Mappa id -> video. Per aggiungere un video basta una nuova voce qui.
 * La sorgente può essere sovrascritta con la env VIDEO_SRC_<ID> (vedi getVideo).
 */
export const videos: Record<string, VideoConfig> = {
  sample: { title: 'Video di prova', src: '/sample.mp4' },
  dado: { title: 'Dado', src: '/dado.mp4' },
};

export const VIDEO_ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

function envKey(id: string): string {
  return `VIDEO_SRC_${id.toUpperCase().replace(/[^A-Z0-9]/g, '_')}`;
}

export function getVideo(id: string): VideoConfig | null {
  if (!VIDEO_ID_RE.test(id)) return null;
  const fromEnv = process.env[envKey(id)];
  const configured = Object.prototype.hasOwnProperty.call(videos, id) ? videos[id] : undefined;
  if (fromEnv) return { title: configured?.title ?? id, src: fromEnv };
  return configured ?? null;
}
