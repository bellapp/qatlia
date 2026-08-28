import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createClient as createAdminClient } from '@supabase/supabase-js';

function db() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (supabaseUrl && serviceRoleKey && !supabaseUrl.includes('placeholder')) {
    return createAdminClient(supabaseUrl, serviceRoleKey);
  }
  return createClient();
}

export async function GET() {
  try {
    const supabase = createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });
    }

    const client = db();
    const { data, error } = await client
      .from('credit_transactions')
      .select('id, type, amount, balance_after, description, created_at')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
      .limit(50);

    if (error) {
      return NextResponse.json({ success: true, transactions: [], note: 'local' });
    }

    return NextResponse.json({ success: true, transactions: data || [] });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Erreur';
    return NextResponse.json({ error: 'SERVER_ERROR', message: msg }, { status: 500 });
  }
}
