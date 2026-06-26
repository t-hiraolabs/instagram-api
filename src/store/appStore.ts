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
  tone: string;
  apiKey: string;
  /** ビジネス限定: ONのとき、過去の人気投稿の傾向をAI生成に自動で反映する */
  useTopPostsInsight: boolean;
}

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

  activeAccountSlot: 1 | 2;
  setActiveAccountSlot: (slot: 1 | 2) => void;

  loginPromptVisible: boolean;
  setLoginPromptVisible: (visible: boolean) => void;

  brandSettings: BrandSettings;
  setBrandSettings: (settings: Partial<BrandSettings>) => void;

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

  activeAccountSlot: 1,
  setActiveAccountSlot: (slot) => {
    if (typeof localStorage !== 'undefined') localStorage.setItem('active_account_slot', String(slot));
    set({ activeAccountSlot: slot });
  },

  loginPromptVisible: false,
  setLoginPromptVisible: (visible) => set({ loginPromptVisible: visible }),

  brandSettings: {
    brandName: '',
    industry: '',
    accountType: 'personal',
    atmosphere: '',
    targetAudience: '',
    tone: '明るい・ポジティブ',
    apiKey: '',
    useTopPostsInsight: false,
  },
  setBrandSettings: (settings) =>
    set((state) => ({ brandSettings: { ...state.brandSettings, ...settings } })),

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
