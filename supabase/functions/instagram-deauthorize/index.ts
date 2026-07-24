// Meta（Instagram/Facebook）の「承認取り消しURL（Deauthorize callback URL）」向けエンドポイント。
// ユーザーがInstagram/Facebook側の設定からこのアプリの連携を解除すると、Metaがここへ
// signed_request（HMAC-SHA256署名付きペイロード）をPOSTしてくる。署名を検証し、
// 含まれるuser_id（Instagram連携アカウントのID = 各テーブルのig_user_id）に紐づく
// サーバー側データを削除する（src/services/dataDeletionService.tsの
// deleteAccountDataと同じ削除対象を、サービスロールキーでサーバー側から行う版）。
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const APP_SECRET = Deno.env.get('INSTAGRAM_APP_SECRET')!;
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

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

function base64UrlToBytes(input: string): Uint8Array {
  const b64 = input.replace(/-/g, '+').replace(/_/g, '/');
  const pad = b64.length % 4;
  const padded = pad === 2 ? b64 + '==' : pad === 3 ? b64 + '=' : b64;
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function hmacSha256Base64Url(secret: string, message: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  );
  const sigBuf = await crypto.subtle.sign('HMAC', key, enc.encode(message));
  return bytesToBase64Url(new Uint8Array(sigBuf));
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });

  try {
    // Metaはapplication/x-www-form-urlencodedでsigned_requestを送ってくる
    const contentType = req.headers.get('content-type') ?? '';
    let signedRequest: string | null = null;
    if (contentType.includes('application/json')) {
      const body = await req.json().catch(() => ({}));
      signedRequest = body?.signed_request ?? null;
    } else {
      const text = await req.text();
      signedRequest = new URLSearchParams(text).get('signed_request');
    }

    if (!signedRequest || !signedRequest.includes('.')) {
      return json({ error: 'signed_requestがありません' }, 400);
    }

    const [sigPart, payloadPart] = signedRequest.split('.');
    const expectedSig = await hmacSha256Base64Url(APP_SECRET, payloadPart);
    if (expectedSig !== sigPart) {
      return json({ error: '署名が一致しません' }, 403);
    }

    const payload = JSON.parse(new TextDecoder().decode(base64UrlToBytes(payloadPart)));
    const igUserId = payload?.user_id ? String(payload.user_id) : '';

    if (igUserId) {
      const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
      await Promise.all([
        admin.from('brand_settings').delete().eq('ig_user_id', igUserId),
        admin.from('ig_first_analysis').delete().eq('ig_user_id', igUserId),
        admin.from('marketing_guide_cache').delete().eq('ig_user_id', igUserId),
        admin.from('story_drafts').delete().eq('ig_user_id', igUserId),
        admin.from('chat_conversations').delete().eq('ig_user_id', igUserId),
        admin.from('follower_snapshots').delete().eq('ig_user_id', igUserId),
      ]);
    }

    return json({ success: true });
  } catch (err) {
    return json({ error: String(err) }, 500);
  }
});
