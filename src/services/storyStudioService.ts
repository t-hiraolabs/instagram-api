// Story Studio: テンプレート・タグのデータアクセス層
import { supabase } from './supabaseClient';
import { Plan } from '../utils/plans';

export interface Tag {
  id: string;
  name: string;
}

export interface StoryTemplate {
  id: string;
  type: 'story' | 'feed' | 'carousel' | 'reel_cover';
  name: string;
  layerDefaults: LayerDefaults;
  plan: Plan;
  score: number;
  thumbnailUrl: string | null;
  tags: string[];
}

/** テンプレートの初期レイヤー構成。各パーツの画像は直接URLで埋め込む（完成テンプレート方式） */
export interface LayerDefaults {
  background?: { url: string };
  frame?: { url: string };
  flower?: { url: string };
  decoration?: { url: string };
  photoSlots: number;
  font?: string;
  titleColor?: string;
}

/** ユーザーが許可されているプラン（自分と同格以下）を返す */
export function allowedPlans(plan: Plan): Plan[] {
  if (plan === 'business') return ['free', 'pro', 'business'];
  if (plan === 'pro') return ['free', 'pro'];
  return ['free'];
}

function rowToTemplate(row: any, tags: string[]): StoryTemplate {
  return {
    id: row.id,
    type: row.type,
    name: row.name,
    layerDefaults: row.layer_defaults,
    plan: row.plan,
    score: Number(row.score),
    thumbnailUrl: row.thumbnail_url,
    tags,
  };
}

export async function getTags(): Promise<Tag[]> {
  const { data, error } = await supabase.from('tags').select('id, name').order('name');
  if (error) throw error;
  return data ?? [];
}

/** タグの一致数でスコアリングし上位N件を返す（AI呼び出し前の絞り込み・DBのみで完結） */
export async function rankTemplatesByTags(params: {
  plan: Plan;
  candidateTags: string[];
  limit?: number;
}): Promise<StoryTemplate[]> {
  const plans = allowedPlans(params.plan);
  const { data, error } = await supabase
    .from('templates')
    .select('id, type, name, layer_defaults, plan, score, thumbnail_url, template_tags(tag_id, tags(name))')
    .eq('type', 'story')
    .in('plan', plans);
  if (error) throw error;

  const wanted = new Set(params.candidateTags);
  const scored = (data ?? []).map((row: any) => {
    const tagNames: string[] = (row.template_tags ?? []).map((tt: any) => tt.tags?.name).filter(Boolean);
    const tagMatch = tagNames.filter((t) => wanted.has(t)).length;
    return { row, tagNames, tagMatch };
  });

  scored.sort((a, b) => b.tagMatch - a.tagMatch || b.row.score - a.row.score);
  const top = scored.slice(0, params.limit ?? 20);
  return top.map(({ row, tagNames }) => rowToTemplate(row, tagNames));
}

export async function getTemplateById(id: string): Promise<StoryTemplate | null> {
  const { data, error } = await supabase
    .from('templates')
    .select('id, type, name, layer_defaults, plan, score, thumbnail_url, template_tags(tag_id, tags(name))')
    .eq('id', id)
    .maybeSingle();
  if (error || !data) return null;
  const tagNames: string[] = ((data as any).template_tags ?? []).map((tt: any) => tt.tags?.name).filter(Boolean);
  return rowToTemplate(data, tagNames);
}

export async function recordRecentTemplate(templateId: string): Promise<void> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return;
  await supabase.from('recent_templates').insert({ user_id: user.id, template_id: templateId });
}

export async function getRecentTemplateIds(limit = 10): Promise<string[]> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return [];
  const { data } = await supabase
    .from('recent_templates')
    .select('template_id')
    .eq('user_id', user.id)
    .order('used_at', { ascending: false })
    .limit(limit);
  return (data ?? []).map((r) => r.template_id);
}

export interface StoryDraft {
  id: string;
  templateId: string | null;
  layersJson: unknown;
  updatedAt: string;
}

export async function saveStoryDraft(params: {
  id?: string;
  igUserId?: string;
  templateId?: string;
  layersJson: unknown;
}): Promise<string> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('ログインが必要です');
  const payload = {
    user_id: user.id,
    ig_user_id: params.igUserId ?? null,
    template_id: params.templateId ?? null,
    layers_json: params.layersJson,
    updated_at: new Date().toISOString(),
  };
  if (params.id) {
    const { error } = await supabase.from('story_drafts').update(payload).eq('id', params.id);
    if (error) throw error;
    return params.id;
  }
  const { data, error } = await supabase.from('story_drafts').insert(payload).select('id').single();
  if (error) throw error;
  return data.id;
}

export async function listStoryDrafts(): Promise<StoryDraft[]> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return [];
  const { data, error } = await supabase
    .from('story_drafts')
    .select('id, template_id, layers_json, updated_at')
    .eq('user_id', user.id)
    .order('updated_at', { ascending: false });
  if (error) throw error;
  return (data ?? []).map((r) => ({ id: r.id, templateId: r.template_id, layersJson: r.layers_json, updatedAt: r.updated_at }));
}
