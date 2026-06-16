import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { supabase, SHOP_USER_ID } from '../supabase.js';
import {
  formatINR,
  formatDate,
  todayISO,
  futureDateISO,
  pastDateISO,
  daysUntilDate,
} from '../utils.js';

const VALID_TRANSITIONS: Record<string, string[]> = {
  PENDING: ['DEPOSITED', 'RETURNED', 'CANCELLED'],
  DEPOSITED: ['PASSED', 'RETURNED', 'CANCELLED'],
  PASSED: [],
  RETURNED: [],
  CANCELLED: [],
};

type ChequeRow = {
  id: string;
  cheque_number: string;
  bank_name: string;
  amount: number;
  issue_date: string;
  due_date: string;
  status: string;
  return_reason: string | null;
  auto_transition_blocked: boolean;
  notes: string | null;
  parties: { name: string } | null;
};

function formatChequeRow(c: ChequeRow, partyName: string) {
  return {
    cheque_number: c.cheque_number,
    party_name: partyName,
    bank_name: c.bank_name,
    amount: formatINR(Number(c.amount)),
    issue_date: formatDate(c.issue_date),
    due_date: formatDate(c.due_date),
    status: c.status,
    days_until_due: daysUntilDate(c.due_date),
    notes: c.notes ?? null,
  };
}

