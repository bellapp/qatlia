import { notFound } from 'next/navigation';

// With two root layouts there is no top-level one to wrap an unknown URL, so Next
// would serve a bare 404. Catching every unmatched path here renders it inside the
// main site layout instead; any real route still matches first.
export default function CatchAllNotFound() {
  notFound();
}
