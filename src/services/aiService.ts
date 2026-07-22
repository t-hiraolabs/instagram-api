import axios from 'axios';
import { useAppStore } from '../store/appStore';
import { supabase } from './supabaseClient';
import { CHAT_LIMITS, Plan } from '../utils/plans';

const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL ?? '';
const SUPABASE_ANON_KEY = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? '';
const CLAUDE_API_URL = `${SUPABASE_URL}/functions/v1/claude`;
const MODEL = 'claude-sonnet-4-6';

// ログイン中ユーザーの本人確認トークンを付けたヘッダーを返す
async function getAuthHeaders() {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token ?? SUPABASE_ANON_KEY;
  return {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${token}`,
    apikey: SUPABASE_ANON_KEY,
  };
}

// サーバーから返ってきたエラーメッセージ（回数上限など）を分かりやすく取り出す
function extractError(err: unknown): string {
  if (axios.isAxiosError(err)) {
    return err.response?.data?.error ?? err.message;
  }
  return err instanceof Error ? err.message : 'AIの呼び出しに失敗しました';
}

// AIの応答からJSON部分だけを取り出してパースする。「JSONのみで返答」と指示していても、
// 前置き・お詫び・補足などの説明文が前後に付くことがあるため、コードフェンスを外すだけでは
// JSON.parseが「Unrecognized token」で失敗する。最初の{から最後の}までを抜き出すことで、
// 前後に多少の説明文が混ざっていても頑健にパースできるようにする。
function extractJson<T>(raw: string): T {
  const match = raw.match(/\{[\s\S]*\}/);
  if (!match) throw new Error('AI応答のパースに失敗しました');
  return JSON.parse(match[0]) as T;
}

function getBrandContext(): string {
  const { brandSettings, brandSettings2, brandSettings3, activeAccountSlot } = useAppStore.getState();
  const { brandName, industry, atmosphere, targetAudience, location, tone } =
    activeAccountSlot === 3 ? brandSettings3 : activeAccountSlot === 2 ? brandSettings2 : brandSettings;
  const parts: string[] = [];
  if (brandName) parts.push(`ブランド名: ${brandName}`);
  if (industry) parts.push(`業種: ${industry}`);
  if (atmosphere) parts.push(`お店の雰囲気・こだわり: ${atmosphere}`);
  if (targetAudience) parts.push(`ターゲット層: ${targetAudience}`);
  if (location) parts.push(`所在地: ${location}`);
  if (tone) parts.push(`希望トーン: ${tone}`);
  return parts.length > 0 ? `\n\n【ブランド情報】\n${parts.join('\n')}` : '';
}

/** キャプション・ハッシュタグ生成に共通するSEO対策の指示。所在地があれば地域SEOも含める。 */
function seoInstructions(): string {
  const { brandSettings, brandSettings2, brandSettings3, activeAccountSlot } = useAppStore.getState();
  const { location } = activeAccountSlot === 3 ? brandSettings3 : activeAccountSlot === 2 ? brandSettings2 : brandSettings;
  const local = location
    ? `所在地は「${location}」です。地域名・市区町村名を自然に本文に1回入れ、` +
      `「#${location.replace(/[都道府県]$/, '')}」のような地域名ハッシュタグと、「業種＋地域名」を組み合わせた複合キーワードのハッシュタグ（例: 業種が飲食なら#${location}ランチ のような形）も含めてください。` +
      '地域名は正式名称と省略形（例: 今治市→今治）の両方をバランス良く混ぜてください。'
    : '';
  return (
    '\n\nSEO対策として、以下を必ず守ってください:' +
    '\n・キャプションの冒頭1文に、検索されやすい核となるキーワード（業種・商品名・シーンなど）を含める' +
    '\n・キャプション本文にも主要キーワードを不自然にならない範囲で1〜2回含める' +
    '\n・ハッシュタグは「ビッグワード（投稿数100万以上）」「ミドルワード（投稿数10万〜100万）」「スモールワード・ニッチワード（投稿数1万未満、競合が少なく上位表示されやすい）」をバランス良く組み合わせる' +
    local
  );
}

// ユーザーがAIに覚えさせた説明（事業・サービス内容）
function getMemoryContext(): string {
  const mem = useAppStore.getState().assistantMemory?.trim();
  return mem ? `\n\n【覚えておくこと】\n${mem}` : '';
}

export interface TopPost {
  caption: string;
  likes: number;
  comments: number;
}

/** 過去の投稿をプロンプトに差し込み、ユーザーの文体の癖を再現させる文脈ブロックを作る（空なら空文字） */
function topPostsContext(topPosts?: TopPost[]): string {
  if (!topPosts || topPosts.length === 0) return '';
  const samples = topPosts
    .slice(0, 8)
    .map((p, i) => `${i + 1}. ${(p.caption || '（キャプションなし）').slice(0, 200)}`)
    .join('\n');
  return `\n\n【このアカウントの過去の投稿（文体サンプル）】\n${samples}\n\n上記から、このユーザーの書き方の癖（語尾・口癖、絵文字や改行の使い方、一人称、文章のテンポ・長さ、よく使う言い回しやキーワード）を分析し、` +
    'いいね数の多さではなく「その人らしい書き方」を再現する形で今回の文章を書いてください。テーマや内容は今回の指示に従いつつ、口調だけをこのユーザーに寄せてください。';
}

interface GeneratePostInput {
  theme: string;
  tone: string;
  keywords: string[];
  includeHashtags: boolean;
  language: 'ja' | 'en';
  industry?: string;
  instruction?: string;
  topPosts?: TopPost[];
}

interface GeneratedPost {
  caption: string;
  hashtags: string[];
  suggestions: string[];
}

async function callClaude(prompt: string, systemPrompt: string, weeklyGuide = false): Promise<string> {
  try {
    const response = await axios.post(
      CLAUDE_API_URL,
      {
        model: MODEL,
        max_tokens: 1024,
        system: systemPrompt,
        messages: [{ role: 'user', content: prompt }],
        // 週次のアカウント分析はブランド分析用の上限（brand_ai_used）を共有せず、
        // 上限チェック無しで呼び出す（呼び出し元が既に週1回までに制限しているため）
        ...(weeklyGuide ? { weeklyGuide: true } : {}),
      },
      {
        headers: await getAuthHeaders(),
      }
    );
    return response.data.content[0].text;
  } catch (err) {
    throw new Error(extractError(err));
  }
}

export async function generatePost(input: GeneratePostInput): Promise<GeneratedPost> {
  const brandCtx = getBrandContext();
  const systemPrompt = `あなたは日本のInstagramマーケティングの専門家です。
個人事業主・中小企業のビジネスオーナー向けに、エンゲージメントを高める日本語の投稿文を生成します。
日本のInstagramユーザー文化（ハッシュタグ検索が活発・グローバル平均の3倍、ビジュアル重視、「映え」文化）を理解した最適な文章を作ります。
必ずJSONフォーマットだけで返答してください。余分なテキストは不要です。`;

  const prompt = `以下の条件でInstagramのフィード投稿を生成してください。${brandCtx}${topPostsContext(input.topPosts)}

テーマ: ${input.theme}
トーン: ${input.tone}
${input.industry ? `業種: ${input.industry}` : ''}
${input.instruction ? `追加の指示（最優先で従う）: ${input.instruction}` : ''}
キーワード: ${input.keywords.join(', ')}
ハッシュタグ: ${input.includeHashtags ? '含める（15〜20個）' : '含めない'}

ハッシュタグは日本語タグと英語タグをバランスよく混ぜ、人気タグと中規模タグ（投稿数10万〜100万）を組み合わせてください。
${seoInstructions()}

以下のJSONフォーマットで返してください:
{
  "caption": "投稿文（絵文字も含めて、改行あり、200〜400文字）",
  "hashtags": ["#ハッシュタグ1", "#ハッシュタグ2", ...],
  "suggestions": ["改善提案1", "改善提案2", "改善提案3"]
}`;

  const raw = await callClaude(prompt, systemPrompt);
  return extractJson<GeneratedPost>(raw);
}

/** 過去の人気投稿（いいね数）を分析し、その傾向をふまえてキャプションを生成（ビジネス限定） */
export async function generateFromTopPosts(input: {
  theme: string;
  topPosts: { caption: string; likes: number; comments: number }[];
  tone: string;
  industry?: string;
  instruction?: string;
}): Promise<GeneratedPost> {
  const brandCtx = getBrandContext();
  const systemPrompt = `あなたは日本のInstagramマーケティングの専門家です。
このアカウントの「過去に反応が良かった投稿（いいね・コメント数つき）」を分析し、
なぜ伸びたのか（テーマ・語り口・長さ・絵文字・ハッシュタグの使い方など）を読み取った上で、
その成功パターンを活かした新しいフィード投稿文を日本語で生成します。
必ずJSONフォーマットだけで返答してください。余分なテキストは不要です。`;

  const ranked = input.topPosts
    .slice(0, 5)
    .map(
      (p, i) =>
        `${i + 1}位（❤️${p.likes} / 💬${p.comments}）\n${(p.caption || '（キャプションなし）').slice(0, 280)}`
    )
    .join('\n\n---\n\n');

  const prompt = `以下は、このアカウントで過去に反応が良かった投稿です。${brandCtx}

【反応が良かった投稿トップ5】
${ranked}

これらの傾向（よく反応されるテーマ・トーン・文章の長さ・絵文字や改行の使い方・ハッシュタグの傾向）を分析し、
その成功パターンを活かして新しいフィード投稿を1つ作ってください。

新しい投稿のテーマ: ${input.theme || '上位投稿の傾向に最も近い、反応が取りやすいテーマで自由に'}
トーン: ${input.tone}
${input.industry ? `業種: ${input.industry}` : ''}
${input.instruction ? `追加の指示（最優先で従う）: ${input.instruction}` : ''}

ハッシュタグは15〜20個、日本語タグと英語タグをバランスよく。
${seoInstructions()}

以下のJSONフォーマットで返してください:
{
  "caption": "投稿文（絵文字も含めて、改行あり、200〜400文字）",
  "hashtags": ["#ハッシュタグ1", "#ハッシュタグ2", ...],
  "suggestions": ["なぜこの構成にしたか/過去の人気投稿から学んだ改善提案1", "提案2", "提案3"]
}`;

  const raw = await callClaude(prompt, systemPrompt);
  return extractJson<GeneratedPost>(raw);
}

export async function improveCaption(originalCaption: string): Promise<string[]> {
  const systemPrompt = `あなたはInstagramのエキスパートです。
日本のユーザー向けにキャプションを分析して改善案を3つ提案します。JSONで返してください。`;

  const prompt = `以下のキャプションを改善してください:\n\n"${originalCaption}"\n\n{"suggestions": ["改善案1（具体的に）", "改善案2（具体的に）", "改善案3（具体的に）"]}`;

  const raw = await callClaude(prompt, systemPrompt);
  const parsed = extractJson<{ suggestions: string[] }>(raw);
  return parsed.suggestions;
}

/** 既存キャプションを、指示（口調・長さなど）に従って書き直す */
export async function refineCaption(caption: string, instruction: string): Promise<string> {
  const systemPrompt = `あなたはInstagramのプロ編集者です。与えられたキャプションを、指示に従って自然な日本語で書き直します。必ずJSONフォーマットだけで返答してください。`;
  const prompt = `次のキャプションを、指示に従って書き直してください。意味は保ちつつ、指示を最優先で反映してください。

現在のキャプション:
"${caption}"

指示: ${instruction}

以下のJSONで返してください:
{"caption": "書き直したキャプション"}`;
  const raw = await callClaude(prompt, systemPrompt);
  return extractJson<{ caption: string }>(raw).caption;
}

export async function generateFromImage(input: {
  imageBase64: string;
  mimeType: 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp';
  contentType: 'feed' | 'story' | 'reel';
  tone: string;
  industry?: string;
  instruction?: string;
  topPosts?: TopPost[];
}): Promise<GeneratedPost> {
  const brandCtx = getBrandContext();
  const labels = { feed: 'フィード投稿', story: 'ストーリー', reel: 'リール' };

  const systemPrompt = `あなたは日本のInstagramマーケティングの専門家です。
画像の内容・雰囲気・感情を読み取り、日本の個人事業主向けの最適なInstagram${labels[input.contentType]}テキストを生成します。
必ずJSONフォーマットだけで返答してください。`;

  const extraInstructions =
    input.contentType === 'reel'
      ? '冒頭3秒で引きつけるフック文を先頭に。縦型動画向けに短く（2〜3文）。TikTok風の口語体でもOK。'
      : input.contentType === 'story'
      ? '24時間で消えるストーリーらしく、短くインパクト重視。アンケートや質問スタンプを促す一言を含める。'
      : '写真の世界観を伝える情感豊かな文章で。';

  let response;
  try {
    response = await axios.post(
      CLAUDE_API_URL,
      {
        model: MODEL,
        max_tokens: 1024,
        system: systemPrompt,
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'image',
                source: { type: 'base64', media_type: input.mimeType, data: input.imageBase64 },
              },
              {
                type: 'text',
                text: `この画像からInstagram${labels[input.contentType]}のコンテンツを生成してください。${brandCtx}${topPostsContext(input.topPosts)}
トーン: ${input.tone}
${input.industry ? `業種: ${input.industry}` : ''}
${input.instruction ? `追加の指示（最優先で従う）: ${input.instruction}` : ''}
${extraInstructions}

ハッシュタグは15〜20個、日英混合で。
${seoInstructions()}

{"caption":"投稿文（絵文字含む、200〜400文字）","hashtags":["#タグ1",...],"suggestions":["アドバイス1","アドバイス2","アドバイス3"]}`,
              },
            ],
          },
        ],
      },
      {
        headers: await getAuthHeaders(),
      }
    );
  } catch (err) {
    throw new Error(extractError(err));
  }

  const raw = response.data.content[0].text;
  return extractJson<GeneratedPost>(raw);
}

