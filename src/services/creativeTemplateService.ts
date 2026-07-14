// 「ストーリー作成」共通テンプレートのデータアクセス層。
// storyStudioService.ts（Story Studio専用）とcollageStyleService.ts（Collage専用）を
// 段階的に置き換えるための新設サービス。
//
// DB側の`templates`はまだtype='story'/'collage'に分かれたまま（フェーズ6で統一予定）。
// フェーズ4よりlistCreativeTemplatesはtype IN ('story','collage')で両方を横断的に読み、
// rowToCreativeTemplateが新旧いずれの形状も判定して新形式CreativeTemplateへ変換する。
// フェーズ6でDBのtype列を'story'へ統一した後、type='story'単独のクエリへ戻す
// （計画のフェーズ順序メモ参照）。
//
// フェーズ2の注記: 実データ調査の結果、templates(type='story')は0件（実運用データなし）
// だったため、SQLでの一括UPDATE移行は対象がなく実施していない。代わりに、旧形式
// （storyStudioService.tsのLayerDefaults: background/frame/flower/decorationが各
// {assetId削除済みで既に{url}}、photoSlotsが単なる個数）のまま残っている行を読んだ場合でも
// 壊れずに新形式へ変換できるよう、rowToCreativeTemplate内で寛容に読み取る（後述の
// convertLegacyStoryDefaults）。管理画面が存在しないStory Studioテンプレートは、今後も
// SQL直接投入で追加される可能性があるため、ビッグバンな一括移行より安全な設計とした。
//
// フェーズ3の注記: templates(type='collage')も同じく0件だった。ただしCollage側は
// AdminAssetsScreen.tsx経由で今後も（フェーズ6でこのサービスへ切り替えるまでは）旧形式
// のまま新規作成され続けるため、Story側以上に変換ロジックが実運用で必要になる。
// テキストレイヤーのy座標は旧Collage（ベースライン起点）と新形式（ボックス左上起点）で
// 意味が変わるため、fontSize*0.8を目安のascent量として引く近似変換を行っている
// （正確なフォントメトリクスに基づく変換ではないため、フェーズ5で実データ移行時に
// 目視確認が必要）。
import { supabase } from './supabaseClient';
import { Plan } from '../utils/plans';
import { CreativeTemplate, TemplateDefinitionV1, TemplateLayer, TextLayer, PhotoSlot, CANVAS_W, CANVAS_H } from '../types/creativeTemplate';

/** ユーザーが許可されているプラン（自分と同格以下）を返す */
export function allowedPlans(plan: Plan): Plan[] {
  if (plan === 'business') return ['free', 'pro', 'business'];
  if (plan === 'pro') return ['free', 'pro'];
  return ['free'];
}

const TEMPLATE_COLUMNS = 'id, name, layer_defaults, plan, thumbnail_url, tags, is_active';

/** 旧storyStudioService.tsのLayerDefaults形（background/frame/flower/decorationが{url}、
 *  photoSlotsが単なる個数）。storyLayerBuilder.tsが行っていたレイヤー組み立てを、
 *  「都度組み立てる」のではなく「テンプレートの保存データに焼き込む」形へ変換する。 */
interface LegacyStoryLayerDefaults {
  background?: { url: string };
  frame?: { url: string };
  flower?: { url: string };
  decoration?: { url: string };
  photoSlots?: number;
  font?: string;
  titleColor?: string;
}

/** 旧Story Studioのフォントラベル（実際にはfontFamilyへ反映されていなかった）を
 *  新しい共有フォントプリセットIDへ対応付ける */
const LEGACY_FONT_MAP: Record<string, string> = {
  default: 'gothic', luxury: 'mincho', rounded: 'rounded', handwritten: 'yomogi',
};

function isLegacyStoryShape(def: any): def is LegacyStoryLayerDefaults {
  return def && typeof def === 'object' && def.version !== 1 && (
    'background' in def || 'frame' in def || 'flower' in def || 'decoration' in def || 'photoSlots' in def
  );
}

