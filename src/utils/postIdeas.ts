// ホーム画面の「今日のおすすめ投稿ネタ」。ブランド設定の業種（プロフィール画面の
// 自由入力欄）に応じて内容を出し分ける。AIを呼ばず無料で出せるものだけを扱う。
//
// 業種は自由入力なので、aiService.tsのINDUSTRIESと完全一致しないことが多い
// （例:「AIマーケティング支援」）。完全一致しない場合はキーワードで近い業種に
// マッチさせ、それでも該当がなければ業種を問わず使える汎用ネタにフォールバックする。
import { Ionicons } from '@expo/vector-icons';

export interface PostIdea {
  text: string;
  icon: keyof typeof Ionicons.glyphMap;
}

// 業種が全く特定できないときの、本当に業種を問わない汎用ネタ
const GENERIC_IDEAS: PostIdea[] = [
  { text: 'お客様の声・導入事例の紹介', icon: 'chatbox-ellipses-outline' },
  { text: '最新のお知らせ・アップデート情報', icon: 'megaphone-outline' },
  { text: 'よくある質問に答える投稿', icon: 'help-circle-outline' },
  { text: 'サービス・商品の使い方紹介', icon: 'bulb-outline' },
  { text: 'チーム・メンバー紹介', icon: 'people-outline' },
  { text: '実績・成果の紹介', icon: 'trophy-outline' },
  { text: 'キャンペーン・特典のお知らせ', icon: 'gift-outline' },
];

