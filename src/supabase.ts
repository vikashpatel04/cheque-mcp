import { createClient } from '@supabase/supabase-js';
import { config } from 'dotenv';

config();

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
export const SHOP_USER_ID = process.env.SHOP_USER_ID ?? '';

if (!url || !key || !SHOP_USER_ID) {
  process.stderr.write(
    'Error: Missing required env vars. Set SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, and SHOP_USER_ID in .env\n'
  );
  process.exit(1);
}

export const supabase = createClient(url, key, {
  auth: { autoRefreshToken: false, persistSession: false },
});
