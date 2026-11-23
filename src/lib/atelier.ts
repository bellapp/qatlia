// The account's "business identity" (« Mon entreprise »): the company details
// plus an optional logo, printed on the cut-plan and quotation PDFs.
//
// Isomorphic on purpose — the browser imports this too — so nothing here may
// pull in a server-only module.
import type { z } from 'zod';
import { CompanyIdentitySchema, LogoDataUrlSchema, type CompanyIdentity } from '@/lib/quotation';

export const AtelierSchema = CompanyIdentitySchema.extend({
  logoDataUrl: LogoDataUrlSchema.nullable().optional(),
}).strict();
export type Atelier = z.infer<typeof AtelierSchema>;

/** The company details of an Atelier, without its logo. */
export function companyOf(atelier: Atelier): CompanyIdentity {
  const company: Atelier = { ...atelier };
  delete company.logoDataUrl;
  return company;
}

export interface QuotationCompanySources {
  account: Atelier | null;
  project: CompanyIdentity | null;
  local: CompanyIdentity | null;
}

export interface ResolvedQuotationCompany {
  company: CompanyIdentity | null;
  /** Only ever the account's logo — a project or local company never carries one. */
  logoDataUrl?: string;
  fromAccount: boolean;
}

/** Which company a quotation is issued under: account > project > local. */
export function resolveQuotationCompany(sources: QuotationCompanySources): ResolvedQuotationCompany {
  const { account, project, local } = sources;
  if (account) {
    const resolved: ResolvedQuotationCompany = { company: companyOf(account), fromAccount: true };
    if (account.logoDataUrl) resolved.logoDataUrl = account.logoDataUrl;
    return resolved;
  }
  return { company: project ?? local ?? null, fromAccount: false };
}
