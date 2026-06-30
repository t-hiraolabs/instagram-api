import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const ANTHROPIC_API_KEY = Deno.env.get('ANTHROPIC_API_KEY')!;
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;
// Supabaseが自動で用意するサービスロールキー（profilesの更新に使う＝RLSを越えて書き込める）
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

// プランごとの月間AI回数の上限
const LIMITS: Record<string, number> = { free: 5, pro: 50, business: 300 };

// ブランド分析など「カウント対象外」のAI呼び出しに対する裏の月間上限（不正利用防止）
const BRAND_HIDDEN_LIMIT = 30;

// 同じ月か判定
function isSameMonth(periodStartStr: string): boolean {
  const today = new Date();
  const periodStart = new Date(`${periodStartStr}T00:00:00Z`);
  return (
    today.getUTCFullYear() === periodStart.getUTCFullYear() &&
    today.getUTCMonth() === periodStart.getUTCMonth()
  );
}

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

  // リクエスト本文を先に読む（skipCount=true はブランド分析などカウント対象外の呼び出し）
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return json({ error: 'リクエストの形式が不正です' }, 400);
  }
  const skipCount = body.skipCount === true;
  delete body.skipCount; // Anthropicへは渡さない

  // --- プラン・使用回数を確認（service roleでprofilesを読み書き）---
  const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  let { data: profile } = await admin
    .from('profiles')
    .select('plan, ai_used, ai_period_start, brand_ai_used, brand_ai_period_start')
    .eq('id', user.id)
    .maybeSingle();

  // 念のため: profilesが無ければ作る
  if (!profile) {
    await admin.from('profiles').insert({ id: user.id }).select();
    const td = new Date().toISOString().slice(0, 10);
    profile = { plan: 'free', ai_used: 0, ai_period_start: td, brand_ai_used: 0, brand_ai_period_start: td };
  }

  const plan = profile.plan === 'pro' || profile.plan === 'business' ? profile.plan : 'free';
  const limit = LIMITS[plan];

  // === カウント対象外（ブランド分析など）: 通常回数を消費せず、裏の上限のみチェック ===
  if (skipCount) {
    const todayStr = new Date().toISOString().slice(0, 10);
    const bStart = profile.brand_ai_period_start ?? todayStr;
    const bResets = !isSameMonth(bStart);
    const bUsed = bResets ? 0 : (profile.brand_ai_used ?? 0);
    const bPeriodStart = bResets ? todayStr : bStart;

    if (bUsed >= BRAND_HIDDEN_LIMIT) {
      return json(
        { error: 'AI分析の利用が一時的に制限されています。しばらくしてからお試しください。', code: 'BRAND_LIMIT' },
        429
      );
    }

    try {
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
      if (res.ok) {
        await admin
          .from('profiles')
          .update({ brand_ai_used: bUsed + 1, brand_ai_period_start: bPeriodStart })
          .eq('id', user.id);
      }
      return new Response(data, {
        status: res.status,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    } catch (err) {
      return json({ error: String(err) }, 500);
    }
  }

  // 有料プランは月が変わったらカウントをリセット（毎月の上限）。
  // 無料プランは月でリセットせず、1アカウントあたり累計の上限とする。
  const today = new Date();
  const periodStart = new Date(`${profile.ai_period_start}T00:00:00Z`);
  const sameMonth =
    today.getUTCFullYear() === periodStart.getUTCFullYear() &&
    today.getUTCMonth() === periodStart.getUTCMonth();
  const resets = plan !== 'free' && !sameMonth;
  const used = resets ? 0 : (profile.ai_used ?? 0);
  const newPeriodStart = resets ? today.toISOString().slice(0, 10) : profile.ai_period_start;

  // 上限に達していたら止める
  if (used >= limit) {
    const msg =
      plan === 'free'
        ? `無料プランのAI生成は1アカウント${limit}回までです。Proなら月${LIMITS.pro}回、ビジネスなら月${LIMITS.business}回使えます。`
        : plan === 'pro'
        ? `今月のAI生成（月${limit}回）を使い切りました。たくさん使うならビジネスプラン（月${LIMITS.business}回）へのアップグレードがおすすめです。`
        : `今月のAI生成回数の上限（${limit}回）に達しました。来月またご利用いただけます。`;
    return json({ error: msg, code: 'AI_LIMIT', plan, limit, used }, 429);
  }

  try {
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