const INDUSTRY_IDEAS: Record<string, PostIdea[]> = {
  '美容・ネイル・まつ毛': [
    { text: '施術のビフォーアフター', icon: 'sparkles-outline' },
    { text: '人気デザイン・スタイル紹介', icon: 'color-palette-outline' },
    { text: '季節のおすすめメニュー', icon: 'today-outline' },
    { text: 'お客様の仕上がり写真', icon: 'camera-outline' },
    { text: '新メニュー・新色の入荷情報', icon: 'pricetag-outline' },
    { text: 'よくあるお悩み相談Q&A', icon: 'help-circle-outline' },
    { text: 'リピーター特典・キャンペーン', icon: 'gift-outline' },
  ],
  '飲食・カフェ・スイーツ': [
    { text: '新作・季節限定メニューの紹介', icon: 'restaurant-outline' },
    { text: '本日のおすすめ・入荷情報', icon: 'today-outline' },
    { text: '調理・仕込みの裏側', icon: 'flame-outline' },
    { text: 'お客様の投稿・口コミ紹介', icon: 'chatbox-ellipses-outline' },
    { text: '期間限定キャンペーンの告知', icon: 'megaphone-outline' },
    { text: 'スタッフ紹介・お店の雰囲気', icon: 'people-outline' },
    { text: '混雑状況・空席情報', icon: 'time-outline' },
  ],
  'アパレル・ファッション': [
    { text: '新作アイテムの紹介', icon: 'shirt-outline' },
    { text: 'コーディネート提案', icon: 'color-palette-outline' },
    { text: '着回し・スタイリング術', icon: 'repeat-outline' },
    { text: 'セール・キャンペーン告知', icon: 'pricetag-outline' },
    { text: 'スタッフの私服スナップ', icon: 'camera-outline' },
    { text: 'サイズ感・素材の紹介', icon: 'information-circle-outline' },
    { text: 'お客様のコーデ紹介', icon: 'heart-outline' },
  ],
  'ハンドメイド・クラフト': [
    { text: '新作作品の紹介', icon: 'sparkles-outline' },
    { text: '制作過程・裏側の紹介', icon: 'construct-outline' },
    { text: '使用素材・こだわりの紹介', icon: 'leaf-outline' },
    { text: 'オーダーメイドの実例紹介', icon: 'gift-outline' },
    { text: '販売イベント・出店情報', icon: 'calendar-outline' },
    { text: 'お客様の使用シーン紹介', icon: 'camera-outline' },
    { text: '在庫入荷・再販のお知らせ', icon: 'cube-outline' },
  ],
  'フィットネス・ヨガ・ピラティス': [
    { text: 'ビフォーアフター・体験談', icon: 'barbell-outline' },
    { text: 'おすすめプログラム紹介', icon: 'fitness-outline' },
    { text: '簡単にできるセルフケア', icon: 'heart-outline' },
    { text: 'インストラクター紹介', icon: 'people-outline' },
    { text: '体験レッスンの告知', icon: 'megaphone-outline' },
    { text: 'お客様の変化・成果紹介', icon: 'trending-up-outline' },
    { text: 'キャンペーン・入会特典', icon: 'gift-outline' },
  ],
  'フォトグラファー・映像': [
    { text: '撮影実績・作品集', icon: 'images-outline' },
    { text: '撮影の裏側・メイキング', icon: 'videocam-outline' },
    { text: 'お客様の声・感想紹介', icon: 'chatbox-ellipses-outline' },
    { text: '撮影プラン・料金紹介', icon: 'pricetag-outline' },
    { text: '撮影のコツ・小ネタ紹介', icon: 'bulb-outline' },
    { text: 'ロケ地・スタジオ紹介', icon: 'location-outline' },
    { text: '空き枠・予約受付のお知らせ', icon: 'calendar-outline' },
  ],
  'インテリア・リフォーム・DIY': [
    { text: '施工事例・ビフォーアフター', icon: 'home-outline' },
    { text: 'おすすめ商品・素材紹介', icon: 'cube-outline' },
    { text: 'DIYのコツ・小ネタ紹介', icon: 'construct-outline' },
    { text: 'お客様の声・仕上がり紹介', icon: 'chatbox-ellipses-outline' },
    { text: '現場・施工の裏側紹介', icon: 'hammer-outline' },
    { text: '相談会・見学会のお知らせ', icon: 'calendar-outline' },
    { text: 'キャンペーン・特典情報', icon: 'gift-outline' },
  ],
  '教育・コーチング・コンサル': [
    { text: '受講生の成果・体験談', icon: 'trophy-outline' },
    { text: 'よくある質問に答える投稿', icon: 'help-circle-outline' },
    { text: 'ミニ講座・お役立ち情報', icon: 'bulb-outline' },
    { text: '講座・セミナーの告知', icon: 'megaphone-outline' },
    { text: '講師紹介・実績紹介', icon: 'school-outline' },
    { text: '無料相談・体験会のお知らせ', icon: 'calendar-outline' },
    { text: '受講生の声・感想紹介', icon: 'chatbox-ellipses-outline' },
  ],
  '健康・ウェルネス・サプリ': [
    { text: '商品の効果・使い方紹介', icon: 'medkit-outline' },
    { text: 'お客様の体験談・変化', icon: 'trending-up-outline' },
    { text: '健康に関する豆知識', icon: 'bulb-outline' },
    { text: '新商品・入荷情報', icon: 'cube-outline' },
    { text: 'キャンペーン・特典情報', icon: 'gift-outline' },
    { text: 'よくある質問に答える投稿', icon: 'help-circle-outline' },
    { text: 'スタッフのおすすめ紹介', icon: 'people-outline' },
  ],
  '旅行・観光・宿泊': [
    { text: 'おすすめスポット紹介', icon: 'location-outline' },
    { text: '宿泊プラン・料金紹介', icon: 'pricetag-outline' },
    { text: 'お客様の滞在・感想紹介', icon: 'chatbox-ellipses-outline' },
    { text: '季節のイベント情報', icon: 'calendar-outline' },
    { text: '施設・お部屋の紹介', icon: 'bed-outline' },
    { text: '周辺グルメ・観光情報', icon: 'restaurant-outline' },
    { text: '空室状況・予約のお知らせ', icon: 'today-outline' },
  ],
  'ペット・動物関連': [
    { text: '施術・お手入れのビフォーアフター', icon: 'paw-outline' },
    { text: 'ペットのかわいい瞬間紹介', icon: 'camera-outline' },
    { text: 'お客様の声・感想紹介', icon: 'chatbox-ellipses-outline' },
    { text: '商品・サービスの紹介', icon: 'cube-outline' },
    { text: '季節のケア方法紹介', icon: 'bulb-outline' },
    { text: 'キャンペーン・特典情報', icon: 'gift-outline' },
    { text: 'よくある質問に答える投稿', icon: 'help-circle-outline' },
  ],
  '音楽・アート・クリエイター': [
    { text: '新作・最新作品の紹介', icon: 'musical-notes-outline' },
    { text: '制作過程・裏側の紹介', icon: 'construct-outline' },
    { text: 'ライブ・展示会の告知', icon: 'megaphone-outline' },
    { text: 'ファンの声・感想紹介', icon: 'chatbox-ellipses-outline' },
    { text: '活動の裏側・エピソード', icon: 'sparkles-outline' },
    { text: 'コラボ・新企画のお知らせ', icon: 'people-outline' },
    { text: 'グッズ・販売情報', icon: 'pricetag-outline' },
  ],
  'IT・Web制作・マーケティング支援': [
    { text: '導入事例・お客様の成果紹介', icon: 'trophy-outline' },
    { text: '機能アップデート・新機能のお知らせ', icon: 'megaphone-outline' },
    { text: 'よくある質問に答える投稿', icon: 'help-circle-outline' },
    { text: '業界トレンド・お役立ち豆知識', icon: 'bulb-outline' },
    { text: 'サービスの使い方Tips', icon: 'construct-outline' },
    { text: 'お客様の声・レビュー紹介', icon: 'chatbox-ellipses-outline' },
    { text: '無料相談・資料請求のご案内', icon: 'calendar-outline' },
  ],
};

