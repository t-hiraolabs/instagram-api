// 「ストーリー作成」の旧・絵文字ステッカー機能を廃止し、代わりに導入した「マイスタンプ」機能。
// ユーザーが入力したテキスト（フォント・色・サイズ込み）を自分専用に保存し、あとから
// テンプレートとして再利用できる（supabase/sql/32_story_stamps.sql参照）。
// 保存できる件数の上限（プランごと）はsrc/utils/plans.tsのmaxStoryStampsで管理し、
// ここでは呼び出し側が保存前にlistStoryStamps().lengthと比較してチェックする。
import { supabase } from './supabaseClient';

export interface StoryStamp {
  id: string;
  text: string;
  font: string;
  color: string;
  size: number;
  align?: 'left' | 'center' | 'right';
}

const COLUMNS = 'id, text, font, color, size, align';

function rowToStamp(row: any): StoryStamp {
  return {
    id: row.id,
    text: row.text,
    font: row.font,
    color: row.color,
    size: row.size,
    align: row.align ?? undefined,
  };
}

/** 自分が保存したマイスタンプの一覧（新しい順） */
export async function listStoryStamps(): Promise<StoryStamp[]> {
  const { data, error } = await supabase
    .from('story_stamps')
    .select(COLUMNS)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return (data ?? []).map(rowToStamp);
}

export interface CreateStoryStampParams {
  text: string;
  font: string;
  color: string;
  size: number;
  align?: 'left' | 'center' | 'right';
}

export async function createStoryStamp(params: CreateStoryStampParams): Promise<StoryStamp> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('ログインが必要です');
  const { data, error } = await supabase
    .from('story_stamps')
    .insert({
      user_id: user.id,
      text: params.text,
      font: params.font,
      color: params.color,
      size: params.size,
      align: params.align,
    })
    .select(COLUMNS)
    .single();
  if (error) throw error;
  return rowToStamp(data);
}

export async function deleteStoryStamp(id: string): Promise<void> {
  const { error } = await supabase.from('story_stamps').delete().eq('id', id);
  if (error) throw error;
}
