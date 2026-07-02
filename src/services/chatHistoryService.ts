// AIアシスタントの会話（複数スレッド）を保存・復元する
import { supabase } from './supabaseClient';

export type ChatRole = 'user' | 'assistant' | 'image';
export interface StoredChatMessage { role: ChatRole; content: string; }
export interface Conversation { id: string; title: string; updated_at: string; }

/** 会話スレッド一覧（新しい順） */
export async function listConversations(): Promise<Conversation[]> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return [];
  const { data, error } = await supabase
    .from('chat_conversations')
    .select('id, title, updated_at')
    .eq('user_id', user.id)
    .order('updated_at', { ascending: false });
  if (error || !data) return [];
  return data as Conversation[];
}

/** 新しい会話を作成してIDを返す */
export async function createConversation(title = '新しい会話'): Promise<string | null> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const { data, error } = await supabase
    .from('chat_conversations')
    .insert({ user_id: user.id, title })
    .select('id')
    .single();
  if (error || !data) return null;
  return data.id as string;
}

/** 会話のタイトルを変更 */
export async function renameConversation(id: string, title: string): Promise<void> {
  await supabase.from('chat_conversations').update({ title }).eq('id', id);
}

/** 会話を削除 */
export async function deleteConversation(id: string): Promise<void> {
  await supabase.from('chat_conversations').delete().eq('id', id);
}

/** 指定した会話のメッセージを古い順に読み込む */
export async function loadMessages(conversationId: string): Promise<StoredChatMessage[]> {
  const { data, error } = await supabase
    .from('chat_messages')
    .select('role, content')
    .eq('conversation_id', conversationId)
    .order('created_at', { ascending: true });
  if (error || !data) return [];
  return data as StoredChatMessage[];
}

/** メッセージを1件保存する（会話の更新日時も更新） */
export async function saveMessage(conversationId: string, role: ChatRole, content: string): Promise<void> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return;
  await supabase.from('chat_messages').insert({ user_id: user.id, conversation_id: conversationId, role, content });
  await supabase.from('chat_conversations').update({ updated_at: new Date().toISOString() }).eq('id', conversationId);
}
