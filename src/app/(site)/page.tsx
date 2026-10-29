import type { Metadata } from 'next';
import LandingPage from '../landing-page';
import { JsonLd } from '@/components/JsonLd';
import { LANDING_ALTERNATES, LANDING_PATHS, landingJsonLd } from '@/lib/seo';

// Canonical on the home page only: set in the root layout it would make every page
// (atelier, credits…) declare itself a copy of the home page.
export const metadata: Metadata = {
  alternates: { canonical: LANDING_PATHS.fr, languages: LANDING_ALTERNATES },
};

export default function Page() {
  return (
    <>
      <JsonLd blocks={landingJsonLd('fr')} />
      <LandingPage />
    </>
  );
}
