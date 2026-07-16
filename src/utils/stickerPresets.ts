// 「ストーリー作成」のステッカー素材。デザイン画像素材を新規に用意しなくても、
// 絵文字（Unicode文字）をTextLayerとして大きく配置するだけで、Instagramの
// 標準ステッカーより種類豊富な「ステッカー」機能を実装コストゼロで提供できる。
export interface StickerCategory {
  label: string;
  emojis: string[];
}

export const STICKER_CATEGORIES: StickerCategory[] = [
  { label: '飲食', emojis: ['🍽️', '☕', '🍰', '🍜', '🍣', '🍷', '🍺', '🥐', '🍕', '🍦'] },
  { label: 'お祝い', emojis: ['🎉', '🎊', '✨', '🎁', '🎈', '🥳', '⭐', '🌟', '💫', '🎀'] },
  { label: '気持ち', emojis: ['❤️', '😊', '🥰', '👍', '🙌', '💯', '🔥', '👏', '😍', '💖'] },
  { label: '案内', emojis: ['📍', '📅', '⏰', '📢', '✅', '👉', '⬇️', '💬', '📷', '🔔'] },
  { label: '季節', emojis: ['🌸', '☀️', '🍁', '❄️', '🌿', '🌊', '🌙', '🌈', '☔', '🎄'] },
];
