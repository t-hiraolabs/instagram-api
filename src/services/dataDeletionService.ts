import { supabase } from './supabaseClient';

/**
 * 指定したInstagramアカウント（ig_user_id）に紐づく、サーバー側（Supabase）の
 * データをすべて削除する。「連携解除」とは別の、Meta App Reviewが求める
 * 明示的なデータ削除導線として提供する（連携解除自体は既存の挙動を変えず、
 * 再連携すれば設定が引き継がれる。こちらは後戻りできない完全削除）。
 *
 * chat_messagesはchat_conversations削除時にDB側のon delete cascadeで
 * 自動的に削除されるため、ここでは明示的に消していない。
 */
export async function deleteAccountData(igUserId: string): Promise<void> {
  if (!igUserId) return;
  await Promise.all([
    supabase.from('brand_settings').delete().eq('ig_user_id', igUserId),
    supabase.from('ig_first_analysis').delete().eq('ig_user_id', igUserId),
    supabase.from('marketing_guide_cache').delete().eq('ig_user_id', igUserId),
    supabase.from('story_drafts').delete().eq('ig_user_id', igUserId),
    supabase.from('chat_conversations').delete().eq('ig_user_id', igUserId),
    supabase.from('follower_snapshots').delete().eq('ig_user_id', igUserId),
  ]);
}
