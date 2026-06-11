// アカウントタイプごとの「文字デザイン」と「AIトーン」を一元管理する
export type CaptionStyle = 'outline' | 'pill' | 'band';

export interface AccountTheme {
  key: string;
  label: string;
  emoji: string;
  accent: string; // アクセント色
  captionStyle: CaptionStyle; // 動画/画像の文字の見せ方
  toneHint: string; // AIの文章トーン指示
}

export const ACCOUNT_THEMES: AccountTheme[] = [
  {
    key: 'personal',
    label: '個人・クリエイター',
    emoji: '👤',
    accent: '#E1306C',
    captionStyle: 'outline',
    toneHint: 'フレンドリーでカジュアル。絵文字も使い、親近感のある言い回し。',
  },
  {
    key: 'cafe',
    label: 'カフェ',
    emoji: '☕',
    accent: '#B5835A',
    captionStyle: 'pill',
    toneHint: '温かくやわらかい。ほっと一息つけるような、ナチュラルで癒しのある言葉。',
  },
  {
    key: 'bar',
    label: 'バー',
    emoji: '🍸',
    accent: '#D4AF37',
    captionStyle: 'band',
    toneHint:
      '大人向けでシンプル・自然体。気取らず、日常の延長で誘うトーン。キザ・大げさ・ポエムっぽい言い回しは避ける。',
  },
  {
    key: 'restaurant',
    label: 'レストラン・飲食',
    emoji: '🍽',
    accent: '#E8552D',
    captionStyle: 'band',
    toneHint: 'シズル感があり食欲をそそる。できたて・美味しさが伝わる言葉。',
  },
  {
    key: 'beauty',
    label: '美容・サロン',
    emoji: '💅',
    accent: '#D6849B',
    captionStyle: 'pill',
    toneHint: '上品で美しい。自分へのご褒美・特別感のある言葉。',
  },
  {
    key: 'shop',
    label: 'ショップ・小売',
    emoji: '🛍',
    accent: '#E1306C',
    captionStyle: 'outline',
    toneHint: 'ワクワク感・お得感。今すぐ欲しくなるような言葉。',
  },
  {
    key: 'fitness',
    label: 'フィットネス・教室',
    emoji: '💪',
    accent: '#2FB36B',
    captionStyle: 'band',
    toneHint: '前向きでエネルギッシュ。背中を押す・やる気が出る言葉。',
  },
  {
    key: 'organization',
    label: '団体・法人',
    emoji: '🏢',
    accent: '#2A6FB0',
    captionStyle: 'band',
    toneHint: '丁寧で信頼感がある。きちんとした案内・お知らせの言葉。',
  },
];

export const DEFAULT_ACCOUNT_TYPE = 'personal';

export function getAccountTheme(type?: string): AccountTheme {
  return ACCOUNT_THEMES.find((t) => t.key === type) ?? ACCOUNT_THEMES[0];
}
