// テキストから画像を生成する（generate-image エッジ関数 → OpenAI）
import { supabase } from './supabaseClient';

const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL ?? '';
const SUPABASE_ANON_KEY = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? '';

export type ImageSize = '1024x1024' | '1024x1536' | '1536x1024';

// クライアント側の表示用（サーバーの IMG_LIMITS と揃える）
const IMG_LIMITS: Record<string, number> = { free: 2, pro: 15, business: 60 };

export interface ImageUsage { used: number; limit: number; remaining: number; }

function sameMonth(s: string): boolean {
  const t = new Date();
  const p = new Date(`${s}T00:00:00Z`);
  return t.getUTCFullYear() === p.getUTCFullYear() && t.getUTCMonth() === p.getUTCMonth();
}

/** 画像生成の残り枚数を取得（自分のprofileを読む） */
export async function getImageUsage(): Promise<ImageUsage> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { used: 0, limit: IMG_LIMITS.free, remaining: IMG_LIMITS.free };
  const { data } = await supabase
    .from('profiles')
    .select('plan, img_used, img_period_start')
    .eq('id', user.id)
    .maybeSingle();
  const plan = data?.plan === 'pro' || data?.plan === 'business' ? data.plan : 'free';
  const limit = IMG_LIMITS[plan];
  const start = data?.img_period_start ?? new Date().toISOString().slice(0, 10);
  const used = start && sameMonth(start) ? (data?.img_used ?? 0) : 0;
  return { used, limit, remaining: Math.max(0, limit - used) };
}

/** プロンプトから画像を n 枚生成し、data URL 配列と残り枚数を返す */
export async function generateImages(
  prompt: string,
  n = 1,
  size: ImageSize = '1024x1024'
): Promise<{ images: string[]; remaining: number }> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token ?? SUPABASE_ANON_KEY;
  const res = await fetch(`${SUPABASE_URL}/functions/v1/generate-image`, {
    method: 'POST',
    headers: {
      apikey: SUPABASE_ANON_KEY,
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ prompt, size, n }),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || json.error) {
    throw new Error(json.error ?? `画像生成に失敗しました (${res.status})`);
  }
  return { images: (json.images ?? []) as string[], remaining: json.remaining ?? 0 };
}
