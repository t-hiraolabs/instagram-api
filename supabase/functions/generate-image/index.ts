// テキストから画像を生成する（OpenAI gpt-image-1）。プランごとに月間上限あり。
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const OPENAI_API_KEY = Deno.env.get('OPENAI_API_KEY')!;
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

// プランごとの月間画像生成上限（画像生成はビジネス限定）
const IMG_LIMITS: Record<string, number> = { free: 0, pro: 0, business: 60 };

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
}

function isSameMonth(s: string): boolean {
  const t = new Date();
  const p = new Date(`${s}T00:00:00Z`);
  return t.getUTCFullYear() === p.getUTCFullYear() && t.getUTCMonth() === p.getUTCMonth();
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  const authHeader = req.headers.get('Authorization') ?? '';
  const token = authHeader.replace('Bearer ', '').trim();
  const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  const { data: { user }, error: authError } = await supabase.auth.getUser(token);
  if (authError || !user) return json({ error: 'ログインが必要です' }, 401);

  const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
  let { data: profile } = await admin
    .from('profiles')
    .select('plan, img_used, img_period_start')
    .eq('id', user.id)
    .maybeSingle();
  if (!profile) {
    await admin.from('profiles').insert({ id: user.id }).select();
    profile = { plan: 'free', img_used: 0, img_period_start: new Date().toISOString().slice(0, 10) };
  }

  const plan = profile.plan === 'pro' || profile.plan === 'business' ? profile.plan : 'free';
  const limit = IMG_LIMITS[plan];
  const todayStr = new Date().toISOString().slice(0, 10);
  const start = profile.img_period_start ?? todayStr;
  const resets = !isSameMonth(start);
  const used = resets ? 0 : (profile.img_used ?? 0);
  const periodStart = resets ? todayStr : start;

  const remaining = Math.max(0, limit - used);
  if (remaining <= 0) {
    const msg = plan !== 'business'
      ? `AI画像生成はビジネスプラン限定です。ビジネスなら月${IMG_LIMITS.business}枚まで使えます。`
      : `今月の画像生成の上限（${limit}枚）に達しました。来月またご利用いただけます。`;
    return json({ error: msg, code: 'IMG_LIMIT' }, 429);
  }

  try {
    const { prompt, size, n } = await req.json();
    if (!prompt || !String(prompt).trim()) return json({ error: 'プロンプトを入力してください' }, 400);

    const count = Math.max(1, Math.min(Number(n) || 1, 4));
    if (count > remaining) {
      return json({ error: `残り${remaining}枚です。${count}枚は生成できません。`, code: 'IMG_LIMIT' }, 429);
    }

    const res = await fetch('https://api.openai.com/v1/images/generations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${OPENAI_API_KEY}` },
      body: JSON.stringify({
        model: 'gpt-image-1',
        prompt: String(prompt),
        size: size === '1024x1536' || size === '1536x1024' ? size : '1024x1024',
        n: count,
      }),
    });
    const data = await res.json();
    if (!res.ok) return json({ error: '画像生成に失敗しました', detail: data }, 400);

    const items: string[] = (data?.data ?? [])
      .map((d: { b64_json?: string }) => d.b64_json)
      .filter(Boolean)
      .map((b: string) => `data:image/png;base64,${b}`);
    if (items.length === 0) return json({ error: '画像の取得に失敗しました', detail: data }, 400);

    // 成功枚数ぶん加算
    const newUsed = used + items.length;
    await admin.from('profiles').update({ img_used: newUsed, img_period_start: periodStart }).eq('id', user.id);

    return json({ images: items, remaining: Math.max(0, limit - newUsed) });
  } catch (err) {
    return json({ error: String(err) }, 500);
  }
});
