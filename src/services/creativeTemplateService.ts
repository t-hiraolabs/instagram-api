// 「ストーリー作成」共通テンプレートのデータアクセス層。
// storyStudioService.ts（Story Studio専用）とcollageStyleService.ts（Collage専用）を
// 段階的に置き換えるための新設サービス。
//
// フェーズ1時点では、DB側の`templates`はまだtype='story'/'collage'に分かれたまま、かつ
// `layer_defaults`の中身も新形式（TemplateDefinitionV1）に移行済みなのはtype='story'側のみ
// （フェーズ2で移行）。そのためこのサービスは今のところtype='story'のみを対象とする。
// フェーズ4でtype IN ('story','collage')の横断クエリに拡張し、フェーズ6でtype統一後に
// type='story'単独へ戻す（計画のフェーズ順序メモ参照）。
import { supabase } from './supabaseClient';
import { Plan } from '../utils/plans';
import { CreativeTemplate, TemplateDefinitionV1 } from '../types/creativeTemplate';

/** ユーザーが許可されているプラン（自分と同格以下）を返す */
export function allowedPlans(plan: Plan): Plan[] {
  if (plan === 'business') return ['free', 'pro', 'business'];
  if (plan === 'pro') return ['free', 'pro'];
  return ['free'];
}

const TEMPLATE_COLUMNS = 'id, name, layer_defaults, plan, thumbnail_url, tags, is_active';

function rowToCreativeTemplate(row: any): CreativeTemplate {
  const def = (row.layer_defaults ?? {}) as Partial<TemplateDefinitionV1>;
  return {
    id: row.id,
    type: 'story',
    name: row.name,
    photoSlots: def.photoSlots ?? [],
    layers: def.layers ?? [],
    textLayers: def.textLayers ?? [],
    tags: row.tags ?? [],
    thumbnailUrl: row.thumbnail_url ?? null,
    requiredPlan: row.plan,
  };
}

export interface CreativeTemplateFilters {
  /** 写真枚数フィルタ。photoSlots.lengthから判定する（別フィールドでの二重管理はしない） */
  photoCountFilter?: 1 | 2 | 3 | '4+';
  /** タグ（AND条件） */
  tags?: string[];
  search?: string;
}

export async function listCreativeTemplates(plan: Plan, filters?: CreativeTemplateFilters): Promise<CreativeTemplate[]> {
  const plans = allowedPlans(plan);
  const { data, error } = await supabase
    .from('templates')
    .select(TEMPLATE_COLUMNS)
    .eq('type', 'story')
    .eq('is_active', true)
    .in('plan', plans);
  if (error) throw error;

  let templates = (data ?? []).map(rowToCreativeTemplate);

  if (filters?.photoCountFilter) {
    templates = templates.filter((t) => {
      const n = t.photoSlots.length;
      return filters.photoCountFilter === '4+' ? n >= 4 : n === filters.photoCountFilter;
    });
  }
  if (filters?.tags && filters.tags.length > 0) {
    const wanted = filters.tags;
    templates = templates.filter((t) => wanted.every((tag) => t.tags.includes(tag)));
  }
  if (filters?.search && filters.search.trim()) {
    const q = filters.search.trim().toLowerCase();
    templates = templates.filter((t) => t.name.toLowerCase().includes(q) || t.tags.some((tag) => tag.toLowerCase().includes(q)));
  }
  return templates;
}

export async function getCreativeTemplateById(id: string): Promise<CreativeTemplate | null> {
  const { data, error } = await supabase
    .from('templates')
    .select(TEMPLATE_COLUMNS)
    .eq('id', id)
    .maybeSingle();
  if (error || !data) return null;
  return rowToCreativeTemplate(data);
}
