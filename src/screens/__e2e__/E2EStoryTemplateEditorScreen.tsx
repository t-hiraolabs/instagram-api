// Playwright回帰テスト専用の恒久ハーネス画面。
// StoryTemplateEditorを常時visible=trueで直接マウントし、ログインやScheduleScreen経由の
// 導線に依存せず検証できるようにする。通常のUI導線からは到達しない
// （?e2e=storyTemplateEditor クエリでのみ表示、src/navigation/RootNavigator.tsx参照）。
import React from 'react';
import { View, StyleSheet } from 'react-native';
import StoryTemplateEditor from '../../components/creative/StoryTemplateEditor';

export default function E2EStoryTemplateEditorScreen() {
  return (
    <View style={styles.wrap}>
      <StoryTemplateEditor visible onClose={() => {}} onFinish={() => {}} />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: '#000' },
});
