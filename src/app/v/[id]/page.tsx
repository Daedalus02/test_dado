import type { Metadata } from 'next';
import { headers } from 'next/headers';
import { notFound } from 'next/navigation';
import { ConsentBanner } from '@/components/ConsentBanner';
import { TrackedVideo } from '@/components/TrackedVideo';
import { getVideo } from '@/config';
import { shouldShowConsentBanner } from '@/lib/consent';
import { clientCountry, logHit } from '@/lib/hits';

export const dynamic = 'force-dynamic';

interface Props {
  params: { id: string };
  searchParams: { s?: string | string[] };
}

export function generateMetadata({ params }: Props): Metadata {
  return { title: getVideo(params.id)?.title ?? 'Video', robots: { index: false } };
}

export default async function VideoPage({ params, searchParams }: Props) {
  const video = getVideo(params.id);
  if (!video) notFound();

  const source = typeof searchParams.s === 'string' ? searchParams.s : null;
  const requestHeaders = headers();

  // L'accesso viene registrato prima del render.
  const hitId = await logHit(params.id, source, requestHeaders);
  const showBanner = shouldShowConsentBanner(clientCountry(requestHeaders));

  return (
    <main className="video-page">
      <TrackedVideo videoId={params.id} source={video} hitId={hitId} requireConsent={showBanner} />
      {showBanner && <ConsentBanner />}
    </main>
  );
}