/** 旧形式のlayer_defaultsを新形式（TemplateDefinitionV1）へ変換する。
 *  storyLayerBuilder.tsが持っていた固定座標（flower/decorationの位置・サイズ、
 *  見出し/CTAテキストの初期位置）を、この変換時にテンプレートごとの保存データとして
 *  焼き込む（今までは呼び出しのたびに毎回同じ位置を機械的に組み立てていたが、
 *  これでテンプレートごとに編集可能なデータになる）。 */
function convertLegacyStoryDefaults(def: LegacyStoryLayerDefaults): TemplateDefinitionV1 {
  const photoCount = Math.max(1, def.photoSlots ?? 1);
  const photoSlots: PhotoSlot[] = Array.from({ length: photoCount }, (_, i) => ({
    id: `photo_${i + 1}`, x: 0, y: i * 40, w: CANVAS_W, h: CANVAS_H,
  }));

  const layers: TemplateLayer[] = [];
  if (def.background) layers.push({ id: 'background', kind: 'background', band: 'background', uri: def.background.url, x: 0, y: 0, w: CANVAS_W, h: CANVAS_H });
  if (def.frame) layers.push({ id: 'frame', kind: 'frame', band: 'frame', uri: def.frame.url, x: 0, y: 0, w: CANVAS_W, h: CANVAS_H });
  if (def.flower) layers.push({ id: 'flower', kind: 'decoration', band: 'decorFront', uri: def.flower.url, x: 780, y: 60, w: 260, h: 260 });
  if (def.decoration) layers.push({ id: 'decoration', kind: 'decoration', band: 'decorFront', uri: def.decoration.url, x: 60, y: 1500, w: 260, h: 260 });

  const font = LEGACY_FONT_MAP[def.font ?? ''] ?? 'gothic';
  const textLayers: TextLayer[] = [
    { id: 'title', label: '見出し', text: 'テキストを入力', x: 100, y: 260, font, color: def.titleColor ?? '#FFFFFF', size: 72, scale: 1, rotation: 0, visible: true },
    { id: 'cta', label: 'CTA', text: '詳しくはプロフィールへ', x: 260, y: 1780, font: 'gothic', color: '#FFFFFF', size: 36, scale: 1, rotation: 0, visible: true, isCta: true },
  ];

  return { version: 1, photoSlots, layers, textLayers };
}

/** 旧collageStyleService.tsのlayer_defaults形（backgroundImageUrl/photoAreas/
 *  textLayers/decorations）。collageCompositor.tsのCOLLAGE_FONT_PRESETS（29種）で
 *  使われていたIDのうち、新しい共有プリセット（8種）と同名のものはそのまま流用し、
 *  それ以外は雰囲気が近いものへ寄せる。 */
interface LegacyCollagePhotoArea { x: number; y: number; w: number; h: number; zIndex?: number }
interface LegacyCollageTextLayer {
  id: string; label?: string; sampleText: string; x: number; y: number; maxWidth: number;
  align?: 'left' | 'center' | 'right'; fontSize?: number; font?: string; color?: string;
  lineHeight?: number; letterSpacing?: number; maxLines?: number; rotation?: number; zIndex?: number;
}
interface LegacyCollageDecoration { imageUrl: string; x: number; y: number; w: number; h: number; zIndex?: number }
interface LegacyCollageLayerDefaults {
  backgroundImageUrl?: string;
  photoAreas?: LegacyCollagePhotoArea[];
  textLayers?: LegacyCollageTextLayer[];
  decorations?: LegacyCollageDecoration[];
}

