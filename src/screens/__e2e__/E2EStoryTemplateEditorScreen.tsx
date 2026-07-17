// Playwright回帰テスト専用の恒久ハーネス画面。
// StoryTemplateEditorを常時visible=trueで直接マウントし、ログインやScheduleScreen経由の
// 導線に依存せず検証できるようにする。通常のUI導線からは到達しない
// （?e2e=storyTemplateEditor クエリでのみ表示、src/navigation/RootNavigator.tsx参照）。
import React from 'react';
import { View, StyleSheet, Platform } from 'react-native';
import StoryTemplateEditor from '../../components/creative/StoryTemplateEditor';
import { useCreativeEditorStore } from '../../store/creativeEditorStore';
import { FIXTURE_PHOTO_URIS } from '../../e2e/fixtures';

export default function E2EStoryTemplateEditorScreen() {
  const assignPhoto = useCreativeEditorStore((s) => s.assignPhoto);

  // expo-image-pickerの実際のファイル選択ダイアログはPlaywrightから自動化できないため、
  // 写真を選んだ状態をテストから直接再現できるフックをwindowへ公開する（StoryTemplateEditor
  // はModal内に描画されるため、通常のTouchableOpacityをテストから確実にクリックするのは
  // 難しい。通常のUI導線には出ない）
  if (Platform.OS === 'web' && typeof window !== 'undefined') {
    (window as any).__e2eAssignPhoto = () => assignPhoto('photo_1', FIXTURE_PHOTO_URIS.photo1, 1600, 640);
  }

  return (
    <View style={styles.wrap}>
      <StoryTemplateEditor visible onClose={() => {}} onFinish={() => {}} />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: '#000' },
});
