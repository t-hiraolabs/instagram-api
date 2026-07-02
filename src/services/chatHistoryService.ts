// AIアシスタントの会話履歴を保存・復元する
import { supabase } from './supabaseClient';

export type ChatRole = 'user' | 'assistant' | 'image';
export interface StoredChatMessage { role: ChatRole; content: string; }

/** 自分の会話履歴を古い順に読み込む */
export async function loadChatHistory(): Promise<StoredChatMessage[]> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return [];
  const { data, error } = await supabase
    .from('chat_messages')
    .select('role, content')
    .eq('user_id', user.id)
    .order('created_at', { ascending: true });
  if (error || !data) return [];
  return data as StoredChatMessage[];
}

/** メッセージを1件保存する */
export async function saveChatMessage(role: ChatRole, content: string): Promise<void> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return;
  await supabase.from('chat_messages').insert({ user_id: user.id, role, content });
}

/** 会話履歴をすべて削除する */
export async function clearChatHistory(): Promise<void> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return;
  await supabase.from('chat_messages').delete().eq('user_id', user.id);
}
