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
  if (!user) return;
  await supabase.from('profiles').update({ assistant_memory: text }).eq('id', user.id);
}
