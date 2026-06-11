import { supabase } from './supabaseClient';

const BUCKET = 'post-images';

/**
 * 選択した画像をSupabase Storageにアップロードし、Instagramが取得できる公開URLを返す。
 * @param uri ImagePickerで選んだ画像のURI（web）またはdata/blob URL
 */
export async function uploadPostImage(uri: string): Promise<string> {
  // web/ブラウザでは uri を fetch して Blob 化できる
  const response = await fetch(uri);
  const blob = await response.blob();
  return uploadBlob(blob);
}

/** Blob（Canvasで合成した画像など）を直接アップロードして公開URLを返す */
export async function uploadBlob(blob: Blob): Promise<string> {
  const mime = blob.type || 'image/jpeg';
  const ext = (mime.split('/')[1] || 'jpg').replace('jpeg', 'jpg');
  const path = `posts/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;

  const { error } = await supabase.storage.from(BUCKET).upload(path, blob, {
    contentType: mime,
    upsert: false,
  });
  if (error) throw new Error(`画像アップロードに失敗しました: ${error.message}`);

  const { data } = supabase.storage.from(BUCKET).getPublicUrl(path);
  return data.publicUrl;
}