const LEGACY_COLLAGE_FONT_MAP: Record<string, string> = {
  // 新プリセットと同名のIDはそのまま
  gothic: 'gothic', mincho: 'mincho', rounded: 'rounded', decor: 'decor',
  zenmaru: 'zenmaru', yomogi: 'yomogi', reggae: 'reggae', delagothic: 'delagothic',
  // それ以外は雰囲気の近いものへ寄せる
  zenoldmincho: 'mincho', kaiseiopti: 'mincho', kaiseiharuno: 'mincho', kaiseitokumin: 'mincho',
  sawarabimincho: 'mincho', hinamincho: 'mincho', shipporiantique: 'mincho',
  zenantique: 'gothic', zenantiquesoft: 'gothic', zenkurenaido: 'gothic',
  sawarabigothic: 'gothic', dotgothic16: 'gothic', bizudgothic: 'gothic', yusei: 'gothic',
  kosugimaru: 'rounded', kiwimaru: 'rounded',
  hachimaru: 'yomogi', kleeone: 'yomogi', mochiypop: 'yomogi',
  rocknroll: 'delagothic', rampart: 'delagothic',
};

function isLegacyCollageShape(def: any): def is LegacyCollageLayerDefaults {
  return def && typeof def === 'object' && def.version !== 1 && (
    'backgroundImageUrl' in def || 'photoAreas' in def || 'decorations' in def
  );
}

/** 旧Collageのlayer_defaultsを新形式へ変換する。テキストのy座標はベースライン起点→
 *  ボックス左上起点への近似変換（fontSize*0.8を目安のascent量として引く）を伴う。 */
function convertLegacyCollageDefaults(def: LegacyCollageLayerDefaults): TemplateDefinitionV1 {
  const photoSlots: PhotoSlot[] = (def.photoAreas ?? []).map((a, i) => ({
    id: `photo_${i + 1}`, x: a.x, y: a.y, w: a.w, h: a.h, zIndex: a.zIndex,
  }));

  const layers: TemplateLayer[] = [];
  if (def.backgroundImageUrl) {
    layers.push({ id: 'background', kind: 'background', band: 'background', uri: def.backgroundImageUrl, x: 0, y: 0, w: CANVAS_W, h: CANVAS_H });
  }
  (def.decorations ?? []).forEach((d, i) => {
    layers.push({ id: `decoration_${i + 1}`, kind: 'decoration', band: 'decorFront', uri: d.imageUrl, x: d.x, y: d.y, w: d.w, h: d.h, zIndex: d.zIndex });
  });

  const textLayers: TextLayer[] = (def.textLayers ?? []).map((t) => {
    const size = t.fontSize ?? 40;
    return {
      id: t.id, label: t.label, text: t.sampleText,
      x: t.x, y: t.y - size * 0.8,
      maxWidth: t.maxWidth, align: t.align,
      font: LEGACY_COLLAGE_FONT_MAP[t.font ?? ''] ?? 'gothic',
      color: t.color ?? '#FFFFFF', size,
      lineHeight: t.lineHeight, letterSpacing: t.letterSpacing, maxLines: t.maxLines,
      scale: 1, rotation: t.rotation ?? 0, visible: true, zIndex: t.zIndex,
    };
  });

  return { version: 1, photoSlots, layers, textLayers };
}

function rowToCreativeTemplate(row: any): CreativeTemplate {
  const raw = row.layer_defaults ?? {};
  let def: TemplateDefinitionV1;
  if (isLegacyStoryShape(raw)) def = convertLegacyStoryDefaults(raw);
  else if (isLegacyCollageShape(raw)) def = convertLegacyCollageDefaults(raw);
  else def = raw as TemplateDefinitionV1;
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
  // フェーズ4: DBのtype列自体はまだ'story'/'collage'に分かれたまま（統一はフェーズ6）。
  // 新ギャラリーは両方を横断的に読み、rowToCreativeTemplateが形状を自動判定して
  // 新形式CreativeTemplate（type:'story'固定）へ変換する。
  const { data, error } = await supabase
    .from('templates')
    .select(TEMPLATE_COLUMNS)
    .in('type', ['story', 'collage'])
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
