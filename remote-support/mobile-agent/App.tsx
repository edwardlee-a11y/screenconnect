import React from 'react';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaView, StyleSheet } from 'react-native';
import { registerGlobals } from 'react-native-webrtc';
import { useDeviceStore } from './src/store/deviceStore';
import HomeScreen from './src/screens/HomeScreen';
import SessionScreen from './src/screens/SessionScreen';

// Register WebRTC globals (RTCPeerConnection, mediaDevices, etc.) into the JS environment
registerGlobals();

export default function App() {
  const status = useDeviceStore((s) => s.status);
  const isInSession = status === 'sharing' || status === 'agent_joined';

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar style="light" />
      {isInSession ? <SessionScreen /> : <HomeScreen />}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0d0f12' },
});
