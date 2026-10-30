/** Server-rendered JSON-LD blocks, one <script> per schema.org object. */
export function JsonLd({ blocks }: { blocks: Record<string, unknown>[] }) {
  return (
    <>
      {blocks.map((block) => (
        <script
          key={String(block['@type'])}
          type="application/ld+json"
          // Escape "<" so a future copy edit can never close the script tag early.
          dangerouslySetInnerHTML={{ __html: JSON.stringify(block).replace(/</g, '\\u003c') }}
        />
      ))}
    </>
  );
}
