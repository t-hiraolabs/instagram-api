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

function getBrandContext(): string {
  const { brandName, industry, targetAudience, tone } = useAppStore.getState().brandSettings;
  const parts: string[] = [];
  if (brandName) parts.push(`ブランド名: ${brandName}`);
  if (industry) parts.push(`業種: ${industry}`);
  if (targetAudience) parts.push(`ターゲット層: ${targetAudience}`);
  if (tone) parts.push(`希望トーン: ${tone}`);
  return parts.length > 0 ? `\n\n【ブランド情報】\n${parts.join('\n')}` : '';
}

interface GeneratePostInput {
  theme: string;
  tone: string;
  keywords: string[];
  includeHashtags: boolean;
  language: 'ja' | 'en';
  industry?: string;
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
}

export async function generatePost(input: GeneratePostInput): Promise<GeneratedPost> {
  const brandCtx = getBrandContext();
  const systemPrompt = `あなたは日本のInstagramマーケティングの専門家です。
個人事業主・中小企業のビジネスオーナー向けに、エンゲージメントを高める日本語の投稿文を生成します。
日本のInstagramユーザー文化（ハッシュタグ検索が活発・グローバル平均の3倍、ビジュアル重視、「映え」文化）を理解した最適な文章を作ります。
必ずJSONフォーマットだけで返答してください。余分なテキストは不要です。`;

  const prompt = `以下の条件でInstagramのフィード投稿を生成してください。${brandCtx}

テーマ: ${input.theme}
トーン: ${input.tone}
${input.industry ? `業種: ${input.industry}` : ''}
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

  const prompt = `以下の条件でInstagramストーリーのコンテンツを生成してください。${brandCtx}

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

export async function improveCaption(originalCaption: string): Promise<string[]> {
  const systemPrompt = `あなたはInstagramのエキスパートです。
日本のユーザー向けにキャプションを分析して改善案を3つ提案します。JSONで返してください。`;

  const prompt = `以下のキャプションを改善してください:\n\n"${originalCaption}"\n\n{"suggestions": ["改善案1（具体的に）", "改善案2（具体的に）", "改善案3（具体的に）"]}`;

  const raw = await callClaude(prompt, systemPrompt);
  const clean = raw.replace(/```json|```/g, '').trim();
  const parsed = JSON.parse(clean);
  return parsed.suggestions as string[];
}

export async function generateFromImage(input: {
  imageBase64: string;
  mimeType: 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp';
  contentType: 'feed' | 'story' | 'reel';
  tone: string;
  industry?: string;
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

  const response = await axios.post(
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
              text: `この画像からInstagram${labels[input.contentType]}のコンテンツを生成してください。${brandCtx}
トーン: ${input.tone}
${input.industry ? `業種: ${input.industry}` : ''}
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
