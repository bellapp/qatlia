import type { Metadata } from 'next';
import LandingPage from '../../landing-page';
import { JsonLd } from '@/components/JsonLd';
import { LANDING_ALTERNATES, LANDING_PATHS, landingJsonLd } from '@/lib/seo';

export const metadata: Metadata = {
  alternates: { canonical: LANDING_PATHS.ar, languages: LANDING_ALTERNATES },
};

export default function ArabicLandingPage() {
  return (
    <>
      <JsonLd blocks={landingJsonLd('ar')} />
      <LandingPage homeHref={LANDING_PATHS.ar} />
    </>
  );
}
