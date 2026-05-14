import { createClient } from '@supabase/supabase-js';
import { config } from '../config';

// Untyped client — routes use explicit type assertions on .data
export const supabase = createClient(config.supabaseUrl, config.supabaseServiceKey);
