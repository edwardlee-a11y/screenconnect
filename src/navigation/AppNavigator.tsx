import React, { useEffect } from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { Text, ActivityIndicator, View } from 'react-native';

import { AuthScreen }            from '../screens/AuthScreen';
import { LobbyScreen }           from '../screens/LobbyScreen';
import { TrySpinScreen }         from '../screens/TrySpinScreen';
import { RoomsScreen }           from '../screens/RoomsScreen';
import { GameScreen }            from '../screens/GameScreen';
import { WalletScreen }          from '../screens/WalletScreen';
import { HistoryScreen }         from '../screens/HistoryScreen';
import { LeaderboardScreen }     from '../screens/LeaderboardScreen';
import { AccountSettingsScreen } from '../screens/AccountSettingsScreen';
import { AdminDashboardScreen }  from '../screens/AdminDashboardScreen';
import { useAuthStore }          from '../store/authStore';

export type GameStackParamList = {
  Lobby:   undefined;
  TrySpin: undefined;
  Rooms:   undefined;
  Game:    { tier: number };
};

export type RootStackParamList = {
  Main:           undefined;
  Auth:           undefined;
  AdminDashboard: undefined;
};

const GameStack = createNativeStackNavigator<GameStackParamList>();
const Stack = createNativeStackNavigator<RootStackParamList>();
const Tab   = createBottomTabNavigator();

function TabIcon({ emoji, focused }: { emoji: string; focused: boolean }) {
  return <Text style={{ fontSize: 20, opacity: focused ? 1 : 0.4 }}>{emoji}</Text>;
}

function GameStackNavigator() {
  return (
    <GameStack.Navigator screenOptions={{ headerShown: false }}>
      <GameStack.Screen name="Lobby"   component={LobbyScreen} />
      <GameStack.Screen name="TrySpin" component={TrySpinScreen} />
      <GameStack.Screen name="Rooms"   component={RoomsScreen} />
      <GameStack.Screen name="Game"    component={GameScreen} />
    </GameStack.Navigator>
  );
}

function MainTabs() {
  return (
    <Tab.Navigator
      screenOptions={{
        headerShown: false,
        tabBarStyle: {
          backgroundColor: '#0D0D1A',
          borderTopColor: 'rgba(255,255,255,0.06)',
          paddingBottom: 6,
          height: 60,
        },
        tabBarLabelStyle: {
          color: 'rgba(255,255,255,0.5)',
          fontSize: 11,
        },
        tabBarActiveTintColor: '#FFD700',
        tabBarInactiveTintColor: 'rgba(255,255,255,0.35)',
      }}
    >
      <Tab.Screen
        name="Game"
        component={GameStackNavigator}
        options={{ tabBarIcon: ({ focused }) => <TabIcon emoji="🎰" focused={focused} /> }}
      />
      <Tab.Screen
        name="Leaderboard"
        component={LeaderboardScreen}
        options={{ tabBarIcon: ({ focused }) => <TabIcon emoji="🏆" focused={focused} /> }}
      />
      <Tab.Screen
        name="History"
        component={HistoryScreen}
        options={{ tabBarIcon: ({ focused }) => <TabIcon emoji="📋" focused={focused} /> }}
      />
      <Tab.Screen
        name="Wallet"
        component={WalletScreen}
        options={{ tabBarIcon: ({ focused }) => <TabIcon emoji="💰" focused={focused} /> }}
      />
      <Tab.Screen
        name="Profile"
        component={AccountSettingsScreen}
        options={{ tabBarIcon: ({ focused }) => <TabIcon emoji="⚙️" focused={focused} /> }}
      />
    </Tab.Navigator>
  );
}

export function AppNavigator() {
  const { token, isLoading, loadFromStorage } = useAuthStore();

  useEffect(() => {
    loadFromStorage();
  }, []);

  if (isLoading) {
    return (
      <View style={{ flex: 1, backgroundColor: '#0D0D1A', justifyContent: 'center', alignItems: 'center' }}>
        <ActivityIndicator size="large" color="#FFD700" />
      </View>
    );
  }

  return (
    <NavigationContainer>
      <Stack.Navigator screenOptions={{ headerShown: false }}>
        {token ? (
          <Stack.Screen name="Main" component={MainTabs} />
        ) : (
          <Stack.Screen name="Auth" component={AuthScreen} />
        )}
        <Stack.Screen name="AdminDashboard" component={AdminDashboardScreen} />
      </Stack.Navigator>
    </NavigationContainer>
  );
}
