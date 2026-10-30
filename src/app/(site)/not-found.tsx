// Same content as Next's built-in 404, which the site served before it had two root
// layouts; declaring it inside `(site)` keeps the page in that layout (lang, styles).
export default function NotFound() {
  return (
    <div className="min-h-screen flex items-center justify-center gap-4 text-sm">
      <h1 className="text-2xl font-semibold pe-4 border-e border-slate-300 dark:border-studio-border">404</h1>
      <h2>This page could not be found.</h2>
    </div>
  );
}