/** 複数の写真からキャプション・ハッシュタグを生成（カルーセル向け） */
export async function generateFromImages(input: {
  images: { base64: string; mimeType: 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp' }[];
  tone: string;
  industry?: string;
  instruction?: string;
  topPosts?: TopPost[];
}): Promise<GeneratedPost> {
  const brandCtx = getBrandContext();
  const systemPrompt = `あなたは日本のInstagramマーケティングの専門家です。
複数の写真の内容・雰囲気を読み取り、日本の個人事業主向けの最適なフィード投稿テキストを生成します。
必ずJSONフォーマットだけで返答してください。`;

  const content: any[] = input.images.map((im) => ({
    type: 'image',
    source: { type: 'base64', media_type: im.mimeType, data: im.base64 },
  }));
  content.push({
    type: 'text',
    text: `これら${input.images.length}枚の写真（カルーセル投稿）に合うInstagramフィードのキャプションを1つ作ってください。${brandCtx}${topPostsContext(input.topPosts)}
トーン: ${input.tone}
${input.industry ? `業種: ${input.industry}` : ''}
${input.instruction ? `追加の指示（最優先で従う）: ${input.instruction}` : ''}
写真全体の世界観が伝わる文章で。ハッシュタグは15〜20個、日英混合で。
${seoInstructions()}

{"caption":"投稿文（絵文字含む、200〜400文字）","hashtags":["#タグ1",...],"suggestions":["アドバイス1","アドバイス2","アドバイス3"]}`,
  });

  let response;
  try {
    response = await axios.post(
      CLAUDE_API_URL,
      { model: MODEL, max_tokens: 1024, system: systemPrompt, messages: [{ role: 'user', content }] },
      { headers: await getAuthHeaders() }
    );
  } catch (err) {
    throw new Error(extractError(err));
  }
  const raw = response.data.content[0].text;
  return extractJson<GeneratedPost>(raw);
}

export async function generateHashtags(theme: string, count: number = 15): Promise<string[]> {
  const brandCtx = getBrandContext();
  const systemPrompt = `あなたはInstagramのSEOエキスパートです。
日本のInstagramで効果的なハッシュタグを提案します。JSONで返してください。`;

  const prompt = `テーマ「${theme}」に関する効果的なInstagramハッシュタグを${count}個生成してください。${brandCtx}
日本語タグ（60%）と英語タグ（40%）を混ぜて、人気タグ3個・中規模タグ8個・ニッチタグ4個を含めてください。
${seoInstructions()}
{"hashtags": ["#タグ1", "#タグ2", ...]}`;

  const raw = await callClaude(prompt, systemPrompt);
  return extractJson<{ hashtags: string[] }>(raw).hashtags;
}

export interface MarketingGuideInput {
  /** アカウントの段階（立ち上げ期／成長期／定着期） */
  rankLabel: string;
  followersCount: number;
  mediaCount: number;
  avgLikes: number;
  avgComments: number;
  engagementRate: number | null;
  bestHourLabel: string | null;
  bestDowLabel: string | null;
  topPostCaption: string | null;
}

export interface MarketingGuide {
  headline: string;
  tips: string[];
}

/**
 * 「はじめてガイド」完了後に表示する、アカウントの実データに基づいたマーケティング
 * アドバイス。フォロワー数・エンゲージメント率など実際の数値を渡し、その段階の
 * アカウントが次にやると効果的なことをAIに提案させる。
 */
export async function generateMarketingGuide(input: MarketingGuideInput): Promise<MarketingGuide> {
  const brandCtx = getBrandContext();
  const systemPrompt = `あなたは日本のInstagramマーケティングの専門家です。
個人事業主・中小企業のアカウント運用者に向けて、実際のアカウントデータをもとに
次にやるべきことを具体的にアドバイスします。必ずJSONフォーマットだけで返答してください。`;

  const prompt = `以下は、あるInstagramアカウントの実際のデータです。${brandCtx}

段階: ${input.rankLabel}
フォロワー数: ${input.followersCount}人
投稿数: ${input.mediaCount}件
平均いいね数: ${Math.round(input.avgLikes)}
平均コメント数: ${Math.round(input.avgComments)}
エンゲージメント率: ${input.engagementRate !== null ? `${input.engagementRate}%` : '不明'}
${input.bestHourLabel ? `反応が良い時間帯: ${input.bestHourLabel}` : ''}
${input.bestDowLabel ? `反応が良い曜日: ${input.bestDowLabel}` : ''}
${input.topPostCaption ? `一番反応が良かった投稿の書き出し: 「${input.topPostCaption.slice(0, 80)}」` : ''}

このデータをふまえて、このアカウントが今の段階で次にやると効果的なことを、
具体的で実行しやすいアドバイスとして3〜4個挙げてください。数値の言い訳や一般論ではなく、
このアカウントの実データに触れながらアドバイスしてください。

以下のJSONフォーマットで返してください:
{
  "headline": "この段階のアカウントに向けた一言（20文字以内、励ましや現状を一言で表す）",
  "tips": ["アドバイス1（1〜2文、具体的に）", "アドバイス2", "アドバイス3"]
}`;

  // 週1回までしか呼ばれない（MarketingGuideCard側のweekKeyキャッシュで担保）分析系の
  // 機能なので、投稿文生成用のAI利用回数は消費せず、ブランド分析用の上限
  // （brand_ai_used、フリーは累計3回・リセット無し）とも共有しない。以前はここが
  // analyzeBrandFromPostsと同じ枠を共有しており、ブランド設定の自動生成を数回使った
  // だけでこの週次分析まで恒久的に失敗するようになっていた
  const raw = await callClaude(prompt, systemPrompt, true);
  return extractJson<MarketingGuide>(raw);
}

/**
 * マーケティングガイドに対するその場限りの質問チャット。ガイドの内容（段階・評価・
 * アドバイス）を文脈として渡し、フォローアップの質問に具体的に答える。
 * 通常のAI生成回数(ai_used)ではなく、アシスタント会話と同じ「チャットの利用量」
 * （月間トークン上限）を消費する（chat: true）。
 */
export async function askMarketingGuideQuestion(guideContext: string, history: ChatTurn[]): Promise<string> {
  const systemPrompt = `あなたは日本のInstagramマーケティングの専門家です。
以下は、あるユーザー向けに生成済みのマーケティングガイドの内容です。ユーザーからの
フォローアップの質問に、このガイドの内容に沿って具体的に答えてください。
一般論ではなく、このアカウントの段階・評価・アドバイス内容を踏まえて回答してください。
1回の回答は簡潔に（300字程度まで）。

${guideContext}`;

  const headers = await getAuthHeaders();
  const msgs = history.map((h) => ({ role: h.role, content: h.content }));
  try {
    const response = await axios.post(
      CLAUDE_API_URL,
      { model: MODEL, max_tokens: 1024, system: systemPrompt, messages: msgs, chat: true },
      { headers }
    );
    return response.data.content[0].text;
  } catch (err) {
    throw new Error(extractError(err));
  }
}

export interface SeasonalTheme {
  event: string;
  emoji: string;
  themes: string[];
  hashtags: string[];
}

export function getSeasonalThemes(month: number): SeasonalTheme[] {
  const events: Record<number, SeasonalTheme[]> = {
    1: [
      { event: 'お正月・新年', emoji: '🎍', themes: ['新年のご挨拶', '初売り・新春セール', '今年の目標'], hashtags: ['#お正月', '#新年', '#初売り'] },
      { event: '成人の日', emoji: '👘', themes: ['成人式コーデ', '振袖・袴', '新成人へのメッセージ'], hashtags: ['#成人式', '#振袖', '#成人の日'] },
    ],
    2: [
      { event: 'バレンタイン', emoji: '💝', themes: ['バレンタインギフト', 'チョコレート特集', 'カップル向けプラン'], hashtags: ['#バレンタイン', '#チョコレート', '#バレンタインデー'] },
      { event: '節分', emoji: '👹', themes: ['節分イベント', '恵方巻き', '春を呼ぶキャンペーン'], hashtags: ['#節分', '#恵方巻き', '#鬼は外'] },
    ],
    3: [
      { event: '春・桜', emoji: '🌸', themes: ['春コーデ', '桜スポット', '春の新作', '春限定メニュー'], hashtags: ['#春', '#桜', '#花見', '#春コーデ'] },
      { event: '卒業シーズン', emoji: '🎓', themes: ['卒業お祝い', '卒業式コーデ', '次のステップへ'], hashtags: ['#卒業', '#卒業式', '#卒業おめでとう'] },
      { event: 'ホワイトデー', emoji: '🤍', themes: ['ホワイトデーギフト', 'お返しスイーツ', '感謝を込めて'], hashtags: ['#ホワイトデー', '#ホワイトデーギフト'] },
    ],
    4: [
      { event: '花見シーズン', emoji: '🌸', themes: ['お花見コーデ', '桜の名所', '春限定商品', '新生活応援'], hashtags: ['#花見', '#桜', '#お花見', '#春'] },
      { event: '入学・入社', emoji: '🎒', themes: ['新生活応援', '入学祝いギフト', '新社会人応援セット'], hashtags: ['#入学', '#入社', '#新生活', '#春'] },
    ],
    5: [
      { event: 'ゴールデンウィーク', emoji: '🏖️', themes: ['GW旅行', 'GW限定セール', 'お出かけスポット紹介'], hashtags: ['#GW', '#ゴールデンウィーク', '#連休', '#旅行'] },
      { event: '母の日', emoji: '💐', themes: ['母の日ギフト', 'お母さんへの感謝', '母の日限定商品'], hashtags: ['#母の日', '#母の日ギフト', '#感謝'] },
    ],
    6: [
      { event: '梅雨・雨の日', emoji: '☔', themes: ['梅雨コーデ', '雨の日おすすめ商品', 'インドア向け提案'], hashtags: ['#梅雨', '#雨の日', '#梅雨コーデ'] },
      { event: '父の日', emoji: '👔', themes: ['父の日ギフト', 'パパへのプレゼント', '男性向け商品'], hashtags: ['#父の日', '#父の日ギフト', '#パパ'] },
    ],
    7: [
      { event: '七夕', emoji: '🎋', themes: ['七夕限定メニュー', '七夕イベント', '願いを込めた企画'], hashtags: ['#七夕', '#たなばた', '#七夕飾り'] },
      { event: '夏祭り・サマー', emoji: '🏮', themes: ['夏祭りコーデ', '浴衣スタイル', 'サマーセール', '夏の新作'], hashtags: ['#夏祭り', '#浴衣', '#夏', '#サマー'] },
    ],
    8: [
      { event: 'お盆・夏休み', emoji: '🎆', themes: ['お盆限定企画', '夏休みイベント', '花火大会', '夏の思い出'], hashtags: ['#お盆', '#夏休み', '#花火', '#夏の思い出'] },
      { event: '夏の終わりセール', emoji: '🌻', themes: ['残暑見舞い', '夏クリアランス', 'サマーエンド企画'], hashtags: ['#夏セール', '#セール', '#残暑'] },
    ],
    9: [
      { event: '秋の始まり', emoji: '🍂', themes: ['秋コーデ', '秋の新作', '食欲の秋・新メニュー', '秋の行楽'], hashtags: ['#秋', '#秋コーデ', '#秋の空', '#食欲の秋'] },
      { event: '敬老の日', emoji: '👴', themes: ['敬老の日ギフト', 'おじいちゃんおばあちゃんへ', '感謝を形に'], hashtags: ['#敬老の日', '#祖父母', '#感謝'] },
    ],
    10: [
      { event: 'ハロウィン', emoji: '🎃', themes: ['ハロウィンコーデ', 'ハロウィンスイーツ', 'ハロウィン限定メニュー', '仮装アイデア'], hashtags: ['#ハロウィン', '#Halloween', '#ハロウィンコーデ', '#仮装'] },
      { event: '秋の行楽', emoji: '🍁', themes: ['紅葉スポット', '秋の味覚', '秋の新色コスメ', '秋旅行'], hashtags: ['#紅葉', '#秋の味覚', '#秋旅行', '#行楽'] },
    ],
    11: [
      { event: '七五三', emoji: '👧', themes: ['七五三記念', '和装フォト', '七五三ギフト'], hashtags: ['#七五三', '#七五三撮影', '#着物'] },
      { event: 'ブラックフライデー', emoji: '🛍️', themes: ['ブラックフライデーセール', '年末限定セール', 'お得な情報'], hashtags: ['#ブラックフライデー', '#BlackFriday', '#セール'] },
    ],
    12: [
      { event: 'クリスマス', emoji: '🎄', themes: ['クリスマスギフト', 'クリスマスコーデ', 'クリスマス限定メニュー', 'サンタコーデ'], hashtags: ['#クリスマス', '#Christmas', '#クリスマスプレゼント', '#Xmas'] },
      { event: '年末・大晦日', emoji: '🎉', themes: ['年末感謝セール', '今年一年の感謝', '大晦日カウントダウン', '来年もよろしく'], hashtags: ['#年末', '#大晦日', '#今年もありがとう', '#年末セール'] },
    ],
  };
  return events[month] || [];
}

export const INDUSTRIES = [
  { key: '', label: '業種を選択', emoji: '🏪' },
  { key: '美容・ネイル・まつ毛', label: '美容・ネイル', emoji: '💅' },
  { key: '飲食・カフェ・スイーツ', label: '飲食・カフェ', emoji: '☕' },
  { key: 'アパレル・ファッション', label: 'アパレル', emoji: '👗' },
  { key: 'ハンドメイド・クラフト', label: 'ハンドメイド', emoji: '🎨' },
  { key: 'フィットネス・ヨガ・ピラティス', label: 'フィットネス', emoji: '💪' },
  { key: 'フォトグラファー・映像', label: '写真・映像', emoji: '📸' },
  { key: 'インテリア・リフォーム・DIY', label: 'インテリア', emoji: '🏠' },
  { key: '教育・コーチング・コンサル', label: '教育・コーチ', emoji: '📚' },
  { key: '健康・ウェルネス・サプリ', label: '健康・美容', emoji: '🌿' },
  { key: '旅行・観光・宿泊', label: '旅行・観光', emoji: '✈️' },
  { key: 'ペット・動物関連', label: 'ペット', emoji: '🐾' },
  { key: '音楽・アート・クリエイター', label: '音楽・アート', emoji: '🎵' },
];

export interface SuggestedBrandSettings {
  brandName: string;
  industry: string;
  atmosphere: string;
  targetAudience: string;
  tone: string;
}

/**
 * Instagram投稿キャプションをAIで分析してブランド設定を自動生成する
 */
export async function analyzeBrandFromPosts(
  captions: string[],
  username: string
): Promise<SuggestedBrandSettings> {
  const headers = await getAuthHeaders();
  const sample = captions.slice(0, 10).join('\n---\n');
  const prompt = `以下は@${username}のInstagram投稿のキャプションです。
これらを分析して、このアカウントのブランド情報をJSON形式で返してください。

【投稿サンプル】
${sample}

以下のJSONのみを返してください（説明文不要）:
{
  "brandName": "推測されるブランド名または屋号（不明なら空文字）",
  "industry": "業種・ジャンル（例: 美容・ネイル・まつ毛、飲食・カフェ・スイーツ など）",
  "atmosphere": "お店・アカウントの雰囲気やこだわり（50文字以内）",
  "targetAudience": "ターゲット層（例: 30代女性、子育て中のママ など）",
  "tone": "投稿のトーン（「明るい・ポジティブ」「プロフェッショナル」「カジュアル」「感情的・共感」「ユーモラス」のいずれか）"
}`;

  const res = await axios.post(
    CLAUDE_API_URL,
    // 以前は別枠の専用上限（brand_ai_used、フリーは累計3回・リセット無し）を使って
    // いたが、通常のAI生成回数（ai_used）を1回分消費する扱いに統一した
    { model: MODEL, messages: [{ role: 'user', content: prompt }], max_tokens: 400 },
    { headers }
  );
  const text: string = res.data?.content?.[0]?.text ?? res.data?.text ?? '';
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error('AI応答のパースに失敗しました');
  return JSON.parse(jsonMatch[0]) as SuggestedBrandSettings;
}

export interface ChatTurn { role: 'user' | 'assistant'; content: string; }

export interface ChatUsage { plan: Plan; used: number; limit: number; remaining: number }

/** チャットの実際の利用回数を返す（getAiUsageと同じ形）。フリーは合計1回（リセットなし）、Pro/ビジネスは月ごとにリセット */
export async function getChatUsage(): Promise<ChatUsage> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { plan: 'free', used: 0, limit: CHAT_LIMITS.free, remaining: CHAT_LIMITS.free };
  const { data } = await supabase
    .from('profiles')
    .select('plan, chat_used, chat_period_start')
    .eq('id', user.id)
    .maybeSingle();
  const plan: Plan = data?.plan === 'pro' || data?.plan === 'business' ? data.plan : 'free';
  const limit = CHAT_LIMITS[plan];

  if (plan === 'free') {
    // フリープランはchat_usedを累計メッセージ数として使う（月次リセットなし）
    const used = Math.min(data?.chat_used ?? 0, limit);
    return { plan, used, limit, remaining: limit - used };
  }

  const start = data?.chat_period_start ?? new Date().toISOString().slice(0, 10);
  const sameMonth = (() => {
    const t = new Date(); const p = new Date(`${start}T00:00:00Z`);
    return t.getUTCFullYear() === p.getUTCFullYear() && t.getUTCMonth() === p.getUTCMonth();
  })();
  const used = Math.min(sameMonth ? (data?.chat_used ?? 0) : 0, limit);
  return { plan, used, limit, remaining: limit - used };
}

