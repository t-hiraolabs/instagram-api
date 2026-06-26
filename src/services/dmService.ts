import { supabase } from './supabaseClient';

const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL ?? '';
const SUPABASE_ANON_KEY = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? '';

export interface DMParticipant {
  id: string;
  username?: string;
  name?: string;
  profile_picture?: string;
}

export interface DMMessage {
  id: string;
  message: string;
  from: { id: string; username?: string };
  created_time: string;
}

export interface DMConversation {
  id: string;
  updated_time: string;
  participants: DMParticipant[];
  snippet?: string; // 最新メッセージのプレビュー
}

async function getAuthHeaders() {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token ?? SUPABASE_ANON_KEY;
  return {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${token}`,
    apikey: SUPABASE_ANON_KEY,
  };
}

// 会話一覧を取得
export async function getConversations(
  accessToken: string,
  userId: string
): Promise<DMConversation[]> {
  const res = await fetch(
    `https://graph.instagram.com/v21.0/${userId}/conversations` +
      `?platform=instagram&fields=participants,updated_time,messages.limit(1){message,from,created_time}` +
      `&access_token=${accessToken}`
  );
  const data = await res.json();
  if (data.error) throw new Error(data.error.message ?? 'DM取得に失敗しました');

  return (data.data ?? []).map((c: any) => ({
    id: c.id,
    updated_time: c.updated_time,
    participants: (c.participants?.data ?? []),
    snippet: c.messages?.data?.[0]?.message ?? '',
  }));
}

// 特定の会話のメッセージを取得
export async function getMessages(
  accessToken: string,
  conversationId: string
): Promise<DMMessage[]> {
  const res = await fetch(
    `https://graph.instagram.com/v21.0/${conversationId}/messages` +
      `?fields=message,from,created_time&limit=50` +
      `&access_token=${accessToken}`
  );
  const data = await res.json();
  if (data.error) throw new Error(data.error.message ?? 'メッセージ取得に失敗しました');
  return (data.data ?? []).reverse(); // 古い順に並べ替え
}

// メッセージを送信
export async function sendMessage(
  accessToken: string,
  userId: string,
  recipientId: string,
  text: string
): Promise<void> {
  const res = await fetch(`https://graph.instagram.com/v21.0/${userId}/messages`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      recipient: { id: recipientId },
      message: { text },
      access_token: accessToken,
    }),
  });
  const data = await res.json();
  if (data.error) throw new Error(data.error.message ?? 'メッセージ送信に失敗しました');
}
