import { create } from 'zustand';
import { saveInstagramCredentialsToSlot, clearInstagramStorageForSlot } from '../utils/instagram';

interface User {
  id: string;
  username: string;
  accessToken: string;
  profilePicture?: string;
}

export interface InstagramCredentials {
  userId: string;
  accessToken: string;
  username?: string;
  profilePictureUrl?: string;
}

export interface BrandSettings {
  brandName: string;
  industry: string;
  accountType: string;
  atmosphere: string;
  targetAudience: string;
  /** SEO・地域検索対策用の所在地（例: 愛媛県今治市） */
  location: string;
  tone: string;
  apiKey: string;
  /** ビジネス限定: ONのとき、過去の人気投稿の傾向をAI生成に自動で反映する */
  useTopPostsInsight: boolean;
}

export const DEFAULT_BRAND_SETTINGS: BrandSettings = {
  brandName: '',
  industry: '',
  accountType: 'personal',
  atmosphere: '',
  targetAudience: '',
  location: '',
  tone: '明るい・ポジティブ',
  apiKey: '',
  useTopPostsInsight: false,
};

interface ScheduledPost {
  id: string;
  imageUri: string;
  caption: string;
  hashtags: string[];
  scheduledAt: Date;
  status: 'pending' | 'published' | 'failed';
  type: 'feed' | 'story';
}

interface AppState {
  user: User | null;
  setUser: (user: User | null) => void;

  instagramCredentials: InstagramCredentials | null;
  setInstagramCredentials: (creds: InstagramCredentials | null) => void;

  secondInstagramCredentials: InstagramCredentials | null;
  setSecondInstagramCredentials: (creds: InstagramCredentials | null) => void;

  thirdInstagramCredentials: InstagramCredentials | null;
  setThirdInstagramCredentials: (creds: InstagramCredentials | null) => void;

  activeAccountSlot: 1 | 2 | 3;
  setActiveAccountSlot: (slot: 1 | 2 | 3) => void;

  /**
   * 指定スロットのInstagram連携を解除する。後続スロット（2→1、3→2）が
   * あれば繰り上げ、間が空かないようにする（保存先ストレージ・ブランド設定も含む）。
   */
  disconnectInstagramSlot: (slot: 1 | 2 | 3) => Promise<void>;

  loginPromptVisible: boolean;
  setLoginPromptVisible: (visible: boolean) => void;

  /** ホーム等からAI画像生成チャットを開くためのフラグ */
  openImageChat: boolean;
  setOpenImageChat: (v: boolean) => void;

  /** ホームのおすすめから開くとき、チャット入力欄に最初から入れておく文言 */
  chatPrefillText: string | null;
  setChatPrefillText: (v: string | null) => void;

  /** trueの場合、chatPrefillTextを入力欄に入れるだけでなく、開いた直後に自動送信する */
  chatAutoSend: boolean;
  setChatAutoSend: (v: boolean) => void;

  /** trueの場合、直近の会話を再開せず、必ず新しい会話としてチャットを開く */
  chatForceNew: boolean;
  setChatForceNew: (v: boolean) => void;

  /** ホームのインラインチャットで「この画像で投稿を作る」を押したとき、投稿タブへ渡す画像 */
  pendingUseImage: string | null;
  setPendingUseImage: (v: string | null) => void;

  /** AIアシスタントに常に覚えさせる説明（事業・サービス内容） */
  assistantMemory: string;
  setAssistantMemory: (v: string) => void;

  /** アカウント1のブランド設定 */
  brandSettings: BrandSettings;
  setBrandSettings: (settings: Partial<BrandSettings>) => void;
  resetBrandSettings: () => void;

  /** アカウント2のブランド設定 */
  brandSettings2: BrandSettings;
  setBrandSettings2: (settings: Partial<BrandSettings>) => void;
  resetBrandSettings2: () => void;

  /** アカウント3のブランド設定 */
  brandSettings3: BrandSettings;
  setBrandSettings3: (settings: Partial<BrandSettings>) => void;
  resetBrandSettings3: () => void;

  /** 連携完了後のブランド設定確認モーダル */
  brandConfirmModal: { slot: 1 | 2 | 3; draft: BrandSettings } | null;
  setBrandConfirmModal: (val: { slot: 1 | 2 | 3; draft: BrandSettings } | null) => void;

  scheduledPosts: ScheduledPost[];
  addScheduledPost: (post: ScheduledPost) => void;
  removeScheduledPost: (id: string) => void;
  updatePostStatus: (id: string, status: ScheduledPost['status']) => void;

  draft: {
    imageUri?: string;
    caption: string;
    hashtags: string[];
    type: 'feed' | 'story';
  };
  setDraft: (draft: Partial<AppState['draft']>) => void;
  clearDraft: () => void;
}

