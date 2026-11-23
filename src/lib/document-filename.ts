// File names of the printed documents (cut plan, quotation).
//
// A Content-Disposition header carries two names: a plain-ASCII `filename`
// (safe for any client — a header value must be a Latin-1 ByteString, so a
// non-ASCII name would otherwise throw and 500 the export) and an RFC 5987
// `filename*` that carries the exact UTF-8 name. Both are built here.
import { encodeRfc5987Filename, sanitizeQuoteNumberForFilename } from '@/lib/quotation';

export interface DocumentFileNames {
  ascii: string;
  utf8: string;
}

const DEFAULT_PREFIX = 'QatliA';
const ASCII_PREFIX_MAX_LENGTH = 40;

/** Both prefixes for a company name, each falling back to `QatliA` when nothing usable survives. */
function prefixesFor(companyName: string | null | undefined): DocumentFileNames {
  const company = companyName?.trim() ?? '';
  return {
    ascii: (company && asciiCompanyPrefix(company)) || DEFAULT_PREFIX,
    utf8: (company && utf8CompanyPrefix(company)) || DEFAULT_PREFIX,
  };
}

/** Company name as an ASCII-only file name prefix; '' when nothing printable survives. */
function asciiCompanyPrefix(companyName: string): string {
  // Strip first, then join the words: an Arabic-only name must end up empty
  // (not a lone `_`) so the caller falls back to `QatliA`.
  return companyName
    .replace(/[^A-Za-z0-9._\s-]/g, '')
    .trim()
    .replace(/\s+/g, '_')
    .slice(0, ASCII_PREFIX_MAX_LENGTH);
}

/** Company name as a UTF-8 file name prefix: spaces become `_`, header/path-breaking characters go. */
function utf8CompanyPrefix(companyName: string): string {
  return companyName
    .trim()
    .replace(/\s+/g, '_')
    .replace(/["\\;\r\n/]/g, '');
}

/**
 * `{Company}_{PROJECT}.pdf`, or `QatliA_{PROJECT}.pdf` with no company. With no
 * company the result is exactly the name the export has always produced.
 */
export function cutPlanFileNames(projectName: string, companyName?: string | null): DocumentFileNames {
  const asciiProjectName =
    projectName
      .toUpperCase()
      .replace(/[^\x20-\x7E]/g, '')
      .trim()
      .replace(/\s+/g, '_') || 'EXPORT';
  const utf8ProjectName = projectName.toUpperCase().replace(/\s+/g, '_');

  const prefix = prefixesFor(companyName);
  return {
    ascii: `${prefix.ascii}_${asciiProjectName}.pdf`,
    utf8: `${prefix.utf8}_${utf8ProjectName}.pdf`,
  };
}

/** `{Company}_Devis_{number}.pdf`. */
export function quotationFileNames(quoteNumber: string, companyName: string): DocumentFileNames {
  const prefix = prefixesFor(companyName);
  const number = sanitizeQuoteNumberForFilename(quoteNumber);
  return {
    ascii: `${prefix.ascii}_Devis_${number}.pdf`,
    utf8: `${prefix.utf8}_Devis_${number}.pdf`,
  };
}

export function contentDispositionFor(names: DocumentFileNames): string {
  return `attachment; filename="${names.ascii}"; filename*=UTF-8''${encodeRfc5987Filename(names.utf8)}`;
}

/** The file name a Content-Disposition header proposes: `filename*` first, then `filename`. */
export function fileNameFromContentDisposition(header: string | null): string | null {
  if (!header) return null;
  const extended = /filename\*\s*=\s*UTF-8''([^;\s]+)/i.exec(header);
  if (extended) {
    try {
      return decodeURIComponent(extended[1]);
    } catch {
      // Malformed percent-encoding: fall through to the plain filename.
    }
  }
  const plain = /filename\s*=\s*"([^"]*)"/i.exec(header);
  return plain ? plain[1] : null;
}
