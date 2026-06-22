// Pro（¥980/月）の決済（Stripe Checkout）を開始する関数。
// ログイン中ユーザーの Checkout セッションを作り、決済ページのURLを返す。
import Stripe from 'https://esm.sh/stripe@16?target=deno';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const STRIPE_SECRET_KEY = Deno.env.get('STRIPE_SECRET_KEY')!;
// Pro月額の価格ID（Supabaseの環境変数で上書き可。未設定ならサンドボックスの値）
const PRICE_ID = Deno.env.get('STRIPE_PRICE_ID') ?? 'price_1Tl9BnPkhuUZqJLebufUtrEj';
const APP_URL = Deno.env.get('APP_URL') ?? 'https://instagram-api-alpha.vercel.app/';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

const stripe = new Stripe(STRIPE_SECRET_KEY, {
  apiVersion: '2024-06-20',
  httpClient: Stripe.createFetchHttpClient(),
});

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });

  try {
    // --- ログイン確認 ---
    const token = (req.headers.get('Authorization') ?? '').replace('Bearer ', '').trim();
    const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);
    if (authError || !user) return json({ error: 'ログインが必要です' }, 401);

    const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    const { data: profile } = await admin
      .from('profiles')
      .select('plan, stripe_customer_id')
      .eq('id', user.id)
      .maybeSingle();

    if (profile?.plan === 'pro') {
      return json({ error: 'すでにProプランです' }, 400);
    }

    // --- Stripe顧客（無ければ作成して保存）---
    let customerId = profile?.stripe_customer_id ?? null;
    if (!customerId) {
      const customer = await stripe.customers.create({
        email: user.email ?? undefined,
        metadata: { user_id: user.id },
      });
      customerId = customer.id;
      await admin.from('profiles').update({ stripe_customer_id: customerId }).eq('id', user.id);
    }

    // --- Checkoutセッション作成（サブスク）---
    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      customer: customerId,
      line_items: [{ price: PRICE_ID, quantity: 1 }],
      client_reference_id: user.id,
      metadata: { user_id: user.id },
      subscription_data: { metadata: { user_id: user.id } },
      success_url: `${APP_URL}?upgrade=success`,
      cancel_url: `${APP_URL}?upgrade=cancel`,
      locale: 'ja',
      allow_promotion_codes: true,
    });

    return json({ url: session.url });
  } catch (e) {
    return json({ error: '決済の開始に失敗しました', detail: String(e) }, 500);
  }
});
