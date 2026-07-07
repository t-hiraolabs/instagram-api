import { create } from 'zustand';

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

export const useAppStore = create<AppState>((set) => ({
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
