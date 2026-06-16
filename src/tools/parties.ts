import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { supabase, SHOP_USER_ID } from '../supabase.js';

export function registerPartyTools(server: McpServer): void {
  // ── 7. get_parties ────────────────────────────────────────────────────────
  server.tool(
    'get_parties',
    'List all active parties. Optionally filter by name.',
    {
      search: z
        .string()
        .optional()
        .describe('Partial match on party name (case-insensitive)'),
    },
    async ({ search }) => {
      let query = supabase
        .from('parties')
        .select('id, name, contact_name, phone, bank_name, is_active')
        .eq('user_id', SHOP_USER_ID)
        .eq('is_active', true)
        .is('deleted_at', null)
        .order('name', { ascending: true });

      if (search) {
        query = query.ilike('name', `%${search}%`);
      }

      const { data, error } = await query;

      if (error) {
        return { content: [{ type: 'text', text: `Database error: ${error.message}` }] };
      }

      const parties = (data ?? []).map(
        (p: {
          id: string;
          name: string;
          contact_name: string | null;
          phone: string | null;
          bank_name: string | null;
        }) => ({
          name: p.name,
          contact_name: p.contact_name ?? null,
          phone: p.phone ?? null,
          bank_name: p.bank_name ?? null,
        })
      );

      const text =
        parties.length === 0
          ? search
            ? `No parties found matching "${search}".`
            : 'No active parties found.'
          : JSON.stringify({ count: parties.length, parties }, null, 2);

      return { content: [{ type: 'text', text }] };
    }
  );
}
