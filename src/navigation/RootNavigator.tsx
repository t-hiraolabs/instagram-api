import { NavigationContainer } from '@react-navigation/native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { View, Text, StyleSheet } from 'react-native';

import HomeScreen from '../screens/HomeScreen';
import GenerateScreen from '../screens/GenerateScreen';
import ScheduleScreen from '../screens/ScheduleScreen';
import ReelScreen from '../screens/ReelScreen';
import ProfileScreen from '../screens/ProfileScreen';
import { COLORS } from '../utils/theme';

const Tab = createBottomTabNavigator();
const Stack = createNativeStackNavigator();

function TabIcon({ name, focused }: { name: string; focused: boolean }) {
  const icons: Record<string, string> = {
    Home: '🏠',
    Generate: '✨',
    Post: '📸',
    Reel: '🎬',
    Schedule: '📅',
    Profile: '👤',
  };
  return (
    <View style={styles.tabIcon}>
      <Text style={[styles.tabEmoji, focused && styles.tabEmojiActive]}>
        {icons[name]}
      </Text>
    </View>
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
        name="Generate"
        component={GenerateScreen}
        options={{
          tabBarLabel: 'AI生成',
          tabBarIcon: ({ focused }) => <TabIcon name="Generate" focused={focused} />,
        }}
      />
      <Tab.Screen
        name="Post"
        component={ScheduleScreen}
        initialParams={{ mode: 'now' }}
        options={{
          tabBarLabel: '投稿',
          tabBarIcon: ({ focused }) => <TabIcon name="Post" focused={focused} />,
        }}
      />
      <Tab.Screen
        name="Reel"
        component={ReelScreen}
        options={{
          tabBarLabel: 'リール',
          tabBarIcon: ({ focused }) => <TabIcon name="Reel" focused={focused} />,
        }}
      />
      <Tab.Screen
        name="Schedule"
        component={ScheduleScreen}
        initialParams={{ mode: 'schedule' }}
        options={{
          tabBarLabel: '予約投稿',
          tabBarIcon: ({ focused }) => <TabIcon name="Schedule" focused={focused} />,
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
    <NavigationContainer>
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
  tabIcon: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  tabEmoji: {
    fontSize: 22,
    opacity: 0.5,
  },
  tabEmojiActive: {
    opacity: 1,
  },
  tabLabel: {
    fontSize: 10,
    fontWeight: '600',
  },
});
