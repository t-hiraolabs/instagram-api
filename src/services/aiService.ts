import axios from 'axios';

const CLAUDE_API_URL = 'https://api.anthropic.com/v1/messages';

// ※ 本番ではバックエンドサーバー経由でAPIキーを管理すること
// 開発中は .env ファイルで管理
const API_KEY = process.env.EXPO_PUBLIC_ANTHROPIC_API_KEY || '';

interface GeneratePostInput {
  theme: string;       // 投稿テーマ（例: 新商品、日常、旅行）
  tone: string;        // トーン（例: 明るい、プロフェッショナル、カジュアル）
  keywords: string[];  // キーワード
  includeHashtags: boolean;
  language: 'ja' | 'en';
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
  cta: string;          // Call To Action
  backgroundColor: string;
  textColor: string;
  suggestions: string[];
}

async function callClaude(prompt: string, systemPrompt: string): Promise<string> {
  const response = await axios.post(
    CLAUDE_API_URL,
    {
      model: 'claude-sonnet-4-20250514',
      max_tokens: 1024,
      system: systemPrompt,
      messages: [{ role: 'user', content: prompt }],
    },
    {
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': API_KEY,
        'anthropic-version': '2023-06-01',
      },
    }
  );

  return response.data.content[0].text;
}

// フィード投稿を生成
export async function generatePost(input: GeneratePostInput): Promise<GeneratedPost> {
  const systemPrompt = `あなたはInstagramのプロのコンテンツライターです。
魅力的で読者のエンゲージメントを高める投稿文を日本語で生成します。
必ずJSONフォーマットで返答してください。余分なテキストは不要です。`;

  const prompt = `以下の条件でInstagramのフィード投稿を生成してください。

テーマ: ${input.theme}
トーン: ${input.tone}
キーワード: ${input.keywords.join(', ')}
ハッシュタグ: ${input.includeHashtags ? '含める' : '含めない'}

以下のJSONフォーマットで返してください:
{
  "caption": "投稿文（絵文字も含めて）",
  "hashtags": ["ハッシュタグ1", "ハッシュタグ2", ...],
  "suggestions": ["改善提案1", "改善提案2", "改善提案3"]
}`;

  const raw = await callClaude(prompt, systemPrompt);
  const clean = raw.replace(/```json|```/g, '').trim();
  return JSON.parse(clean) as GeneratedPost;
}

// ストーリーを生成
export async function generateStory(input: GenerateStoryInput): Promise<GeneratedStory> {
  const systemPrompt = `あなたはInstagramストーリーのプロデザイナー兼コピーライターです。
インパクトのある短くて引きつけるストーリーコンテンツを生成します。
必ずJSONフォーマットで返答してください。`;

  const typeMap: Record<string, string> = {
    poll: 'アンケート',
    countdown: 'カウントダウン',
    quiz: 'クイズ',
    announcement: 'お知らせ',
    promotion: 'プロモーション',
  };

  const prompt = `以下の条件でInstagramストーリーのコンテンツを生成してください。

タイプ: ${typeMap[input.type]}
テーマ: ${input.theme}
ブランド名: ${input.brandName || '未設定'}
詳細: ${input.details}

以下のJSONフォーマットで返してください:
{
  "title": "タイトル（短くインパクトのある）",
  "bodyText": "本文（50文字以内）",
  "cta": "アクションボタンのテキスト",
  "backgroundColor": "#HEX色コード（ブランドに合う色）",
  "textColor": "#HEX色コード",
  "suggestions": ["追加提案1", "追加提案2"]
}`;

  const raw = await callClaude(prompt, systemPrompt);
  const clean = raw.replace(/```json|```/g, '').trim();
  return JSON.parse(clean) as GeneratedStory;
}

// キャプション改善
export async function improveCaption(originalCaption: string): Promise<string[]> {
  const systemPrompt = `あなたはInstagramのエキスパートです。
キャプションを分析して改善案を3つ提案します。JSONで返してください。`;

  const prompt = `以下のキャプションを改善してください:\n\n"${originalCaption}"\n\n{"suggestions": ["改善案1", "改善案2", "改善案3"]}`;

  const raw = await callClaude(prompt, systemPrompt);
  const clean = raw.replace(/```json|```/g, '').trim();
  const parsed = JSON.parse(clean);
  return parsed.suggestions as string[];
}

// 画像からコンテンツ生成（Claude Vision）
export async function generateFromImage(input: {
  imageBase64: string;
  mimeType: 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp';
  contentType: 'feed' | 'story' | 'reel';
  tone: string;
}): Promise<GeneratedPost> {
  const labels = { feed: 'フィード投稿', story: 'ストーリー', reel: 'リール' };

  const systemPrompt = `あなたはInstagramのプロのコンテンツライターです。
画像の内容・雰囲気・感情を読み取り、最適なInstagram${labels[input.contentType]}テキストを日本語で生成します。
必ずJSONフォーマットだけで返答してください。`;

  const extraInstructions =
    input.contentType === 'reel'
      ? '冒頭3秒で引きつけるフック文を先頭に。縦型動画向けに短く（2〜3文）。'
      : input.contentType === 'story'
      ? '24時間で消えるストーリーらしく、短くインパクト重視。インタラクション（質問・投票など）を促す一言を含める。'
      : '';

  const response = await axios.post(
    CLAUDE_API_URL,
    {
      model: 'claude-sonnet-4-20250514',
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
              text: `この画像からInstagram${labels[input.contentType]}のコンテンツを生成してください。
トーン: ${input.tone}
${extraInstructions}

{"caption":"投稿文（絵文字も含めて）","hashtags":["#タグ1",...],"suggestions":["アドバイス1","アドバイス2","アドバイス3"]}`,
            },
          ],
        },
      ],
    },
    {
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': API_KEY,
        'anthropic-version': '2023-06-01',
      },
    }
  );

  const raw = response.data.content[0].text;
  const clean = raw.replace(/```json|```/g, '').trim();
  return JSON.parse(clean) as GeneratedPost;
}

// ハッシュタグ生成
export async function generateHashtags(theme: string, count: number = 15): Promise<string[]> {
  const systemPrompt = `あなたはInstagramのSEOエキスパートです。
効果的なハッシュタグを提案します。JSONで返してください。`;

  const prompt = `テーマ「${theme}」に関する効果的なInstagramハッシュタグを${count}個生成してください。
日本語と英語を混ぜて、人気タグと中規模タグをバランスよく含めてください。
{"hashtags": ["#タグ1", "#タグ2", ...]}`;

  const raw = await callClaude(prompt, systemPrompt);
  const clean = raw.replace(/```json|```/g, '').trim();
  const parsed = JSON.parse(clean);
  return parsed.hashtags as string[];
}
