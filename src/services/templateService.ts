import { Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';

// 投稿テンプレート（ひな形）。この端末だけに保存する（Supabaseには送らない）。
export interface PostTemplate {
  id: string;
  name: string; // 一覧で見分けるための名前
  caption: string;
  hashtags: string[];
  type: 'feed' | 'story';
  image_url?: string; // アップロード済みの画像URL（任意・軽量に保つため base64 は保存しない）
  created_at: string;
}

const SK_TEMPLATES = 'post_templates_v1';

async function readRaw(): Promise<string | null> {
  if (Platform.OS === 'web') {
    try {
      return localStorage.getItem(SK_TEMPLATES);
    } catch {
      return null;
    }
  }
  return SecureStore.getItemAsync(SK_TEMPLATES);
}

async function writeRaw(value: string): Promise<void> {
  if (Platform.OS === 'web') {
    try {
      localStorage.setItem(SK_TEMPLATES, value);
    } catch {
      // 容量超過などは無視（保存できなくてもアプリは動く）
    }
    return;
  }
  await SecureStore.setItemAsync(SK_TEMPLATES, value);
}

/** 保存済みのテンプレートを新しい順で取得する */
export async function getTemplates(): Promise<PostTemplate[]> {
  const raw = await readRaw();
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed as PostTemplate[];
  } catch {
    return [];
  }
}

/** テンプレートを1件保存して、保存後の一覧を返す */
export async function saveTemplate(
  input: Omit<PostTemplate, 'id' | 'created_at'>
): Promise<PostTemplate[]> {
  const list = await getTemplates();
  const template: PostTemplate = {
    ...input,
    id: `tpl_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    created_at: new Date().toISOString(),
  };
  const next = [template, ...list];
  await writeRaw(JSON.stringify(next));
  return next;
}

/** 既存テンプレートの内容を上書きする */
export async function updateTemplate(
  id: string,
  fields: Partial<Omit<PostTemplate, 'id' | 'created_at'>>
): Promise<PostTemplate[]> {
  const list = await getTemplates();
  const next = list.map((t) => (t.id === id ? { ...t, ...fields } : t));
  await writeRaw(JSON.stringify(next));
  return next;
}

/** テンプレートを削除する */
export async function deleteTemplate(id: string): Promise<PostTemplate[]> {
  const list = await getTemplates();
  const next = list.filter((t) => t.id !== id);
  await writeRaw(JSON.stringify(next));
  return next;
}
