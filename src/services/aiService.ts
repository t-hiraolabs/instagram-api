import axios from 'axios';
import { useAppStore } from '../store/appStore';
import { supabase } from './supabaseClient';

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

function getBrandContext(): string {
  const { brandSettings, brandSettings2, activeAccountSlot } = useAppStore.getState();
  const { brandName, industry, atmosphere, targetAudience, tone } =
    activeAccountSlot === 2 ? brandSettings2 : brandSettings;
  const parts: string[] = [];
  if (brandName) parts.push(`ブランド名: ${brandName}`);
  if (industry) parts.push(`業種: ${industry}`);
  if (atmosphere) parts.push(`お店の雰囲気・こだわり: ${atmosphere}`);
  if (targetAudience) parts.push(`ターゲット層: ${targetAudience}`);
  if (tone) parts.push(`希望トーン: ${tone}`);
  return parts.length > 0 ? `\n\n【ブランド情報】\n${parts.join('\n')}` : '';
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

/** 過去の人気投稿をプロンプトに差し込む文脈ブロックを作る（空なら空文字） */
function topPostsContext(topPosts?: TopPost[]): string {
  if (!topPosts || topPosts.length === 0) return '';
  const ranked = topPosts
    .slice(0, 5)
    .map(
      (p, i) =>
        `${i + 1}位（❤️${p.likes} / 💬${p.comments}）${(p.caption || '（キャプションなし）').slice(0, 200)}`
    )
    .join('\n');
  return `\n\n【このアカウントで過去に反応が良かった投稿】\n${ranked}\n\n上記の傾向（よく反応されるテーマ・トーン・文章の長さ・絵文字や改行・ハッシュタグの使い方）を分析し、その成功パターンを今回の生成に反映してください。`;
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

interface GenerateStoryInput {
  theme: string;
  type: 'poll' | 'countdown' | 'quiz' | 'announcement' | 'promotion';
  brandName?: string;
  details: string;
  topPosts?: TopPost[];
}

interface GeneratedStory {
  title: string;
  bodyText: string;
  cta: string;
  backgroundColor: string;
  textColor: string;
  suggestions: string[];
}

async function callClaude(prompt: string, systemPrompt: string): Promise<string> {
  try {
    const response = await axios.post(
      CLAUDE_API_URL,
      {
        model: MODEL,
        max_tokens: 1024,
        system: systemPrompt,
        messages: [{ role: 'user', content: prompt }],
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

以下のJSONフォーマットで返してください:
{
  "caption": "投稿文（絵文字も含めて、改行あり、200〜400文字）",
  "hashtags": ["#ハッシュタグ1", "#ハッシュタグ2", ...],
  "suggestions": ["改善提案1", "改善提案2", "改善提案3"]
}`;

  const raw = await callClaude(prompt, systemPrompt);
  const clean = raw.replace(/```json|```/g, '').trim();
  return JSON.parse(clean) as GeneratedPost;
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

以下のJSONフォーマットで返してください:
{
  "caption": "投稿文（絵文字も含めて、改行あり、200〜400文字）",
  "hashtags": ["#ハッシュタグ1", "#ハッシュタグ2", ...],
  "suggestions": ["なぜこの構成にしたか/過去の人気投稿から学んだ改善提案1", "提案2", "提案3"]
}`;

  const raw = await callClaude(prompt, systemPrompt);
  const clean = raw.replace(/```json|```/g, '').trim();
  return JSON.parse(clean) as GeneratedPost;
}

export async function generateStory(input: GenerateStoryInput): Promise<GeneratedStory> {
  const brandCtx = getBrandContext();
  const systemPrompt = `あなたはInstagramストーリーのプロデザイナー兼コピーライターです。
日本のユーザーが好む、インパクトのある短いストーリーコンテンツを生成します。
必ずJSONフォーマットだけで返答してください。`;

  const typeMap: Record<string, string> = {
    poll: 'アンケート',
    countdown: 'カウントダウン',
    quiz: 'クイズ',
    announcement: 'お知らせ',
    promotion: 'プロモーション',
  };

  const prompt = `以下の条件でInstagramストーリーのコンテンツを生成してください。${brandCtx}${topPostsContext(input.topPosts)}

タイプ: ${typeMap[input.type]}
テーマ: ${input.theme}
ブランド名: ${input.brandName || '未設定'}
詳細: ${input.details}

以下のJSONフォーマットで返してください:
{
  "title": "タイトル（10文字以内、インパクト重視）",
  "bodyText": "本文（40〜60文字、行動を促す内容）",
  "cta": "アクションボタンのテキスト（8文字以内）",
  "backgroundColor": "#HEX色コード（鮮やかで目を引く色）",
  "textColor": "#FFFFFF または #000000",
  "suggestions": ["追加提案1", "追加提案2", "追加提案3"]
}`;

  const raw = await callClaude(prompt, systemPrompt);
  const clean = raw.replace(/```json|```/g, '').trim();
  return JSON.parse(clean) as GeneratedStory;
}

/** リール用：テーマから、各スライドにのせる短いキャプションを生成 */
export async function generateReelCaptions(input: {
  theme: string;
  count: number;
  industry?: string;
  toneHint?: string;
  topPosts?: TopPost[];
}): Promise<string[]> {
  const brandCtx = getBrandContext();
  const systemPrompt = `あなたはInstagramリールの構成作家です。
日本の個人事業主・中小企業向けに、写真スライドにのせる短いキャプションを作ります。
必ずJSONフォーマットだけで返答してください。`;

  const prompt = `テーマ「${input.theme}」のInstagramリール用に、スライド${input.count}枚分の短いキャプションを作ってください。${brandCtx}${topPostsContext(input.topPosts)}
${input.industry ? `業種: ${input.industry}` : ''}
${input.toneHint ? `トーン: ${input.toneHint}` : ''}

条件:
- 各スライドに1つずつ、合計${input.count}個
- 1つ8〜16文字程度、短く端的に（写真の上にのせる前提）
- 1枚目は引きつけるフック、最後の1枚は行動を促す一言（来店・予約・チェックなど）
- 自然で等身大の日本語。キザ・大げさ・ポエム調・中二っぽい言い回しは避ける
- 読点「、」や句点「。」は使わない（短いので不要）

以下のJSONで返してください:
{"captions": ["1枚目の文字", "2枚目の文字", ...]}`;

  const raw = await callClaude(prompt, systemPrompt);
  const clean = raw.replace(/```json|```/g, '').trim();
  const parsed = JSON.parse(clean);
  // 念のため読点・句点を除去
  return (parsed.captions as string[])
    .slice(0, input.count)
    .map((c) => c.replace(/[、。]/g, '').trim());
}

export async function improveCaption(originalCaption: string): Promise<string[]> {
  const systemPrompt = `あなたはInstagramのエキスパートです。
日本のユーザー向けにキャプションを分析して改善案を3つ提案します。JSONで返してください。`;

  const prompt = `以下のキャプションを改善してください:\n\n"${originalCaption}"\n\n{"suggestions": ["改善案1（具体的に）", "改善案2（具体的に）", "改善案3（具体的に）"]}`;

  const raw = await callClaude(prompt, systemPrompt);
  const clean = raw.replace(/```json|```/g, '').trim();
  const parsed = JSON.parse(clean);
  return parsed.suggestions as string[];
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
  const clean = raw.replace(/```json|```/g, '').trim();
  return JSON.parse(clean).caption as string;
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
  const clean = raw.replace(/```json|```/g, '').trim();
  return JSON.parse(clean) as GeneratedPost;
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
  const clean = raw.replace(/```json|```/g, '').trim();
  return JSON.parse(clean) as GeneratedPost;
}

export async function generateHashtags(theme: string, count: number = 15): Promise<string[]> {
  const brandCtx = getBrandContext();
  const systemPrompt = `あなたはInstagramのSEOエキスパートです。
日本のInstagramで効果的なハッシュタグを提案します。JSONで返してください。`;

  const prompt = `テーマ「${theme}」に関する効果的なInstagramハッシュタグを${count}個生成してください。${brandCtx}
日本語タグ（60%）と英語タグ（40%）を混ぜて、人気タグ3個・中規模タグ8個・ニッチタグ4個を含めてください。
{"hashtags": ["#タグ1", "#タグ2", ...]}`;

  const raw = await callClaude(prompt, systemPrompt);
  const clean = raw.replace(/```json|```/g, '').trim();
  const parsed = JSON.parse(clean);
  return parsed.hashtags as string[];
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
    // skipCount: ブランド分析は通常のAI生成回数を消費しない（裏で別枠の上限あり）
    { model: MODEL, messages: [{ role: 'user', content: prompt }], max_tokens: 400, skipCount: true },
    { headers }
  );
  const text: string = res.data?.content?.[0]?.text ?? res.data?.text ?? '';
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error('AI応答のパースに失敗しました');
  return JSON.parse(jsonMatch[0]) as SuggestedBrandSettings;
}

export interface ChatTurn { role: 'user' | 'assistant'; content: string; }

// クライアント表示用（サーバーの CHAT_TOKEN_LIMITS と揃える。月間トークン数）
const CHAT_LIMITS: Record<string, number> = { free: 100000, pro: 800000, business: 2000000 };

/** チャット利用量を % で返す（月ごとにリセット）。Claude風の残量表示に使う */
export async function getChatUsagePercent(): Promise<{ usedPct: number; remainingPct: number }> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { usedPct: 0, remainingPct: 100 };
  const { data } = await supabase
    .from('profiles')
    .select('plan, chat_used, chat_period_start')
    .eq('id', user.id)
    .maybeSingle();
  const plan = data?.plan === 'pro' || data?.plan === 'business' ? data.plan : 'free';
  const limit = CHAT_LIMITS[plan];
  const start = data?.chat_period_start ?? new Date().toISOString().slice(0, 10);
  const sameMonth = (() => {
    const t = new Date(); const p = new Date(`${start}T00:00:00Z`);
    return t.getUTCFullYear() === p.getUTCFullYear() && t.getUTCMonth() === p.getUTCMonth();
  })();
  const used = sameMonth ? (data?.chat_used ?? 0) : 0;
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
    'あなたはInstagram専門のマーケティングコンサルタントです。雑談には応じず、Instagram運用の相談に集中してください。' +
    IG_CONTEXT +
    '今日の投稿提案、週間の投稿計画、売上・フォロワーを伸ばす相談、リールのアイデア、プロフィール改善、投稿改善などに答えます。' +
    'ユーザーと会話しながら、投稿のアイデア出し、簡単な分析やアドバイス、そして「どんな画像を作りたいか」を一緒に具体化します。' +
    '画像生成のプロンプトを聞かれたら、被写体・構図・雰囲気・色・スタイルを含む具体的な指示を1〜2文で提案してください。' +
    '1つの相談は3〜10往復程度で結論が出るよう簡潔に進め、回答は簡潔に、絵文字は控えめに。' +
    '「競合分析」「ライバルアカウントと比較して」と言われた場合、Instagramの仕様上、他人のアカウントのデータを自動取得することはできません。' +
    'まず【分析データ】にあるユーザー自身の実績（エンゲージメント率・投稿頻度・投稿タイプ別の反応など）を基準として示した上で、' +
    '比較したい競合アカウントのユーザーネーム・フォロワー数・投稿頻度・雰囲気（わかれば代表的な投稿の傾向）を教えてもらうよう1回だけ簡潔に聞いてください。' +
    '情報をもらえたら、それとユーザー自身の実績を比べて「どこが強みか・どこを真似すべきか・差別化すべき点」を具体的にアドバイスしてください。' +
    '情報がもらえなくても、一般的なその業種でよくある傾向を踏まえた改善提案はできる範囲で行ってください。';
  const dynamicContext =
    '【重要】ユーザーの事業・サービス情報が下記【ブランド情報】として与えられている場合は、それを前提として扱い、' +
    '「どんなサービス／アプリですか？」などと毎回聞き返さないでください。情報が本当に不足している時だけ、要点を1つだけ簡潔に確認します。' +
    getBrandContext() + getMemoryContext() +
    (analysisFacts
      ? '\n\n【分析データ】以下はこのアカウントの投稿実績・プロフィールをプログラム側で取得した事実です。これが取得できているすべての情報であり、' +
        'これ以上ユーザーにプロフィール内容の再入力・スクリーンショット添付を求めないでください。' +
        '「（未設定）」となっている項目は、実際に未設定であることを意味します（取得失敗ではありません）ので、そのまま「未設定です」と伝え、' +
        '必要なら「設定すると良い」という改善提案の材料として使ってください。' +
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
        max_tokens: 700,
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