/** チャット利用量を % で返す。フリーは合計1回（リセットなし）、Pro/ビジネスは月ごとにリセット */
export async function getChatUsagePercent(): Promise<{ usedPct: number; remainingPct: number }> {
  const { used, limit } = await getChatUsage();
  const usedPct = Math.min(100, Math.round((used / limit) * 100));
  return { usedPct, remainingPct: 100 - usedPct };
}

/**
 * アシスタントとの会話（画像の相談・分析など）。回数消費なし（chat:true）。
 * 画像を生成したいときのために、会話から画像プロンプトを作る補助にも使える。
 */
// 相談は3〜10往復程度で完結する設計なので、直近分だけ送ってトークンを節約する
// （古いやり取りは会話全体の結論に大きく影響しないため）。
const MAX_HISTORY_TURNS = 16; // ユーザー・assistant発言の合計件数（≒8往復）
function trimHistory(history: ChatTurn[]): ChatTurn[] {
  return history.length > MAX_HISTORY_TURNS ? history.slice(-MAX_HISTORY_TURNS) : history;
}

export async function chatWithAssistant(
  fullHistory: ChatTurn[],
  attachment?: { base64: string; mime: string },
  analysisFacts?: string
): Promise<string> {
  const history = trimHistory(fullHistory);
  const headers = await getAuthHeaders();
  // 固定の指示文はキャッシュして毎回のトークン課金を抑える（cache_control）。
  // ブランド情報・記憶は都度変わりうるので別ブロックにして非キャッシュのまま送る。
  const staticInstructions =
    'あなたはInstagramマーケティングの評論家です。雑談には応じず、Instagram運用の評価・分析・アドバイスに徹してください。' +
    IG_CONTEXT +
    'ユーザーが写真・投稿内容・アカウント運用について相談してきたら、当たり障りのない褒め方はせず、' +
    'プロの評論家として率直かつ厳しく分析してください。具体的には次の観点で評価します。' +
    '①写真の撮り方（構図・光・被写体の見せ方・統一感）②投稿の仕方（頻度・時間帯・ハッシュタグ・プロフィールとの一貫性）' +
    '③データから見える傾向（投稿タイプ別・曜日別の反応の差、フォロワー数の伸び方、エンゲージメント率の推移など）。' +
    'なお、キャプションの文章そのものの書き方（言葉選び・フック・文体など）は投稿作成時のAI生成が担うため、' +
    'チャットでの評論では深く扱わず、①②③を中心に分析してください（ユーザーが文章について直接質問した場合を除く）。' +
    '【禁止事項】以下のような当たり障りのない・浅い回答は禁止です。' +
    '「素敵ですね」「良い投稿だと思います」のような具体性のない褒め言葉だけで終わる、' +
    '「もっと工夫すると良いです」「頑張ってください」のような中身のない一般論、' +
    '相手が送った写真・文章のどこがどう弱いのかに触れずに次の話題に進む、といった対応です。' +
    '必ず、ユーザーが実際に送ってきた写真・キャプション・データの「具体的などの部分」を名指しで引用・言及し' +
    '（例：「1枚目の写真は被写体が画面の隅に寄りすぎて余白が間延びしている」「キャプション冒頭の一文が説明的すぎて続きを読みたくならない」）、' +
    'その上で「なぜそれが弱いのか」「どう直せば良くなるのか」を具体的な手順・言葉選びのレベルまで踏み込んで指摘してください。' +
    '良い点も触れて構いませんが、褒めるだけで終わらせず、必ず改善点とセットで具体的な次のアクションを示してください。' +
    '1つの相談は3〜10往復程度で結論が出るよう簡潔に進め、絵文字は控えめに。' +
    '【文章量】1回の返答は長くても300字程度を目安にしてください。指摘は最も重要な1〜2点に絞り、' +
    '前置きや繰り返しの言い換え、当たり前の一般論は書かないでください。' +
    '箇条書きにできる内容は箇条書きにし、一文は短く言い切る形にしてください。' +
    '具体性・厳しさは削らず、「短いのに刺さる」指摘を優先し、言葉数で説明しようとしないでください。' +
    '「競合分析」「ライバルアカウントと比較して」と言われた場合、Instagramの仕様上、他人のアカウントのデータを自動取得することはできません。' +
    'まず【分析データ】にあるユーザー自身の実績（エンゲージメント率・投稿頻度・投稿タイプ別の反応など）を基準として示した上で、' +
    '比較したい競合アカウントのユーザーネーム・フォロワー数・投稿頻度・雰囲気（わかれば代表的な投稿の傾向）を教えてもらうよう1回だけ簡潔に聞いてください。' +
    '情報をもらえたら、それとユーザー自身の実績を比べて「どこが強みか・どこを真似すべきか・差別化すべき点」を具体的にアドバイスしてください。' +
    '情報がもらえなくても、一般的なその業種でよくある傾向を踏まえた改善提案はできる範囲で行ってください。' +
    '「今日のストーリー（投稿・リール）を作りたい」のような相談をされた場合、' +
    '「①フック→②本文→③CTA」のような、どのアカウントにも当てはまる一般的な構成案だけを返すのは禁止です。' +
    'それだけでは他の汎用AIチャットと同じで、このアプリならではの価値がありません。' +
    '必ず【ブランド情報】【分析データ】にある、このアカウント固有の情報（業種・トーン・所在地、ベスト投稿時間、' +
    '反応が良い投稿タイプ・曜日、フォロワー層など）と、今日の日付から分かる季節・曜日・近い行事を組み合わせて、' +
    '「今日・このアカウントだから提案できる」具体的なテーマ・切り口を1〜2個、理由付きで提案してください' +
    '（例：「金曜11時台が最も反応が良いので今日投稿するなら好都合です。直近は写真投稿よりカルーセルの反応が良いので、' +
    '◯◯（業種）なら△△を3枚構成で見せると良さそうです」のように、データや業種を根拠にする）。' +
    '構成のテンプレート論で終わらせず、具体的な文言例（キャプションの書き出し案など）まで踏み込んでください。' +
    '実際に生成・投稿する操作は「投稿」タブ（フィードの作成画面、または複数写真をまとめる「コラージュ」）で行うことをやんわり案内してください。' +
    'このアプリ自体は画像を生成しないため、投稿に使えそうな手元の写真がなさそうな相談（例: 該当する写真が無い、イメージ画像が欲しい）の場合は、' +
    '外部の画像生成AI（Midjourney・DALL-Eなど）に貼り付けて使えるプロンプトが欲しいかを1回だけ聞いてください。' +
    '欲しいと言われたら、業種・トーン・雰囲気・構図（引き・アングル・光の当たり方など）を具体的に盛り込んだ、' +
    'そのまま貼り付けて使える日本語のプロンプトを1つ作ってください。' +
    'プロンプト本文は必ず ```（コードブロック）で囲んで、それ以外の説明・前置き・補足は' +
    'コードブロックの外側に書いてください。コードブロックの中にはプロンプト文だけを入れ、' +
    '「プロンプト:」のようなラベルや余計な記号は入れないでください' +
    '（ユーザーがそのままコピーしてすぐ使えるようにするためです）。' +
    '欲しいと言われていない場合や、そもそも手元に写真がある相談では、聞かずに通常の評論・提案を続けてください。' +
    '【質問は最小限に】ユーザーへの質問は多用しないでください。判断できることは聞かずにこちらで仮定・判断して進め、' +
    'その仮定が明らかな場合は一言触れる程度にとどめてください（例:「特に指定がなければ〇〇として進めます」）。' +
    '質問して良いのは、後の提案の方向性が大きく変わるような重要な分岐点（例: 目的が集客なのかブランディングなのか、' +
    '競合比較の相手情報など）に限り、1つの返答で聞く質問は原則1つまでにしてください。' +
    '質問する際は自由記述で聞き返すのではなく、2〜4個程度の具体的な選択肢を提示し、' +
    '「A・B・Cのどれに近いですか？」のように選ばせる形式にしてください。';
  const todayInfo = (() => {
    const d = new Date();
    const dow = ['日', '月', '火', '水', '木', '金', '土'][d.getDay()];
    return `\n\n【今日の日付】${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日（${dow}曜日）`;
  })();
  const dynamicContext =
    '【重要】ユーザーの事業・サービス情報が下記【ブランド情報】として与えられている場合は、それを前提として扱い、' +
    '「どんなサービス／アプリですか？」などと毎回聞き返さないでください。情報が本当に不足している時だけ、要点を1つだけ簡潔に確認します。' +
    todayInfo +
    getBrandContext() + getMemoryContext() +
    (analysisFacts
      ? '\n\n【分析データ】以下はこのアカウントの投稿実績・プロフィールをプログラム側で取得した事実です。これが取得できているすべての情報であり、' +
        'これ以上ユーザーにプロフィール内容の再入力・スクリーンショット添付を求めないでください。' +
        '「（未設定）」となっている項目は、実際に未設定であることを意味します（取得失敗ではありません）ので、そのまま「未設定です」と伝え、' +
        '必要なら「設定すると良い」という改善提案の材料として使ってください。' +
        '「今のプロフィールを見せて」「自己紹介文は何になってる？」のように内容の確認・表示を求められた場合は、' +
        '聞き返したり評価に話をそらしたりせず、まず【分析データ】にある自己紹介文・プロフィールのリンクの実際の値をそのまま引用して答えてください' +
        '（「未設定」ならそう伝える）。評価やアドバイスは、聞かれれば続けて添える程度にとどめてください。' +
        '数値の再計算はせず、これをもとに「何が良くて何が悪いか」「具体的な改善方法」を分かりやすく説明してください。\n' + analysisFacts
      : '');
  const system = [
    { type: 'text', text: staticInstructions, cache_control: { type: 'ephemeral' } },
    { type: 'text', text: dynamicContext },
  ];
  const msgs: Array<{ role: string; content: unknown }> = history.map((h) => ({ role: h.role, content: h.content }));
  if (msgs.length === 0 || msgs[msgs.length - 1].role !== 'user') {
    msgs.push({ role: 'user', content: '続けてください。' });
  }
  // 画像添付があれば、最後のユーザーメッセージに画像ブロックを付ける（Claude Vision）
  if (attachment?.base64) {
    const last = msgs[msgs.length - 1];
    const textPart = typeof last.content === 'string' && last.content.trim() ? last.content : 'この画像について教えてください。';
    const mt = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'].includes(attachment.mime) ? attachment.mime : 'image/jpeg';
    last.content = [
      { type: 'image', source: { type: 'base64', media_type: mt, data: attachment.base64 } },
      { type: 'text', text: textPart },
    ];
  }
  try {
    const res = await axios.post(
      CLAUDE_API_URL,
      {
        model: MODEL,
        system,
        // 評論家として複数の観点（写真・文章・投稿の仕方）を具体的に指摘すると
        // 長めの回答になりやすいため、途中で切れないよう余裕を持たせる
        max_tokens: 1536,
        messages: msgs,
        chat: true,
      },
      { headers }
    );
    return res.data?.content?.[0]?.text ?? res.data?.text ?? '';
  } catch (err) {
    throw new Error(detailError(err));
  }
}

