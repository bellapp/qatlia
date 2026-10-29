import type { Metadata } from 'next';
import { LegalPage } from '@/components/LegalPage';
import { legalMetadata } from '@/lib/legal';

export const metadata: Metadata = legalMetadata('privacy');

export default function Page() {
  return <LegalPage doc="privacy" />;
}
