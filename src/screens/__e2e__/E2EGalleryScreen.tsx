// Playwright回帰テスト専用の恒久ハーネス画面（フェーズ5）。
// StoryGalleryScreenをScheduleScreenのログインゲートを経由せず直接マウントし、
// フィルタチップの表示・絞り込み挙動を検証できるようにする。
// 通常のUI導線からは到達しない（?e2e=gallery クエリでのみ表示）。
import React from 'react';
import { View, StyleSheet } from 'react-native';
import StoryGalleryScreen from '../../components/creative/StoryGalleryScreen';

export default function E2EGalleryScreen() {
  return (
    <View style={styles.wrap}>
      <StoryGalleryScreen plan="free" onSelectTemplate={() => {}} />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: '#000', paddingTop: 40 },
});