// Instagram前提の共通コンテキスト
const IG_CONTEXT =
  'このアプリはInstagram運用支援ツールです。ユーザーの言う「投稿」「フィード」はInstagramのフィード投稿、' +
  '「ストーリー」はInstagramのストーリー投稿（縦長9:16）、「リール」はInstagram Reelsを指します。' +
  'したがって「ストーリーを作って」は物語ではなく、Instagramストーリー用の画像を意味します。';

export interface ImagePlan { ready: boolean; question?: string; options?: string[]; prompts?: string[]; }

/**
 * 会話から画像生成の準備をする。情報が足りていれば count 枚ぶんのプロンプトを返し、
 * 足りなければ ready:false と1つの確認質問を返す。
 */
export async function planImageGeneration(fullHistory: ChatTurn[], count: number): Promise<ImagePlan> {
  const history = trimHistory(fullHistory);
  const headers = await getAuthHeaders();
  const msgs = history.map((h) => ({ role: h.role, content: h.content }));
  if (msgs.length === 0 || msgs[msgs.length - 1].role !== 'user') {
    msgs.push({ role: 'user', content: `これまでの会話をもとに、画像${count}枚を生成したいです。` });
  }
  // count非依存の固定部分はキャッシュし、count・ブランド情報など可変部分は毎回そのまま送る。
  const staticInstructions =
    IG_CONTEXT +
    '\nこれまでの会話をもとに、画像生成AIに渡すプロンプトを作れるか判断してください。' +
    '被写体・目的・雰囲気などが曖昧で、良い画像が作れないと判断したら、生成せずに質問してください。' +
    '質問する場合は自由記述ではなく選択肢形式にしてください。';
  const dynamicInstructions =
    `\nプロンプトを${count}個作ってください。` +
    (count > 1
      ? '複数枚の場合は、各画像が場面や切り口の異なる一連の流れ（例：ストーリーの複数ページ）になるようにします。単なる複製にしないでください。'
      : '') +
    '\n出力は次のJSONのみ（前置き・説明・コードフェンス禁止）:' +
    '\n- 情報が十分: {"ready": true, "prompts": ["プロンプト1", ...]}（要素数' + count + '、各1〜2文・被写体/構図/雰囲気/色/スタイルを含む）' +
    '\n- 情報が不足: {"ready": false, "question": "確認したいことを1つだけ簡潔に", "options": ["選択肢1", "選択肢2", "選択肢3"]}（optionsは2〜4個、短い言葉で）' +
    getBrandContext() + getMemoryContext();
  const system = [
    { type: 'text', text: staticInstructions, cache_control: { type: 'ephemeral' } },
    { type: 'text', text: dynamicInstructions },
  ];
  try {
    const res = await axios.post(
      CLAUDE_API_URL,
      { model: MODEL, system, max_tokens: 900, messages: msgs, chat: true },
      { headers }
    );
    const text: string = res.data?.content?.[0]?.text ?? res.data?.text ?? '';
    const m = text.match(/\{[\s\S]*\}/);
    if (m) {
      try {
        const obj = JSON.parse(m[0]);
        if (obj.ready === false && obj.question) {
          const options = Array.isArray(obj.options)
            ? obj.options.map((s: unknown) => String(s)).filter(Boolean)
            : undefined;
          return { ready: false, question: String(obj.question), options: options && options.length > 0 ? options : undefined };
        }
        if (Array.isArray(obj.prompts) && obj.prompts.length > 0) {
          let prompts = obj.prompts.map((s: unknown) => String(s));
          while (prompts.length < count) prompts.push(prompts[prompts.length - 1]);
          return { ready: true, prompts: prompts.slice(0, count) };
        }
      } catch { /* fallthrough */ }
    }
    // パースできない場合は本文を1プロンプトとして扱う
    return { ready: true, prompts: Array.from({ length: count }, () => text.trim()) };
  } catch (err) {
    throw new Error(detailError(err));
  }
}

