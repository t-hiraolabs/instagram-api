import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const ANTHROPIC_API_KEY = Deno.env.get('ANTHROPIC_API_KEY')!;
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;
// Supabaseが自動で用意するサービスロールキー（profilesの更新に使う＝RLSを越えて書き込める）
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

// プランごとの月間AI回数の上限
const LIMITS: Record<string, number> = { free: 10, pro: 100 };

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  // --- ログイン済みユーザーか確認 ---
  const authHeader = req.headers.get('Authorization') ?? '';
  const token = authHeader.replace('Bearer ', '').trim();

  const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  const { data: { user }, error: authError } = await supabase.auth.getUser(token);

  if (authError || !user) {
    return json({ error: 'ログインが必要です' }, 401);
  }

  // --- プラン・使用回数を確認（service roleでprofilesを読み書き）---
  const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  let { data: profile } = await admin
    .from('profiles')
    .select('plan, ai_used, ai_period_start')
    .eq('id', user.id)
    .maybeSingle();

  // 念のため: profilesが無ければ作る
  if (!profile) {
    await admin.from('profiles').insert({ id: user.id }).select();
    profile = { plan: 'free', ai_used: 0, ai_period_start: new Date().toISOString().slice(0, 10) };
  }

  const plan = profile.plan === 'pro' ? 'pro' : 'free';
  const limit = LIMITS[plan];

  // 月が変わっていたらカウントをリセット（毎月の上限）
  const today = new Date();
  const periodStart = new Date(`${profile.ai_period_start}T00:00:00Z`);
  const sameMonth =
    today.getUTCFullYear() === periodStart.getUTCFullYear() &&
    today.getUTCMonth() === periodStart.getUTCMonth();
  const used = sameMonth ? (profile.ai_used ?? 0) : 0;
  const newPeriodStart = sameMonth ? profile.ai_period_start : today.toISOString().slice(0, 10);

  // 上限に達していたら止める
  if (used >= limit) {
    const msg =
      plan === 'free'
        ? `今月のAI生成回数の上限（${limit}回）に達しました。Proプランなら月${LIMITS.pro}回まで使えます。`
        : `今月のAI生成回数の上限（${limit}回）に達しました。来月またご利用いただけます。`;
    return json({ error: msg, code: 'AI_LIMIT', plan, limit, used }, 429);
  }

  try {
    const body = await req.json();

    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify(body),
    });

    const data = await res.text();

    // Anthropicが成功したときだけ1回ぶん加算
    if (res.ok) {
      await admin
        .from('profiles')
        .update({ ai_used: used + 1, ai_period_start: newPeriodStart })
        .eq('id', user.id);
    }

    return new Response(data, {
      status: res.status,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (err) {
    return json({ error: String(err) }, 500);
  }
});
