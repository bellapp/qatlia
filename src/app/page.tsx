import type { Metadata } from 'next';
import LandingPage from './landing-page';
import { landingJsonLd } from '@/lib/seo';

// Canonical on the home page only: set in the root layout it would make every page
// (atelier, credits…) declare itself a copy of the home page.
export const metadata: Metadata = { alternates: { canonical: '/' } };

export default function Page() {
  return (
    <>
      {landingJsonLd().map((block) => (
        <script
          key={String(block['@type'])}
          type="application/ld+json"
          // Escape "<" so a future copy edit can never close the script tag early.
          dangerouslySetInnerHTML={{ __html: JSON.stringify(block).replace(/</g, '\\u003c') }}
        />
      ))}
      <LandingPage />
    </>
  );
}