// 業種は自由入力のため、完全一致しない場合に備えたキーワードでの近似マッチング表
// （先に定義したものが優先。「マーケティング」はコンサル系ではなくIT/Web系に寄せる）
const INDUSTRY_KEYWORDS: [string, string[]][] = [
  ['美容・ネイル・まつ毛', ['美容', 'ネイル', 'まつ毛', 'エステ', 'サロン', 'ヘアサロン', '理容']],
  ['飲食・カフェ・スイーツ', ['飲食', 'カフェ', 'レストラン', 'スイーツ', 'パン', 'ケーキ', '居酒屋', '食堂', '料理']],
  ['アパレル・ファッション', ['アパレル', 'ファッション', '衣料', 'ブティック']],
  ['ハンドメイド・クラフト', ['ハンドメイド', 'クラフト', '手作り', '工芸']],
  ['フィットネス・ヨガ・ピラティス', ['フィットネス', 'ヨガ', 'ピラティス', 'ジム', 'トレーニング', 'トレーナー']],
  ['フォトグラファー・映像', ['フォト', '写真', 'カメラ', '映像', '動画', '撮影']],
  ['インテリア・リフォーム・DIY', ['インテリア', 'リフォーム', 'DIY', '工務店', '家具', '建築']],
  ['IT・Web制作・マーケティング支援', ['IT', 'Web', 'ウェブ', 'マーケティング', '広告', 'SNS', 'DX', 'システム', 'アプリ開発', 'AI', 'SaaS']],
  ['教育・コーチング・コンサル', ['教育', 'コーチング', 'コンサル', '講座', 'スクール', '塾', '士業', 'セミナー', '研修']],
  ['健康・ウェルネス・サプリ', ['健康', 'ウェルネス', 'サプリ', '整体', '鍼灸', 'マッサージ', '治療院']],
  ['旅行・観光・宿泊', ['旅行', '観光', '宿泊', 'ホテル', '旅館', 'ゲストハウス']],
  ['ペット・動物関連', ['ペット', '動物', 'トリミング', '動物病院']],
  ['音楽・アート・クリエイター', ['音楽', 'アート', 'クリエイター', 'イラスト', '絵画', 'バンド']],
];

function matchIndustryKey(industry: string): string | null {
  if (!industry) return null;
  if (INDUSTRY_IDEAS[industry]) return industry;
  const found = INDUSTRY_KEYWORDS.find(([, keywords]) => keywords.some((kw) => industry.includes(kw)));
  return found ? found[0] : null;
}

/** ブランド設定の業種（自由入力）に応じたおすすめ投稿ネタの候補一覧を返す。
 *  完全一致しない場合はキーワードで近い業種にマッチさせ、それでも該当なければ汎用ネタを返す。 */
export function getPostIdeas(industry: string): PostIdea[] {
  const key = matchIndustryKey(industry);
  return key ? INDUSTRY_IDEAS[key] : GENERIC_IDEAS;
}
