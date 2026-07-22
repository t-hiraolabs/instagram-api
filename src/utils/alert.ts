import { Alert, Platform } from 'react-native';

export interface AlertButton {
  text?: string;
  onPress?: () => void;
  style?: 'default' | 'cancel' | 'destructive';
}

/**
 * Alert.alert()の薄いラッパー。react-native-webのAlert.alert()は完全なno-op
 * （何も表示しない）実装のため、これをそのままWeb版で使うと、エラー・確認・
 * 案内メッセージが一切ユーザーに表示されないまま握りつぶされてしまう
 * （このアプリの主な提供形態はWebであるため、これは実質的にメッセージ機能が
 * 丸ごと壊れているのと同じ）。Web上ではwindow.alert/window.confirmで代替する。
 *
 * ボタンが0〜1個（案内のみ）: window.alertで表示し、ボタンのonPressがあれば呼ぶ。
 * ボタンが2個（確認/キャンセルなど）: window.confirmで表示し、OKならボタン配列の
 * 最後（通常は肯定アクション）のonPressを、キャンセルなら先頭のonPressを呼ぶ。
 * ボタンが3個以上: window.confirmでは2択までしか表現できないため、先頭を
 * キャンセル、それ以外をまとめて「実行」側として扱う（Web上での妥当な近似）。
 */
export function showAlert(title: string, message?: string, buttons?: AlertButton[]): void {
  if (Platform.OS !== 'web') {
    Alert.alert(title, message, buttons as any);
    return;
  }
  const text = message ? `${title}\n\n${message}` : title;
  if (!buttons || buttons.length <= 1) {
    window.alert(text);
    buttons?.[0]?.onPress?.();
    return;
  }
  const cancelIndex = buttons.findIndex((b) => b.style === 'cancel');
  const cancelBtn = cancelIndex >= 0 ? buttons[cancelIndex] : buttons[0];
  const confirmBtn = buttons.find((b, i) => i !== cancelIndex && b !== cancelBtn) ?? buttons[buttons.length - 1];
  if (window.confirm(text)) {
    confirmBtn?.onPress?.();
  } else {
    cancelBtn?.onPress?.();
  }
}
