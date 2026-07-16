import { NavigationContainer, createNavigationContainerRef, DarkTheme } from '@react-navigation/native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { StyleSheet, Platform } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import HomeScreen from '../screens/HomeScreen';
import ScheduleScreen from '../screens/ScheduleScreen';
import AnalyticsScreen from '../screens/AnalyticsScreen';
import ProfileScreen from '../screens/ProfileScreen';
import AdminAssetsScreen from '../screens/AdminAssetsScreen';
import E2ECreativeCanvasScreen from '../screens/__e2e__/E2ECreativeCanvasScreen';
import E2ELayerPanelScreen from '../screens/__e2e__/E2ELayerPanelScreen';
import E2EGalleryScreen from '../screens/__e2e__/E2EGalleryScreen';
import E2EFeedCropScreen from '../screens/__e2e__/E2EFeedCropScreen';
import E2EPositionCanvasScreen from '../screens/__e2e__/E2EPositionCanvasScreen';
import { COLORS } from '../utils/theme';

// Playwright回帰テスト（フェーズ5）専用の起動ルート判定。?e2e=... クエリがある時だけ
// ログイン等を経由しないテストハーネス画面を起動する。通常のアプリ起動には一切影響しない。
const E2E_ROUTES: Record<string, string> = {
  creativeCanvas: 'E2ECreativeCanvas',
  layerPanel: 'E2ELayerPanel',
  gallery: 'E2EGallery',
  feedCrop: 'E2EFeedCrop',
  positionCanvas: 'E2EPositionCanvas',
};
function getInitialRouteName(): string {
  if (Platform.OS === 'web' && typeof window !== 'undefined') {
    const e2e = new URLSearchParams(window.location.search).get('e2e');
    if (e2e && E2E_ROUTES[e2e]) return E2E_ROUTES[e2e];
  }
  return 'Main';
}

const Tab = createBottomTabNavigator();
const Stack = createNativeStackNavigator();

// React NavigationはデフォルトでLightTheme（白背景）を使うため、画面遷移中やコンテンツが
// 画面より短いときに白い隙間が見えてしまう。アプリはダークテーマ固定なので背景色を合わせる。
const NAV_THEME = {
  ...DarkTheme,
  colors: { ...DarkTheme.colors, background: COLORS.background, card: COLORS.surface, border: COLORS.border },
};

/** NavigationContainerの外（App.tsxのOAuthHandlerなど）から画面遷移するための参照 */
export const navigationRef = createNavigationContainerRef();

/** NavigationContainerの準備ができるまで待ってから画面遷移する */
export function navigateWhenReady(name: string, params?: object, retriesLeft = 40): void {
  if (navigationRef.isReady()) {
    // @ts-expect-error 画面名は動的
    navigationRef.navigate(name, params);
    return;
  }
  if (retriesLeft <= 0) return;
  setTimeout(() => navigateWhenReady(name, params, retriesLeft - 1), 50);
}

const TAB_ICONS: Record<string, keyof typeof Ionicons.glyphMap> = {
  Home: 'home',
  Post: 'add-circle',
  Analytics: 'bar-chart',
  Profile: 'person',
};
const TAB_ICONS_OUTLINE: Record<string, keyof typeof Ionicons.glyphMap> = {
  Home: 'home-outline',
  Post: 'add-circle-outline',
  Analytics: 'bar-chart-outline',
  Profile: 'person-outline',
};

function TabIcon({ name, focused }: { name: string; focused: boolean }) {
  const iconName = focused ? TAB_ICONS[name] : TAB_ICONS_OUTLINE[name];
  return (
    <Ionicons
      name={iconName}
      size={24}
      color={focused ? COLORS.primary : COLORS.textMuted}
    />
  );
}

function TabNavigator() {
  return (
    <Tab.Navigator
      screenOptions={{
        headerShown: false,
        tabBarStyle: styles.tabBar,
        tabBarActiveTintColor: COLORS.primary,
        tabBarInactiveTintColor: COLORS.textMuted,
        tabBarLabelStyle: styles.tabLabel,
      }}
    >
      <Tab.Screen
        name="Home"
        component={HomeScreen}
        options={{
          tabBarLabel: 'ホーム',
          tabBarIcon: ({ focused }) => <TabIcon name="Home" focused={focused} />,
        }}
      />
      <Tab.Screen
        name="Post"
        component={ScheduleScreen}
        options={{
          tabBarLabel: '投稿',
          tabBarIcon: ({ focused }) => <TabIcon name="Post" focused={focused} />,
        }}
      />
      <Tab.Screen
        name="Analytics"
        component={AnalyticsScreen}
        options={{
          tabBarLabel: '分析',
          tabBarIcon: ({ focused }) => <TabIcon name="Analytics" focused={focused} />,
        }}
      />
      <Tab.Screen
        name="Profile"
        component={ProfileScreen}
        options={{
          tabBarLabel: 'プロフィール',
          tabBarIcon: ({ focused }) => <TabIcon name="Profile" focused={focused} />,
        }}
      />
    </Tab.Navigator>
  );
}

export default function RootNavigator() {
  return (
    <NavigationContainer
      ref={navigationRef}
      theme={NAV_THEME}
      documentTitle={{
        formatter: () => 'AImark アイマーク',
      }}
    >
      <Stack.Navigator screenOptions={{ headerShown: false }} initialRouteName={getInitialRouteName()}>
        <Stack.Screen name="Main" component={TabNavigator} />
        <Stack.Screen name="AdminAssets" component={AdminAssetsScreen} />
        <Stack.Screen name="E2ECreativeCanvas" component={E2ECreativeCanvasScreen} />
        <Stack.Screen name="E2ELayerPanel" component={E2ELayerPanelScreen} />
        <Stack.Screen name="E2EGallery" component={E2EGalleryScreen} />
        <Stack.Screen name="E2EFeedCrop" component={E2EFeedCropScreen} />
        <Stack.Screen name="E2EPositionCanvas" component={E2EPositionCanvasScreen} />
      </Stack.Navigator>
    </NavigationContainer>
  );
}

const styles = StyleSheet.create({
  tabBar: {
    backgroundColor: COLORS.surface,
    borderTopColor: COLORS.border,
    borderTopWidth: 1,
    paddingBottom: 8,
    paddingTop: 8,
    height: 70,
  },
  tabLabel: {
    fontSize: 10,
    fontWeight: '600',
  },
});
