# cheque-mcp

A [Model Context Protocol (MCP)](https://modelcontextprotocol.io) server that gives AI agents full visibility into a cheque tracking business — due dates, overdue cheques, party management, deposit logs, and status updates — all backed by Supabase.

Built to work with **Claude Desktop**, **OpenClaw**, and any MCP-compatible AI client.

---

## What it does

Once connected, your AI agent can answer questions and take actions like:

- *"Which cheques are due in the next 3 days?"*
- *"Show me all overdue cheques and the total amount at risk."*
- *"Add a cheque for Sharma Traders, ₹45,000, due 2026-07-15."*
- *"Mark cheque 004521 as returned — it bounced."*
- *"Give me a summary of the business — how much is pending?"*

---

## Prerequisites

- **Node.js 20+**
- A **Supabase** project (free tier is fine)
- The database schema applied (see [Database Setup](#database-setup))

---

## Quick Start

```bash
# 1. Clone the repo
git clone https://github.com/your-username/cheque-mcp.git
cd cheque-mcp

# 2. Install dependencies
npm install

# 3. Configure environment
cp .env.example .env
# Edit .env and fill in your three values (see below)

# 4. Build
npm run build

# 5. Add to your AI client config (see below)
```

---

## Database Setup

If you are starting from scratch, run `schema.sql` in your Supabase SQL editor:

1. Open your Supabase project → **SQL Editor**
2. Paste the contents of [`schema.sql`](./schema.sql) and click **Run**

This creates the four tables: `parties`, `cheques`, `cheque_history`, `daily_deposits`.

If you already have these tables from an existing cheque tracking app, skip this step.

---

## Environment Variables

Create a `.env` file in the project root (copy from `.env.example`):

```env
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key_here
SHOP_USER_ID=your_supabase_auth_user_id_here
```

### Where to find each value

**`SUPABASE_URL`**
Your Supabase project → Settings → API → **Project URL**

**`SUPABASE_SERVICE_ROLE_KEY`**
Your Supabase project → Settings → API → **`service_role`** (under "Project API keys")

> **Why service role?** The MCP server runs locally and needs to read/write on behalf of the shop owner. The service role key bypasses Row Level Security, so all queries are filtered in code by `SHOP_USER_ID` instead.

> **Security note:** Never commit `.env` to git. The `.gitignore` already excludes it. Keep your service role key out of public repositories.

**`SHOP_USER_ID`**
The UUID of the shop owner's Supabase auth account. Three ways to find it:

- **Dashboard:** Authentication → Users → copy the **User UID** column
- **SQL editor:** `select id, email from auth.users where email = 'owner@example.com';`
- **From existing data:** `select distinct user_id from cheques limit 1;`

---

## Adding to Claude Desktop / OpenClaw

### 1. Build the server

```bash
npm run build
```

### 2. Find the full path to the built file

```bash
# macOS / Linux
realpath dist/index.js

# Windows (PowerShell)
(Resolve-Path dist\index.js).Path
```

### 3. Edit your AI client config

**Claude Desktop** — edit `~/Library/Application Support/Claude/claude_desktop_config.json` (macOS) or `%APPDATA%\Claude\claude_desktop_config.json` (Windows):

**OpenClaw** — edit `~/.openclaw/config.json`:

```json
{
  "mcpServers": {
    "cheque-mcp": {
      "command": "node",
      "args": ["/full/path/to/cheque-mcp/dist/index.js"],
      "env": {
        "SUPABASE_URL": "https://your-project.supabase.co",
        "SUPABASE_SERVICE_ROLE_KEY": "your_service_role_key_here",
        "SHOP_USER_ID": "your_shop_user_id_here"
      }
    }
  }
}
```

> You can put credentials in the `"env"` block (as above) **or** put them in the `.env` file — whichever you prefer. If you use `.env`, you can omit the `"env"` block from the config.

### 4. Restart your AI client

The server will connect automatically. You should see `cheque-mcp` listed in the available tools.

---

## Available Tools

| Tool | Description |
|---|---|
| `get_due_cheques` | Cheques due within the next N days (default: 3). Returns PENDING and DEPOSITED cheques. |
| `get_overdue_cheques` | All PENDING cheques past their due date, sorted oldest first. Includes total overdue amount. |
| `get_all_cheques` | List cheques with optional filters: `status`, `party_name` (partial), `limit` (max 50). |
| `get_cheque_summary` | Business dashboard — counts and totals by status, overdue, due today, due this week. |
| `add_cheque` | Add a new cheque. Looks up party by name; errors clearly if not found. |
| `update_cheque_status` | Change status with transition validation. Logs every change to `cheque_history`. |
| `get_parties` | List active parties with optional name search. |
| `get_daily_deposits` | Deposit log for a date range (default: last 7 days). |

---

## Status Transitions

```
PENDING   ──→  DEPOSITED
          ──→  RETURNED   (reason required)
          ──→  CANCELLED

DEPOSITED ──→  PASSED
          ──→  RETURNED   (reason required)
          ──→  CANCELLED

PASSED    ──→  (terminal — no further transitions)
RETURNED  ──→  (terminal)
CANCELLED ──→  (terminal)
```

Every `update_cheque_status` call inserts a row into `cheque_history` with `changed_by = 'velo'` so you have a full audit trail.

---

## Formatting

All amounts are returned in Indian number format with the ₹ symbol:

```
150000  →  ₹1,50,000.00
```

All dates are returned in `DD-MM-YYYY` format for readability. Inputs are accepted as `YYYY-MM-DD`.

---

## Development

```bash
# Run without building (uses tsx)
npm run dev

# Type-check only
npx tsc --noEmit

# Build for production
npm run build
npm start
```

---

## Project Structure

```
src/
  index.ts          — MCP server entry point
  supabase.ts       — Supabase client (service role)
  utils.ts          — Currency + date formatting helpers
  tools/
    cheques.ts      — 7 cheque and deposit tools
    parties.ts      — Party lookup tool
schema.sql          — Database schema (run once in Supabase)
.env.example        — Environment variable template
```

---

## License

MIT — see [LICENSE](./LICENSE)
