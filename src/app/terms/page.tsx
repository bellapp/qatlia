import type { Metadata } from 'next';
import { LegalPage } from '@/components/LegalPage';
import { legalMetadata } from '@/lib/legal';

export const metadata: Metadata = legalMetadata('terms');

export default function Page() {
  return <LegalPage doc="terms" />;
}
