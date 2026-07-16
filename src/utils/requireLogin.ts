import { Platform, Alert } from 'react-native';
import { supabase } from '../services/supabaseClient';
import { useAppStore } from '../store/appStore';

/**
 * ログインが必要な操作の前に呼ぶ。
 * ログイン済みなら true を返す。
 * 未ログインなら案内を出してログイン画面を開き、false を返す。
 * preferSignup: trueの場合、開くログイン画面を「新規登録」タブ優先で表示する
 * （AI機能など、未登録ユーザーがまず出会う導線向け）。
 */
export async function ensureLoggedIn(message = 'この機能を使うにはログインが必要です', preferSignup = false): Promise<boolean> {
  const { data } = await supabase.auth.getSession();
  if (data.session) return true;

  const openLogin = () => {
    useAppStore.getState().setAuthInitialMode(preferSignup ? 'signup' : 'login');
    useAppStore.getState().setLoginPromptVisible(true);
  };

  const actionLabel = preferSignup ? 'アカウント作成' : 'ログイン';

  if (Platform.OS === 'web') {
    if (window.confirm(`${message}\n\n${actionLabel}画面を開きますか？`)) {
      openLogin();
    }
  } else {
    Alert.alert(`${actionLabel}が必要です`, message, [
      { text: 'キャンセル', style: 'cancel' },
      { text: actionLabel, onPress: openLogin },
    ]);
  }
  return false;
}
