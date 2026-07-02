// AIアシスタントに常に覚えさせる説明（事業・サービス内容）を保存・取得
import { supabase } from './supabaseClient';

export async function loadAssistantMemory(): Promise<string> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return '';
  const { data } = await supabase
    .from('profiles')
    .select('assistant_memory')
    .eq('id', user.id)
    .maybeSingle();
  return (data?.assistant_memory as string) ?? '';
}

export async function saveAssistantMemory(text: string): Promise<void> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('ログインが必要です');
  // 行が無い場合にも対応するため upsert
  const { error } = await supabase
    .from('profiles')
    .upsert({ id: user.id, assistant_memory: text }, { onConflict: 'id' });
  if (error) throw new Error(error.message);
}
