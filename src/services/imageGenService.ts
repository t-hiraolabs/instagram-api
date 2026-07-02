// テキストから画像を生成する（generate-image エッジ関数 → OpenAI）
import { supabase } from './supabaseClient';

const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL ?? '';
const SUPABASE_ANON_KEY = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? '';

export type ImageSize = '1024x1024' | '1024x1536' | '1536x1024';

/** プロンプトから画像を生成し、data URL を返す。失敗時は分かりやすいエラーをthrow */
export async function generateImage(prompt: string, size: ImageSize = '1024x1024'): Promise<string> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token ?? SUPABASE_ANON_KEY;
  const res = await fetch(`${SUPABASE_URL}/functions/v1/generate-image`, {
    method: 'POST',
    headers: {
      apikey: SUPABASE_ANON_KEY,
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ prompt, size }),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || json.error) {
    throw new Error(json.error ?? `画像生成に失敗しました (${res.status})`);
  }
  return json.image as string;
}
