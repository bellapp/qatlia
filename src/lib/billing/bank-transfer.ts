/**
 * The bank account a customer pays into by transfer.
 *
 * The details live in server environment variables, never in this public
 * repository: they are sent only by /api/credits/manual, to a signed-in
 * customer who has just created (or still has) a transfer order.
 *
 *   BANK_TRANSFER_IBAN       Moroccan IBAN, spaces allowed (MA + 2 check digits + 24-digit RIB)
 *   BANK_TRANSFER_BIC        BIC / SWIFT code
 *   BANK_TRANSFER_HOLDER     account holder, as the bank prints it
 *   BANK_TRANSFER_BANK_NAME  optional, e.g. "Bank of Africa"
 *
 * A malformed IBAN disables the block rather than showing a customer a wrong
 * account: the order flow then reads exactly as it did before.
 */

type Env = Record<string, string | undefined>;

export interface BankTransferDetails {
  holder: string;
  bankName: string | null;
  /** 24-digit Moroccan RIB, grouped as the banks print it (3 · 3 · 16 · 2). */
  rib: string;
  /** IBAN grouped by four. */
  iban: string;
  bic: string;
}

/** ISO 13616 check: move the first four characters to the end, letters to numbers, mod 97 = 1. */
export function isValidIban(compactIban: string): boolean {
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{10,30}$/.test(compactIban)) return false;
  const rearranged = compactIban.slice(4) + compactIban.slice(0, 4);
  let remainder = 0;
  for (const char of rearranged) {
    const digits = /\d/.test(char) ? char : String(char.charCodeAt(0) - 55);
    for (const digit of digits) remainder = (remainder * 10 + Number(digit)) % 97;
  }
  return remainder === 1;
}

const compact = (value: string | undefined) => (value ?? '').replace(/\s+/g, '').toUpperCase();

export function readBankTransferDetails(env: Env = process.env): BankTransferDetails | null {
  const iban = compact(env.BANK_TRANSFER_IBAN);
  const bic = compact(env.BANK_TRANSFER_BIC);
  const holder = (env.BANK_TRANSFER_HOLDER ?? '').trim();
  const bankName = (env.BANK_TRANSFER_BANK_NAME ?? '').trim() || null;

  if (!iban && !bic && !holder) return null; // not configured: nothing to show
  if (!/^MA\d{26}$/.test(iban) || !isValidIban(iban) || !/^[A-Z0-9]{8}([A-Z0-9]{3})?$/.test(bic) || !holder) {
    console.error('BANK_TRANSFER_* is set but invalid: the bank details are not shown.');
    return null;
  }

  const rib = iban.slice(4);
  return {
    holder,
    bankName,
    rib: `${rib.slice(0, 3)} ${rib.slice(3, 6)} ${rib.slice(6, 22)} ${rib.slice(22)}`,
    iban: iban.replace(/(.{4})(?=.)/g, '$1 '),
    bic,
  };
}
