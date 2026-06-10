import { Platform, Alert } from 'react-native';
import { supabase } from '../services/supabaseClient';
import { useAppStore } from '../store/appStore';

/**
 * ログインが必要な操作の前に呼ぶ。
 * ログイン済みなら true を返す。
 * 未ログインなら案内を出してログイン画面を開き、false を返す。
 */
export async function ensureLoggedIn(message = 'この機能を使うにはログインが必要です'): Promise<boolean> {
  const { data } = await supabase.auth.getSession();
  if (data.session) return true;

  const openLogin = () => useAppStore.getState().setLoginPromptVisible(true);

  if (Platform.OS === 'web') {
    if (window.confirm(`${message}\n\nログイン画面を開きますか？`)) {
      openLogin();
    }
  } else {
    Alert.alert('ログインが必要です', message, [
      { text: 'キャンセル', style: 'cancel' },
      { text: 'ログイン', onPress: openLogin },
    ]);
  }
  return false;
}