export interface StoryOverlaySpec { title: string; bodyText: string; cta: string; textColor: string; }
export interface FlyerDesignSpec {
  headline: string;
  subheadline?: string;
  details: string[];
  price?: string;
  footer?: string;
  accentColor: string;
  textColor?: string;
}
export interface DesignPlan {
  ready: boolean;
  question?: string;
  options?: string[];
  designType?: 'story' | 'flyer';
  storyOverlay?: StoryOverlaySpec;
  flyer?: FlyerDesignSpec;
}

/**
 * ユーザー自身の写真をもとに「デザイン」だけをAIに考えさせる（画像生成AIは使わない）。
 * 会話の流れから、Instagramストーリー（写真に文字だけ乗せる）なのか、
 * パンフレット・チラシ（見出し・詳細・価格などを含むレイアウト）なのかを判断し、
 * それぞれに必要な項目だけを返す。
 */
export async function planDesign(fullHistory: ChatTurn[]): Promise<DesignPlan> {
  const history = trimHistory(fullHistory);
  const headers = await getAuthHeaders();
  const msgs = history.map((h) => ({ role: h.role, content: h.content }));
  if (msgs.length === 0 || msgs[msgs.length - 1].role !== 'user') {
    msgs.push({ role: 'user', content: 'この写真でデザインを作ってください。' });
  }
  const staticInstructions =
    IG_CONTEXT +
    '\nユーザーは自分の写真をすでに用意しています。画像そのものは生成せず、その写真の上に載せる文字やレイアウトだけを考えてください。' +
    '会話の内容から、次のどちらが適切か判断してください:' +
    '\n- story: Instagramストーリーのように、写真に短いタイトル・一言・CTAだけをシンプルに乗せたいとき' +
    '\n- flyer: 「パンフレットを作って」「チラシを作って」のように、見出し・詳細（メニュー/料金/特徴など複数項目）・価格・連絡先を含んだ、情報量の多い案内を作りたいとき' +
    '訴求内容や雰囲気が曖昧で良いデザインが作れないと判断したら、生成せず選択肢形式で質問してください。';
  const dynamicInstructions =
    '\n出力は次のJSONのみ（前置き・説明・コードフェンス禁止）:' +
    '\n- ストーリーの場合: {"ready": true, "designType": "story", "storyOverlay": {"title": "10文字以内", "bodyText": "40〜60文字、行動を促す内容", "cta": "8文字以内", "textColor": "#FFFFFFまたは#000000"}}' +
    '\n- パンフレット/チラシの場合: {"ready": true, "designType": "flyer", "flyer": {"headline": "15文字以内", "subheadline": "一言（任意）", "details": ["項目1", "項目2", "項目3"], "price": "価格表記（任意）", "footer": "連絡先やCTA（任意）", "accentColor": "#HEX", "textColor": "#HEX（任意、本文色）"}}（detailsは2〜4個）' +
    '\n- 情報が不足: {"ready": false, "question": "確認したいことを1つだけ簡潔に", "options": ["選択肢1", "選択肢2", "選択肢3"]}（optionsは2〜4個、短い言葉で）' +
    getBrandContext() + getMemoryContext();
  const system = [
    { type: 'text', text: staticInstructions, cache_control: { type: 'ephemeral' } },
    { type: 'text', text: dynamicInstructions },
  ];
  try {
    const res = await axios.post(
      CLAUDE_API_URL,
      { model: MODEL, system, max_tokens: 700, messages: msgs, chat: true },
      { headers }
    );
    const text: string = res.data?.content?.[0]?.text ?? res.data?.text ?? '';
    const m = text.match(/\{[\s\S]*\}/);
    if (m) {
      const obj = JSON.parse(m[0]);
      if (obj.ready === false && obj.question) {
        const options = Array.isArray(obj.options)
          ? obj.options.map((s: unknown) => String(s)).filter(Boolean)
          : undefined;
        return { ready: false, question: String(obj.question), options: options && options.length > 0 ? options : undefined };
      }
      if (obj.ready === true && obj.designType === 'flyer' && obj.flyer) {
        const f = obj.flyer;
        return {
          ready: true,
          designType: 'flyer',
          flyer: {
            headline: String(f.headline ?? ''),
            subheadline: f.subheadline ? String(f.subheadline) : undefined,
            details: Array.isArray(f.details) ? f.details.map((s: unknown) => String(s)).slice(0, 4) : [],
            price: f.price ? String(f.price) : undefined,
            footer: f.footer ? String(f.footer) : undefined,
            accentColor: String(f.accentColor ?? '#E1306C'),
            textColor: f.textColor ? String(f.textColor) : undefined,
          },
        };
      }
      if (obj.ready === true && obj.storyOverlay) {
        const o = obj.storyOverlay;
        return {
          ready: true,
          designType: 'story',
          storyOverlay: {
            title: String(o.title ?? ''),
            bodyText: String(o.bodyText ?? ''),
            cta: String(o.cta ?? ''),
            textColor: String(o.textColor ?? '#FFFFFF'),
          },
        };
      }
    }
    throw new Error('AI応答のパースに失敗しました');
  } catch (err) {
    throw new Error(detailError(err));
  }
}

