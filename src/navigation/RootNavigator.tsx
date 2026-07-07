import { NavigationContainer, createNavigationContainerRef, DarkTheme } from '@react-navigation/native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import HomeScreen from '../screens/HomeScreen';
import ScheduleScreen from '../screens/ScheduleScreen';
import AnalyticsScreen from '../screens/AnalyticsScreen';
import DMScreen from '../screens/DMScreen';
import ProfileScreen from '../screens/ProfileScreen';
import { COLORS } from '../utils/theme';

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
  DM: 'chatbubble-ellipses',
  Profile: 'person',
};
const TAB_ICONS_OUTLINE: Record<string, keyof typeof Ionicons.glyphMap> = {
  Home: 'home-outline',
  Post: 'add-circle-outline',
  Analytics: 'bar-chart-outline',
  DM: 'chatbubble-ellipses-outline',
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
        name="DM"
        component={DMScreen}
        options={{
          tabBarLabel: 'DM',
          tabBarIcon: ({ focused }) => <TabIcon name="DM" focused={focused} />,
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
      <Stack.Navigator screenOptions={{ headerShown: false }}>
        <Stack.Screen name="Main" component={TabNavigator} />
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
