// Stripeからの通知（Webhook）を受け取り、profiles.plan を更新する関数。
// 決済完了 → 'pro' に、解約/失効 → 'free' に戻す。
// ※ Stripeが呼ぶので「Verify JWT」は必ず OFF にすること。
import Stripe from 'https://esm.sh/stripe@16?target=deno';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const STRIPE_SECRET_KEY = Deno.env.get('STRIPE_SECRET_KEY')!;
const STRIPE_WEBHOOK_SECRET = Deno.env.get('STRIPE_WEBHOOK_SECRET')!;
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

const stripe = new Stripe(STRIPE_SECRET_KEY, {
  apiVersion: '2024-06-20',
  httpClient: Stripe.createFetchHttpClient(),
});
const cryptoProvider = Stripe.createSubtleCryptoProvider();
const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

type Plan = 'free' | 'pro' | 'business';

async function setPlanByCustomer(customerId: string, plan: Plan, subId?: string | null) {
  const update: Record<string, unknown> = { plan };
  if (subId !== undefined) update.stripe_subscription_id = subId;
  await admin.from('profiles').update(update).eq('stripe_customer_id', customerId);
}

// サブスクのメタデータから購入プランを判定（既定はpro）
function planFromMeta(meta: Record<string, string> | null | undefined): Plan {
  return meta?.plan === 'business' ? 'business' : 'pro';
}

Deno.serve(async (req) => {
  const sig = req.headers.get('stripe-signature');
  const body = await req.text(); // 署名検証には生のbodyが必要
  if (!sig) return new Response('missing signature', { status: 400 });

  let event: Stripe.Event;
  try {
    event = await stripe.webhooks.constructEventAsync(
      body,
      sig,
      STRIPE_WEBHOOK_SECRET,
      undefined,
      cryptoProvider,
    );
  } catch (e) {
    return new Response(`署名検証に失敗: ${String(e)}`, { status: 400 });
  }

  try {
    switch (event.type) {
      // 決済が完了 → Proに
      case 'checkout.session.completed': {
        const s = event.data.object as Stripe.Checkout.Session;
        const userId = s.client_reference_id || (s.metadata?.user_id ?? null);
        const customerId = typeof s.customer === 'string' ? s.customer : s.customer?.id;
        const subId = typeof s.subscription === 'string' ? s.subscription : s.subscription?.id;
        const plan = planFromMeta(s.metadata);
        if (userId) {
          await admin
            .from('profiles')
            .update({ plan, stripe_customer_id: customerId, stripe_subscription_id: subId })
            .eq('id', userId);
        } else if (customerId) {
          await setPlanByCustomer(customerId, plan, subId);
        }
        break;
      }

      // サブスクの状態変化（支払い失敗・解約予約など）
      case 'customer.subscription.updated': {
        const sub = event.data.object as Stripe.Subscription;
        const customerId = typeof sub.customer === 'string' ? sub.customer : sub.customer?.id;
        const active = sub.status === 'active' || sub.status === 'trialing';
        if (customerId) {
          await setPlanByCustomer(customerId, active ? planFromMeta(sub.metadata) : 'free', sub.id);
        }
        break;
      }

      // 解約（期間満了）→ Freeに戻す
      case 'customer.subscription.deleted': {
        const sub = event.data.object as Stripe.Subscription;
        const customerId = typeof sub.customer === 'string' ? sub.customer : sub.customer?.id;
        if (customerId) await setPlanByCustomer(customerId, 'free', null);
        break;
      }
    }
    return new Response(JSON.stringify({ received: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (e) {
    return new Response(`処理エラー: ${String(e)}`, { status: 500 });
  }
});