export const useAppStore = create<AppState>((set, get) => ({
  user: null,
  setUser: (user) => set({ user }),

  instagramCredentials: null,
  setInstagramCredentials: (creds) => set({ instagramCredentials: creds }),

  secondInstagramCredentials: null,
  setSecondInstagramCredentials: (creds) => set({ secondInstagramCredentials: creds }),

  thirdInstagramCredentials: null,
  setThirdInstagramCredentials: (creds) => set({ thirdInstagramCredentials: creds }),

  activeAccountSlot: 1,
  setActiveAccountSlot: (slot) => {
    if (typeof localStorage !== 'undefined') localStorage.setItem('active_account_slot', String(slot));
    set({ activeAccountSlot: slot });
  },

  disconnectInstagramSlot: async (slot) => {
    const state = get();
    const creds2 = state.secondInstagramCredentials;
    const creds3 = state.thirdInstagramCredentials;
    const brand2 = state.brandSettings2;
    const brand3 = state.brandSettings3;

    if (slot === 1) {
      // 2→1、3→2に繰り上げ、3は空にする
      if (creds2) await saveInstagramCredentialsToSlot(1, creds2);
      else await clearInstagramStorageForSlot(1);
      if (creds3) await saveInstagramCredentialsToSlot(2, creds3);
      else await clearInstagramStorageForSlot(2);
      await clearInstagramStorageForSlot(3);
      set({
        instagramCredentials: creds2 ?? null,
        secondInstagramCredentials: creds3 ?? null,
        thirdInstagramCredentials: null,
        brandSettings: creds2 ? brand2 : { ...DEFAULT_BRAND_SETTINGS },
        brandSettings2: creds3 ? brand3 : { ...DEFAULT_BRAND_SETTINGS },
        brandSettings3: { ...DEFAULT_BRAND_SETTINGS },
      });
    } else if (slot === 2) {
      // 3→2に繰り上げ、3は空にする
      if (creds3) await saveInstagramCredentialsToSlot(2, creds3);
      else await clearInstagramStorageForSlot(2);
      await clearInstagramStorageForSlot(3);
      set({
        secondInstagramCredentials: creds3 ?? null,
        thirdInstagramCredentials: null,
        brandSettings2: creds3 ? brand3 : { ...DEFAULT_BRAND_SETTINGS },
        brandSettings3: { ...DEFAULT_BRAND_SETTINGS },
      });
    } else {
      await clearInstagramStorageForSlot(3);
      set({ thirdInstagramCredentials: null, brandSettings3: { ...DEFAULT_BRAND_SETTINGS } });
    }

    // アクティブスロットも繰り上げに合わせて調整する
    const current = get().activeAccountSlot;
    let nextActive = current > slot ? ((current - 1) as 1 | 2 | 3) : current;
    const nextCredsBySlot = {
      1: get().instagramCredentials,
      2: get().secondInstagramCredentials,
      3: get().thirdInstagramCredentials,
    };
    if (!nextCredsBySlot[nextActive]) nextActive = 1;
    if (nextActive !== current) get().setActiveAccountSlot(nextActive);
  },

  loginPromptVisible: false,
  setLoginPromptVisible: (visible) => set({ loginPromptVisible: visible }),

  openImageChat: false,
  setOpenImageChat: (v) => set({ openImageChat: v }),

  chatPrefillText: null,
  setChatPrefillText: (v) => set({ chatPrefillText: v }),

  chatAutoSend: false,
  setChatAutoSend: (v) => set({ chatAutoSend: v }),

  chatForceNew: false,
  setChatForceNew: (v) => set({ chatForceNew: v }),

  pendingUseImage: null,
  setPendingUseImage: (v) => set({ pendingUseImage: v }),

  assistantMemory: '',
  setAssistantMemory: (v) => set({ assistantMemory: v }),

  brandSettings: { ...DEFAULT_BRAND_SETTINGS },
  setBrandSettings: (settings) =>
    set((state) => ({ brandSettings: { ...state.brandSettings, ...settings } })),
  resetBrandSettings: () => set({ brandSettings: { ...DEFAULT_BRAND_SETTINGS } }),

  brandSettings2: { ...DEFAULT_BRAND_SETTINGS },
  setBrandSettings2: (settings) =>
    set((state) => ({ brandSettings2: { ...state.brandSettings2, ...settings } })),
  resetBrandSettings2: () => set({ brandSettings2: { ...DEFAULT_BRAND_SETTINGS } }),

  brandSettings3: { ...DEFAULT_BRAND_SETTINGS },
  setBrandSettings3: (settings) =>
    set((state) => ({ brandSettings3: { ...state.brandSettings3, ...settings } })),
  resetBrandSettings3: () => set({ brandSettings3: { ...DEFAULT_BRAND_SETTINGS } }),

  brandConfirmModal: null,
  setBrandConfirmModal: (val) => set({ brandConfirmModal: val }),

  scheduledPosts: [],
  addScheduledPost: (post) =>
    set((state) => ({ scheduledPosts: [...state.scheduledPosts, post] })),
  removeScheduledPost: (id) =>
    set((state) => ({
      scheduledPosts: state.scheduledPosts.filter((p) => p.id !== id),
    })),
  updatePostStatus: (id, status) =>
    set((state) => ({
      scheduledPosts: state.scheduledPosts.map((p) =>
        p.id === id ? { ...p, status } : p
      ),
    })),

  draft: {
    caption: '',
    hashtags: [],
    type: 'feed',
  },
  setDraft: (draft) =>
    set((state) => ({ draft: { ...state.draft, ...draft } })),
  clearDraft: () =>
    set({ draft: { caption: '', hashtags: [], type: 'feed' } }),
}));
