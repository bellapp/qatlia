import type { Metadata } from 'next';

/** The operator back office must never be indexed or previewed. */
export const metadata: Metadata = {
  title: 'QatlIA — Back office',
  robots: { index: false, follow: false, nocache: true },
};

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return children;
}