export function registerChequeTools(server: McpServer): void {
  // ── 1. get_due_cheques ────────────────────────────────────────────────────
  server.tool(
    'get_due_cheques',
    'Get cheques due within the next N days (status: PENDING or DEPOSITED)',
    {
      days: z
        .number()
        .int()
        .min(0)
        .max(365)
        .default(3)
        .describe('Number of days ahead to look (default 3)'),
    },
    async ({ days }) => {
      const maxDate = futureDateISO(days);

      const { data, error } = await supabase
        .from('cheques')
        .select('*, parties(name)')
        .eq('user_id', SHOP_USER_ID)
        .in('status', ['PENDING', 'DEPOSITED'])
        .lte('due_date', maxDate)
        .is('deleted_at', null)
        .order('due_date', { ascending: true });

      if (error) {
        return { content: [{ type: 'text', text: `Database error: ${error.message}` }] };
      }

      const cheques = (data as ChequeRow[]).map((c) =>
        formatChequeRow(c, c.parties?.name ?? 'Unknown')
      );

      const text =
        cheques.length === 0
          ? `No cheques due in the next ${days} day(s).`
          : JSON.stringify({ count: cheques.length, cheques }, null, 2);

      return { content: [{ type: 'text', text }] };
    }
  );

  // ── 2. get_overdue_cheques ────────────────────────────────────────────────
  server.tool(
    'get_overdue_cheques',
    'Get all PENDING cheques past their due date, sorted oldest first',
    {},
    async () => {
      const today = todayISO();

      const { data, error } = await supabase
        .from('cheques')
        .select('*, parties(name)')
        .eq('user_id', SHOP_USER_ID)
        .eq('status', 'PENDING')
        .lt('due_date', today)
        .is('deleted_at', null)
        .order('due_date', { ascending: true });

      if (error) {
        return { content: [{ type: 'text', text: `Database error: ${error.message}` }] };
      }

      const rows = data as ChequeRow[];
      const cheques = rows.map((c) => ({
        ...formatChequeRow(c, c.parties?.name ?? 'Unknown'),
        days_overdue: Math.abs(daysUntilDate(c.due_date)),
      }));

      const totalOverdue = rows.reduce((sum, c) => sum + Number(c.amount), 0);

      const text =
        cheques.length === 0
          ? 'No overdue cheques. All clear!'
          : JSON.stringify(
              {
                count: cheques.length,
                total_overdue_amount: formatINR(totalOverdue),
                cheques,
              },
              null,
              2
            );

      return { content: [{ type: 'text', text }] };
    }
  );

  // ── 3. get_all_cheques ────────────────────────────────────────────────────
  server.tool(
    'get_all_cheques',
    'List cheques with optional filters by status or party name',
    {
      status: z
        .enum(['PENDING', 'DEPOSITED', 'PASSED', 'RETURNED', 'CANCELLED'])
        .optional()
        .describe('Filter by status'),
      party_name: z
        .string()
        .optional()
        .describe('Partial match on party name (case-insensitive)'),
      limit: z.number().int().min(1).max(50).default(20).describe('Max results (default 20)'),
    },
    async ({ status, party_name, limit }) => {
      let partyIds: string[] | null = null;

      if (party_name) {
        const { data: parties, error: pErr } = await supabase
          .from('parties')
          .select('id')
          .eq('user_id', SHOP_USER_ID)
          .ilike('name', `%${party_name}%`)
          .is('deleted_at', null);

        if (pErr) {
          return { content: [{ type: 'text', text: `Database error: ${pErr.message}` }] };
        }

        partyIds = (parties ?? []).map((p: { id: string }) => p.id);

        if (partyIds.length === 0) {
          return {
            content: [
              { type: 'text', text: `No parties found matching "${party_name}". Use get_parties to see available parties.` },
            ],
          };
        }
      }

      let query = supabase
        .from('cheques')
        .select('*, parties(name)')
        .eq('user_id', SHOP_USER_ID)
        .is('deleted_at', null)
        .order('due_date', { ascending: false })
        .limit(limit);

      if (status) query = query.eq('status', status);
      if (partyIds) query = query.in('party_id', partyIds);

      const { data, error } = await query;

      if (error) {
        return { content: [{ type: 'text', text: `Database error: ${error.message}` }] };
      }

      const cheques = (data as ChequeRow[]).map((c) =>
        formatChequeRow(c, c.parties?.name ?? 'Unknown')
      );

      const text =
        cheques.length === 0
          ? 'No cheques found matching the given filters.'
          : JSON.stringify({ count: cheques.length, cheques }, null, 2);

      return { content: [{ type: 'text', text }] };
    }
  );

  // ── 4. get_cheque_summary ─────────────────────────────────────────────────
  server.tool(
    'get_cheque_summary',
    'Get a business summary — counts and totals by status, overdue amounts, and upcoming dues',
    {},
    async () => {
      const today = todayISO();
      const weekEnd = futureDateISO(7);

      const { data, error } = await supabase
        .from('cheques')
        .select('status, amount, due_date')
        .eq('user_id', SHOP_USER_ID)
        .is('deleted_at', null);

      if (error) {
        return { content: [{ type: 'text', text: `Database error: ${error.message}` }] };
      }

      const all = (data ?? []) as { status: string; amount: number; due_date: string }[];

      const byStatus: Record<string, { count: number; total: number }> = {};
      for (const c of all) {
        if (!byStatus[c.status]) byStatus[c.status] = { count: 0, total: 0 };
        byStatus[c.status].count++;
        byStatus[c.status].total += Number(c.amount);
      }

      const overdueItems = all.filter(
        (c) => c.status === 'PENDING' && c.due_date < today
      );
      const dueToday = all.filter(
        (c) => ['PENDING', 'DEPOSITED'].includes(c.status) && c.due_date === today
      );
      const dueThisWeek = all.filter(
        (c) =>
          ['PENDING', 'DEPOSITED'].includes(c.status) &&
          c.due_date >= today &&
          c.due_date <= weekEnd
      );

      const sum = (items: typeof all) =>
        items.reduce((s, c) => s + Number(c.amount), 0);

      const ALL_STATUSES = ['PENDING', 'DEPOSITED', 'PASSED', 'RETURNED', 'CANCELLED'];
      const byStatusFormatted = Object.fromEntries(
        ALL_STATUSES.map((s) => [
          s,
          {
            count: byStatus[s]?.count ?? 0,
            total: formatINR(byStatus[s]?.total ?? 0),
          },
        ])
      );

      const summary = {
        by_status: byStatusFormatted,
        overdue: {
          count: overdueItems.length,
          total_amount: formatINR(sum(overdueItems)),
        },
        due_today: {
          count: dueToday.length,
          total_amount: formatINR(sum(dueToday)),
        },
        due_this_week: {
          count: dueThisWeek.length,
          total_amount: formatINR(sum(dueThisWeek)),
        },
        grand_total_active: formatINR(
          sum(all.filter((c) => ['PENDING', 'DEPOSITED'].includes(c.status)))
        ),
      };

      return { content: [{ type: 'text', text: JSON.stringify(summary, null, 2) }] };
    }
  );

  // ── 5. add_cheque ─────────────────────────────────────────────────────────
  server.tool(
    'add_cheque',
    'Add a new cheque to the tracker. Looks up party by exact name (case-insensitive).',
    {
      party_name: z.string().min(1).describe('Party name — must match an existing active party'),
      cheque_number: z.string().min(1),
      bank_name: z.string().min(1),
      amount: z.number().positive(),
      issue_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).describe('Format: YYYY-MM-DD'),
      due_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).describe('Format: YYYY-MM-DD'),
      notes: z.string().optional(),
    },
    async ({ party_name, cheque_number, bank_name, amount, issue_date, due_date, notes }) => {
      // Exact case-insensitive party lookup
      const { data: parties, error: pErr } = await supabase
        .from('parties')
        .select('id, name')
        .eq('user_id', SHOP_USER_ID)
        .ilike('name', party_name)
        .eq('is_active', true)
        .is('deleted_at', null)
        .limit(1);

      if (pErr) {
        return { content: [{ type: 'text', text: `Database error: ${pErr.message}` }] };
      }

      if (!parties || parties.length === 0) {
        return {
          content: [
            {
              type: 'text',
              text: `Party '${party_name}' not found. Use get_parties to see available parties.`,
            },
          ],
        };
      }

      const party = parties[0] as { id: string; name: string };

      const { data: cheque, error: cErr } = await supabase
        .from('cheques')
        .insert({
          user_id: SHOP_USER_ID,
          party_id: party.id,
          cheque_number,
          bank_name,
          amount,
          issue_date,
          due_date,
          status: 'PENDING',
          auto_transition_blocked: false,
          notes: notes ?? null,
        })
        .select('*')
        .single();

      if (cErr) {
        return { content: [{ type: 'text', text: `Error creating cheque: ${cErr.message}` }] };
      }

      const result = {
        message: 'Cheque added successfully.',
        cheque: {
          id: cheque.id,
          cheque_number: cheque.cheque_number,
          party_name: party.name,
          bank_name: cheque.bank_name,
          amount: formatINR(Number(cheque.amount)),
          issue_date: formatDate(cheque.issue_date),
          due_date: formatDate(cheque.due_date),
          status: cheque.status,
          notes: cheque.notes ?? null,
        },
      };

      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    }
  );

  // ── 6. update_cheque_status ───────────────────────────────────────────────
  server.tool(
    'update_cheque_status',
    'Update the status of a cheque. Validates allowed transitions and records history.',
    {
      cheque_number: z.string().min(1).describe('Cheque number to update'),
      new_status: z
        .enum(['DEPOSITED', 'PASSED', 'RETURNED', 'CANCELLED'])
        .describe('New status to set'),
      reason: z
        .string()
        .optional()
        .describe('Reason for return — required when new_status is RETURNED'),
    },
    async ({ cheque_number, new_status, reason }) => {
      if (new_status === 'RETURNED' && !reason) {
        return {
          content: [
            { type: 'text', text: 'A reason is required when marking a cheque as RETURNED.' },
          ],
        };
      }

      const { data: rows, error: findErr } = await supabase
        .from('cheques')
        .select('*')
        .eq('user_id', SHOP_USER_ID)
        .eq('cheque_number', cheque_number)
        .is('deleted_at', null)
        .limit(1);

      if (findErr) {
        return { content: [{ type: 'text', text: `Database error: ${findErr.message}` }] };
      }

      if (!rows || rows.length === 0) {
        return {
          content: [{ type: 'text', text: `Cheque number '${cheque_number}' not found.` }],
        };
      }

      const cheque = rows[0];
      const current = cheque.status as string;
      const allowed = VALID_TRANSITIONS[current] ?? [];

      if (!allowed.includes(new_status)) {
        const allowedStr =
          allowed.length > 0 ? allowed.join(', ') : 'none — this is a terminal status';
        return {
          content: [
            {
              type: 'text',
              text: `Cannot change status from ${current} to ${new_status}. Valid transitions from ${current} are: ${allowedStr}.`,
            },
          ],
        };
      }

      const updatePayload: Record<string, unknown> = {
        status: new_status,
        auto_transition_blocked: true,
      };
      if (new_status === 'RETURNED') {
        updatePayload.return_reason = reason;
      }

      const { data: updated, error: updErr } = await supabase
        .from('cheques')
        .update(updatePayload)
        .eq('id', cheque.id)
        .select('*')
        .single();

      if (updErr) {
        return { content: [{ type: 'text', text: `Error updating cheque: ${updErr.message}` }] };
      }

      // Record status change in history
      await supabase.from('cheque_history').insert({
        cheque_id: cheque.id,
        from_status: current,
        to_status: new_status,
        changed_by: 'velo',
        note: reason ?? null,
      });

      const result = {
        message: `Cheque ${cheque_number} updated: ${current} → ${new_status}.`,
        cheque: {
          cheque_number: updated.cheque_number,
          status: updated.status,
          return_reason: updated.return_reason ?? null,
          updated_at: updated.updated_at,
        },
      };

      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    }
  );

  // ── 8. get_daily_deposits ─────────────────────────────────────────────────
  server.tool(
    'get_daily_deposits',
    'Get deposit log for a date range (default: last 7 days)',
    {
      from_date: z
        .string()
        .regex(/^\d{4}-\d{2}-\d{2}$/)
        .optional()
        .describe('Start date YYYY-MM-DD (default: 7 days ago)'),
      to_date: z
        .string()
        .regex(/^\d{4}-\d{2}-\d{2}$/)
        .optional()
        .describe('End date YYYY-MM-DD (default: today)'),
    },
    async ({ from_date, to_date }) => {
      const from = from_date ?? pastDateISO(7);
      const to = to_date ?? todayISO();

      const { data, error } = await supabase
        .from('daily_deposits')
        .select('*')
        .eq('user_id', SHOP_USER_ID)
        .gte('deposit_date', from)
        .lte('deposit_date', to)
        .order('deposit_date', { ascending: false });

      if (error) {
        return { content: [{ type: 'text', text: `Database error: ${error.message}` }] };
      }

      const deposits = (data ?? []).map((d: { deposit_date: string; amount: number; notes: string | null }) => ({
        deposit_date: formatDate(d.deposit_date),
        amount: formatINR(Number(d.amount)),
        notes: d.notes ?? null,
      }));

      const total = (data ?? []).reduce(
        (s: number, d: { amount: number }) => s + Number(d.amount),
        0
      );

      const result = {
        from_date: formatDate(from),
        to_date: formatDate(to),
        count: deposits.length,
        total_deposited: formatINR(total),
        deposits,
      };

      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    }
  );
}
