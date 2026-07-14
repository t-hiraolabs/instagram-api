// ホーム画面の「今日のおすすめ投稿ネタ」。ブランド設定の業種（aiService.tsのINDUSTRIESの
// keyと対応）に応じて内容を出し分ける。AIを呼ばず無料で出せるものだけを扱う。
import { Ionicons } from '@expo/vector-icons';

export interface PostIdea {
  text: string;
  icon: keyof typeof Ionicons.glyphMap;
}

// 業種が未設定・非対応のときの汎用ネタ
const GENERIC_IDEAS: PostIdea[] = [
  { text: '新作・季節限定メニューの紹介', icon: 'sparkles-outline' },
  { text: 'お客様の声・ビフォーアフター', icon: 'chatbox-ellipses-outline' },
  { text: '期間限定キャンペーンの告知', icon: 'megaphone-outline' },
  { text: 'スタッフ紹介・お店の裏側', icon: 'people-outline' },
  { text: '本日のおすすめ・入荷情報', icon: 'today-outline' },
  { text: 'よくある質問に答える投稿', icon: 'help-circle-outline' },
  { text: 'リピーター向けの感謝メッセージ', icon: 'heart-outline' },
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
};

/** ブランド設定の業種に応じたおすすめ投稿ネタの候補一覧を返す（未設定・非対応時は汎用ネタ） */
export function getPostIdeas(industry: string): PostIdea[] {
  return INDUSTRY_IDEAS[industry] ?? GENERIC_IDEAS;
}
