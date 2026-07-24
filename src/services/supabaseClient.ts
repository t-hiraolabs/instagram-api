import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL ?? '';
const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? '';

export const isSupabaseConfigured = Boolean(supabaseUrl && supabaseAnonKey);

export const supabase = createClient(
  supabaseUrl || 'https://placeholder.supabase.co',
  supabaseAnonKey || 'placeholder-anon-key',
  {
    auth: {
      flowType: 'pkce',
      // Instagram連携も同じ?code=パラメータを使うOAuthフローのため、有効なままだと
      // SupabaseがInstagram発行のcodeを自分のPKCEコードだと誤認して自動的に交換を試み、
      // 失敗した拍子に既存のログインセッションを巻き込んで消してしまう不具合があった
      // （Googleログイン・パスワード再設定は、App.tsxのOAuthHandlerで
      // exchangeCodeForSession()を明示的に呼んでいるため、これをfalseにしても壊れない）
      detectSessionInUrl: false,
      persistSession: true,
      autoRefreshToken: true,
    },
  }
);
