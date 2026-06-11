import { supabase } from './supabaseClient';

export type RepeatOption = 'none' | 'daily' | 'weekly' | 'monthly' | 'weekdays';

export interface ScheduledPost {
  id: string;
  caption: string;
  hashtags: string[];
  image_url: string | null;
  scheduled_at: string;
  status: 'pending' | 'published' | 'failed';
  type: 'feed' | 'story' | 'reel';
  repeat: RepeatOption;
  instagram_user_id: string | null;
  access_token: string | null;
  created_at: string;
}

export interface CreateScheduledPostInput {
  caption: string;
  hashtags: string[];
  image_url?: string;
  scheduled_at: Date;
  type: 'feed' | 'story' | 'reel';
  repeat?: RepeatOption;
  instagram_user_id?: string;
  access_token?: string;
}

export async function getScheduledPosts(): Promise<ScheduledPost[]> {
  const { data, error } = await supabase
    .from('scheduled_posts')
    .select('*')
    .order('scheduled_at', { ascending: true });

  if (error) throw error;
  return data ?? [];
}

export async function createScheduledPost(input: CreateScheduledPostInput): Promise<ScheduledPost> {
  const { data, error } = await supabase
    .from('scheduled_posts')
    .insert({
      ...input,
      scheduled_at: input.scheduled_at.toISOString(),
    })
    .select()
    .single();

  if (error) throw error;
  return data;
}

export async function deleteScheduledPost(id: string): Promise<void> {
  const { error } = await supabase.from('scheduled_posts').delete().eq('id', id);
  if (error) throw error;
}

export interface UpdateScheduledPostInput {
  caption?: string;
  hashtags?: string[];
  scheduled_at?: Date;
  repeat?: RepeatOption;
}

/** 予約投稿の内容を更新する（キャプション・ハッシュタグ・日時・くりかえし） */
export async function updateScheduledPost(
  id: string,
  fields: UpdateScheduledPostInput
): Promise<void> {
  const payload: Record<string, unknown> = {};
  if (fields.caption !== undefined) payload.caption = fields.caption;
  if (fields.hashtags !== undefined) payload.hashtags = fields.hashtags;
  if (fields.repeat !== undefined) payload.repeat = fields.repeat;
  if (fields.scheduled_at) payload.scheduled_at = fields.scheduled_at.toISOString();

  const { error } = await supabase.from('scheduled_posts').update(payload).eq('id', id);
  if (error) throw error;
}

/** ログイン中ユーザーのプラン（free / pro）を取得 */
export async function getMyPlan(): Promise<'free' | 'pro'> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return 'free';
  const { data } = await supabase
    .from('profiles')
    .select('plan')
    .eq('id', user.id)
    .maybeSingle();
  return data?.plan === 'pro' ? 'pro' : 'free';
}

export interface AiUsage {
  plan: 'free' | 'pro';
  used: number;
  limit: number;
  remaining: number;
}

const AI_LIMITS = { free: 10, pro: 300 } as const;

/** 今月のAI生成の使用状況（残り回数など）を取得 */
export async function getAiUsage(): Promise<AiUsage> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { plan: 'free', used: 0, limit: AI_LIMITS.free, remaining: AI_LIMITS.free };

  const { data } = await supabase
    .from('profiles')
    .select('plan, ai_used, ai_period_start')
    .eq('id', user.id)
    .maybeSingle();

  const plan = data?.plan === 'pro' ? 'pro' : 'free';
  const limit = AI_LIMITS[plan];

  // 月が変わっていたら使用回数は0扱い（実際のリセットは次回のAI呼び出し時）
  let used = data?.ai_used ?? 0;
  if (data?.ai_period_start) {
    const start = new Date(`${data.ai_period_start}T00:00:00Z`);
    const now = new Date();
    const sameMonth =
      now.getUTCFullYear() === start.getUTCFullYear() &&
      now.getUTCMonth() === start.getUTCMonth();
    if (!sameMonth) used = 0;
  }

  return { plan, used, limit, remaining: Math.max(0, limit - used) };
}
