import { supabase } from './supabaseClient';
import { uploadPostImage } from './storage';

export interface Member {
  id: string;
  name: string;
  photo_url: string | null;
  sort_order: number;
}

/** 登録済みメンバー一覧を取得 */
export async function listMembers(): Promise<Member[]> {
  const { data, error } = await supabase
    .from('members')
    .select('id, name, photo_url, sort_order')
    .order('sort_order', { ascending: true })
    .order('created_at', { ascending: true });
  if (error) throw error;
  return data ?? [];
}

/** メンバーを追加（写真をアップロードして保存） */
export async function addMember(name: string, photoUri: string): Promise<Member> {
  const photo_url = await uploadPostImage(photoUri);
  const { data, error } = await supabase
    .from('members')
    .insert({ name: name.trim(), photo_url })
    .select('id, name, photo_url, sort_order')
    .single();
  if (error) throw error;
  return data;
}

/** メンバーを削除 */
export async function deleteMember(id: string): Promise<void> {
  const { error } = await supabase.from('members').delete().eq('id', id);
  if (error) throw error;
}
