// プラン体系（無料 / Pro / ビジネス）を一元管理する。
// 表示用の PLANS と、機能ゲート・上限の判定ヘルパーをここに集約する。
import { COLORS } from './theme';

export type Plan = 'free' | 'pro' | 'business';

/** プランごとの月間AI生成上限 */
export const AI_LIMITS: Record<Plan, number> = { free: 5, pro: 50, business: 150 };

/** プランの順位（高いほど上位）。アップグレード判定に使う */
export const PLAN_RANK: Record<Plan, number> = { free: 0, pro: 1, business: 2 };

/** くりかえし投稿が使えるか（Pro以上） */
export function canRecurring(plan: Plan): boolean {
  return plan !== 'free';
}

/** 分析・インサイト系（過去投稿分析・DM管理など）が使えるか（ビジネスのみ） */
export function canAnalytics(plan: Plan): boolean {
  return plan === 'business';
}

/** 連携できるInstagramアカウント数の上限（フリーは1、Pro以上は3） */
export function maxInstagramAccounts(plan: Plan): number {
  return plan === 'free' ? 1 : 3;
}

/** DBの値などを安全に Plan 型へ寄せる */
export function asPlan(value: unknown): Plan {
  return value === 'pro' || value === 'business' ? value : 'free';
}

export interface PlanInfo {
  id: Plan;
  name: string;
  price: string;
  /** Stripe決済の対象か（無料は対象外） */
  paid: boolean;
  features: string[];
  color: string;
}

export const PLANS: PlanInfo[] = [
  {
    id: 'free',
    name: 'フリー',
    price: '無料',
    paid: false,
    features: ['AI生成 1アカウント5回まで', '予約投稿 2件まで', '今すぐ投稿 無制限', '写真に文字を合成'],
    color: COLORS.textMuted,
  },
  {
    id: 'pro',
    name: 'Pro',
    price: '¥980/月',
    paid: true,
    features: [
      'AI生成 月30回',
      '予約投稿 無制限',
      'くりかえし投稿（毎日/毎週/毎月/平日）',
      '複数アカウント連携（最大3つ）',
    ],
    color: COLORS.secondary,
  },
  {
    id: 'business',
    name: 'ビジネス',
    price: '¥2,480/月',
    paid: true,
    features: [
      'AI生成 月100回',
      'Proのすべての機能',
      '📊 インサイト分析',
      '過去投稿の反応を分析してAI生成',
      'DM管理（近日対応）',
    ],
    color: COLORS.primaryLight,
  },
];
