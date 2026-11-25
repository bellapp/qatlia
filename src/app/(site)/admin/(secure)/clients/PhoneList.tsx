/**
 * Every phone number known for an account, each with where it comes from
 * (spec 2026-11-25): the operator's note, the WhatsApp number the account
 * came from, the « Mon entreprise » phone. The same number twice is shown once.
 */

const digits = (phone: string) => phone.replace(/\D/g, '').replace(/^(00212|212|00|0)/, '');

export function PhoneList({ note, whatsapp, atelier }: { note: string | null; whatsapp: string | null; atelier: string | null }) {
  const entries: { phone: string; origin: string; href: string | null }[] = [];
  const seen = new Set<string>();
  const add = (phone: string | null, origin: string, href: string | null) => {
    if (!phone) return;
    const key = digits(phone) || phone;
    if (seen.has(key)) {
      // Already listed: name the extra origin on the same line.
      const existing = entries.find((entry) => (digits(entry.phone) || entry.phone) === key);
      if (existing) existing.origin = `${existing.origin}, ${origin}`;
      return;
    }
    seen.add(key);
    entries.push({ phone, origin, href });
  };

  add(note, 'note', null);
  add(whatsapp, 'WhatsApp', whatsapp && whatsapp.startsWith('+') ? `https://wa.me/${whatsapp.slice(1)}` : null);
  add(atelier, 'entreprise', null);

  if (entries.length === 0) return <span className="text-slate-500">—</span>;
  return (
    <ul className="space-y-0.5">
      {entries.map((entry) => (
        <li key={entry.phone} className="whitespace-nowrap">
          {entry.href ? (
            <a href={entry.href} target="_blank" rel="noopener noreferrer" dir="ltr" className="text-emerald-400 hover:underline">
              {entry.phone}
            </a>
          ) : (
            <span dir="ltr">{entry.phone}</span>
          )}
          <span className="text-[10px] text-slate-500"> · {entry.origin}</span>
        </li>
      ))}
    </ul>
  );
}
