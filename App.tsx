import 'react-native-gesture-handler';
import React, { useEffect } from 'react';
import { StatusBar } from 'expo-status-bar';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { WalletConnectModal } from '@walletconnect/modal-react-native';
import Constants from 'expo-constants';
import { AppNavigator } from './src/navigation/AppNavigator';
import { loadSounds, unloadSounds } from './src/services/sound';
import { usePushNotifications } from './src/hooks/usePushNotifications';

const walletConnectProjectId =
  (Constants.expoConfig?.extra?.walletConnectProjectId as string) ?? '';

const providerMetadata = {
  name: 'Spin & Win',
  description: 'Crypto Wheel Game',
  url: 'https://spinandwin.app',
  icons: ['https://spinandwin.app/icon.png'],
  redirect: {
    native: 'spinandwin://',
    universal: 'https://spinandwin.app',
  },
};

function AppInner() {
  usePushNotifications();

  useEffect(() => {
    loadSounds();
    return () => { unloadSounds(); };
  }, []);

  return (
    <>
      <StatusBar style="light" />
      <AppNavigator />
      <WalletConnectModal
        projectId={walletConnectProjectId}
        providerMetadata={providerMetadata}
      />
    </>
  );
}

export default function App() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <AppInner />
    </GestureHandlerRootView>
  );
}
