import { createClient, SupabaseClient } from '@supabase/supabase-js';

// ─── Database type definitions ─────────────────────────────────────────────
// Mirrors the designed schema. Follows supabase-js v2 GenericSchema format.

export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

export type Database = {
  public: {
    Tables: {
      users: {
        Row: {
          id: string;
          email: string;
          username: string;
          wallet_address: string | null;
          balance_usd: number;
          balance_spin: number;
          total_spins: number;
          total_wins: number;
          total_wagered_usd: number;
          is_banned: boolean;
          kyc_verified: boolean;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id: string;
          email: string;
          username: string;
          wallet_address?: string | null;
          balance_usd?: number;
          balance_spin?: number;
          total_spins?: number;
          total_wins?: number;
          total_wagered_usd?: number;
          is_banned?: boolean;
          kyc_verified?: boolean;
        };
        Update: {
          email?: string;
          username?: string;
          wallet_address?: string | null;
          balance_usd?: number;
          balance_spin?: number;
          total_spins?: number;
          total_wins?: number;
          total_wagered_usd?: number;
          is_banned?: boolean;
          kyc_verified?: boolean;
          updated_at?: string;
        };
        Relationships: [];
      };

      spin_results: {
        Row: {
          id: string;
          user_id: string;
          session_id: string;
          wager_usd: number;
          outcome_index: number;
          outcome_label: string;
          multiplier: number;
          payout_usd: number;
          server_seed_hash: string;
          client_seed: string;
          nonce: number;
          tx_hash: string | null;
          created_at: string;
        };
        Insert: {
          user_id: string;
          session_id: string;
          wager_usd: number;
          outcome_index: number;
          outcome_label: string;
          multiplier: number;
          payout_usd: number;
          server_seed_hash: string;
          client_seed: string;
          nonce: number;
          tx_hash?: string | null;
        };
        Update: {
          tx_hash?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'spin_results_user_id_fkey';
            columns: ['user_id'];
            isOneToOne: false;
            referencedRelation: 'users';
            referencedColumns: ['id'];
          },
        ];
      };

      game_sessions: {
        Row: {
          id: string;
          user_id: string;
          status: string;
          total_spins: number;
          total_wagered_usd: number;
          total_payout_usd: number;
          started_at: string;
          ended_at: string | null;
        };
        Insert: {
          id: string;
          user_id: string;
          status: string;
          total_spins?: number;
          total_wagered_usd?: number;
          total_payout_usd?: number;
          ended_at?: string | null;
        };
        Update: {
          status?: string;
          total_spins?: number;
          total_wagered_usd?: number;
          total_payout_usd?: number;
          ended_at?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'game_sessions_user_id_fkey';
            columns: ['user_id'];
            isOneToOne: false;
            referencedRelation: 'users';
            referencedColumns: ['id'];
          },
        ];
      };

      transactions: {
        Row: {
          id: string;
          user_id: string;
          type: string;
          amount_usd: number;
          status: string;
          tx_hash: string | null;
          metadata: Json | null;
          created_at: string;
        };
        Insert: {
          user_id: string;
          type: string;
          amount_usd: number;
          status: string;
          tx_hash?: string | null;
          metadata?: Json | null;
        };
        Update: {
          status?: string;
          tx_hash?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'transactions_user_id_fkey';
            columns: ['user_id'];
            isOneToOne: false;
            referencedRelation: 'users';
            referencedColumns: ['id'];
          },
        ];
      };
    };

    Views: { [_ in never]: never };
    Functions: { [_ in never]: never };
    Enums: { [_ in never]: never };
    CompositeTypes: { [_ in never]: never };
  };
};

// ─── Convenience row types ─────────────────────────────────────────────────
export type UserRow         = Database['public']['Tables']['users']['Row'];
export type SpinResultRow   = Database['public']['Tables']['spin_results']['Row'];
export type GameSessionRow  = Database['public']['Tables']['game_sessions']['Row'];
export type TransactionRow  = Database['public']['Tables']['transactions']['Row'];

// ─── Client singleton ──────────────────────────────────────────────────────

let _supabase: SupabaseClient<Database> | null = null;

function createSupabaseClient(): SupabaseClient<Database> {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY;

  if (!url || !key) {
    throw new Error('[supabase] SUPABASE_URL and SUPABASE_SERVICE_KEY must be set');
  }

  return createClient<Database>(url, key, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
    db: { schema: 'public' },
    global: {
      headers: { 'x-application-name': 'spinandwin-backend' },
    },
  });
}

export function getSupabase(): SupabaseClient<Database> {
  if (!_supabase) _supabase = createSupabaseClient();
  return _supabase;
}

export const supabase = getSupabase();

// ─── Helper ────────────────────────────────────────────────────────────────

export function assertNoError<T>(
  result: { data: T | null; error: unknown },
  context: string,
): T {
  if (result.error) {
    const msg =
      result.error instanceof Error
        ? result.error.message
        : JSON.stringify(result.error);
    throw new Error(`[supabase:${context}] ${msg}`);
  }
  if (result.data === null) {
    throw new Error(`[supabase:${context}] No data returned`);
  }
  return result.data;
}
