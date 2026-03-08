import { createClient } from '@supabase/supabase-js';
import { env } from '$env/dynamic/public';

// Import local environment variables for the Supabase UI/Client
export const supabase = createClient(
  env.PUBLIC_SUPABASE_URL || 'http://127.0.0.1:54321',
  env.PUBLIC_SUPABASE_ANON_KEY || 'no-key-found'
);
