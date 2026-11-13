import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * The admin audit log (public.admin_audit_log, migration 013): who did what
 * to which client, and when. Server-only.
 */

export type AuditAction = 'payment_granted' | 'payment_refused' | 'credits_adjusted' | 'note_updated';

export interface AuditEntry {
  adminId: string;
  action: AuditAction;
  targetUserId: string | null;
  details: Record<string, unknown>;
}

/**
 * Append one entry. Never throws: the decision it records has already been
 * applied, so a failure to log it must not turn a success into an error.
 */
export async function writeAudit(db: SupabaseClient, entry: AuditEntry): Promise<void> {
  try {
    const { error } = await db.from('admin_audit_log').insert({
      admin_id: entry.adminId,
      action: entry.action,
      target_user_id: entry.targetUserId,
      details: entry.details,
    });
    if (error) console.error('admin audit write failed:', error.message);
  } catch (err) {
    console.error('admin audit write failed:', err);
  }
}