/** 会話から、画像生成用のプロンプト（1〜2文）を作る */
export async function buildImagePrompt(history: ChatTurn[]): Promise<string> {
  const headers = await getAuthHeaders();
  // 会話は user メッセージで終わる必要がある（末尾がassistantなら指示のuserを足す）
  const msgs = history.map((h) => ({ role: h.role, content: h.content }));
  if (msgs.length === 0 || msgs[msgs.length - 1].role !== 'user') {
    msgs.push({ role: 'user', content: 'これまでの会話をもとに、画像生成用のプロンプトを1つだけ作ってください。' });
  }
  try {
    const res = await axios.post(
      CLAUDE_API_URL,
      {
        model: MODEL,
        system:
          'これまでの会話をもとに、画像生成AIに渡す画像プロンプトを1つだけ作ってください。' +
          '被写体・構図・雰囲気・色・スタイルを含め、日本語で1〜2文。前置きや説明は書かず、プロンプト本文のみを返してください。',
        max_tokens: 300,
        messages: msgs,
        chat: true,
      },
      { headers }
    );
    return (res.data?.content?.[0]?.text ?? res.data?.text ?? '').trim();
  } catch (err) {
    throw new Error(detailError(err));
  }
}

// サーバー/Anthropicのエラー本文をできるだけ具体的に取り出す
function detailError(err: unknown): string {
  if (axios.isAxiosError(err)) {
    const d = err.response?.data as { error?: unknown } | undefined;
    const e = d?.error;
    if (e && typeof e === 'object' && 'message' in e) return String((e as { message: unknown }).message);
    if (typeof e === 'string') return e;
    if (d) return JSON.stringify(d);
    return err.message;
  }
  return err instanceof Error ? err.message : 'AIの呼び出しに失敗しました';
}

// ===== Story Studio: テンプレート推薦 =====
// 画像は生成しない。DB側で絞り込んだ候補（最大20件程度）の中から、
// ブランド情報・業種・目的・過去利用履歴をもとに最適な完成テンプレート1件と、
// フォント・色をJSONのみで選ばせる（Haikuの軽量呼び出し）。

export interface StoryRecommendCandidate {
  id: string;
  name: string;
  tags: string[];
}

export interface StoryRecommendResult {
  template: string;
  font?: string;
  titleColor?: string;
  reason?: string;
}

export async function recommendStoryTemplate(input: {
  candidates: StoryRecommendCandidate[];
  purpose?: string;
  recentTemplateIds?: string[];
}): Promise<StoryRecommendResult> {
  const headers = await getAuthHeaders();
  const brandCtx = getBrandContext();
  const systemPrompt =
    'あなたはInstagramストーリーのデザイン選定アシスタントです。画像は一切生成しません。' +
    '与えられたテンプレート候補一覧（id・名前・タグ）の中から、ブランド情報・投稿目的に最も合う完成テンプレートを1件選び、' +
    'フォント・文字色を判断してください。' +
    '候補一覧に無いIDは絶対に作らないでください。必ずJSONのみで返答してください。';

  const prompt = `以下のテンプレート候補から、最適な1件を選んでください。${brandCtx}
${input.purpose ? `\n投稿目的: ${input.purpose}` : ''}
${input.recentTemplateIds?.length ? `\n過去に使ったテンプレートID（マンネリ防止のため、なるべく避ける）: ${input.recentTemplateIds.join(', ')}` : ''}

【候補一覧】
${input.candidates.map((c) => `- id: ${c.id} / 名前: ${c.name} / タグ: ${c.tags.join('、')}`).join('\n')}

以下のJSON形式で返してください（候補一覧に実在するIDのみ使用すること）:
{
  "template": "候補のid",
  "font": "luxury など",
  "titleColor": "#FFFFFF",
  "reason": "選んだ理由（1文）"
}`;

  const res = await axios.post(
    CLAUDE_API_URL,
    { model: MODEL, system: systemPrompt, messages: [{ role: 'user', content: prompt }], max_tokens: 400, chat: true },
    { headers }
  );
  const raw: string = res.data?.content?.[0]?.text ?? res.data?.text ?? '';
  const clean = raw.replace(/```json|```/g, '').trim();
  const match = clean.match(/\{[\s\S]*\}/);
  if (!match) throw new Error('AIの応答を解釈できませんでした');
  const parsed = JSON.parse(match[0]);
  if (!input.candidates.some((c) => c.id === parsed.template)) {
    throw new Error('AIが候補にないテンプレートを選択しました');
  }
  return parsed as StoryRecommendResult;
}
