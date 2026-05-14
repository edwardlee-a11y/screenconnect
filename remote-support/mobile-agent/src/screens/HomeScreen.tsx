import React, { useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  Alert,
  Clipboard,
  Platform,
  ActivityIndicator,
  KeyboardAvoidingView,
  ScrollView,
} from 'react-native';
import { useKeepAwake } from 'expo-keep-awake';
import { useDeviceStore } from '../store/deviceStore';
import { registerDevice, sendHeartbeat, deregisterDevice, setServerUrl } from '../services/api';
import { connect, disconnect } from '../services/signalingService';

const COLORS = {
  bg:      '#0d0f12',
  panel:   '#13161b',
  border:  '#1f2530',
  accent:  '#00e5a0',
  accent2: '#0077ff',
  text:    '#e4e8f0',
  muted:   '#5a6070',
  muted2:  '#8899aa',
  danger:  '#ef4444',
  warn:    '#ff6b35',
};

const STATUS_LABELS: Record<string, string> = {
  idle:         'Not connected',
  registering:  'Registering device…',
  online:       'Online — waiting for agent',
  agent_joined: 'Agent connecting…',
  sharing:      'Screen sharing active',
  error:        'Error',
  offline:      'Offline',
};

const STATUS_COLORS: Record<string, string> = {
  idle:         COLORS.muted,
  registering:  COLORS.muted2,
  online:       COLORS.accent,
  agent_joined: COLORS.accent2,
  sharing:      COLORS.warn,
  error:        COLORS.danger,
  offline:      COLORS.muted,
};

export default function HomeScreen() {
  useKeepAwake();

  const { deviceId, sessionCode, status, errorMsg, setDevice, setStatus } = useDeviceStore();
  const [serverUrl, setServerUrlLocal] = useState(
    __DEV__
      ? (Platform.OS === 'android' ? 'http://10.0.2.2:4000' : 'http://localhost:4000')
      : 'https://screenconnect-production.up.railway.app',
  );
  const [showSettings, setShowSettings] = useState(false);
  const heartbeatRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // ── Register on mount ─────────────────────────────────────────────────────
  useEffect(() => {
    init();
    return () => {
      if (heartbeatRef.current) clearInterval(heartbeatRef.current);
      if (deviceId) deregisterDevice(deviceId).catch(console.error);
      disconnect();
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function init() {
    setStatus('registering');
    try {
      const name = `${Platform.OS === 'android' ? 'Android' : 'iOS'} Device`;
      const platform = Platform.OS === 'android' ? 'android' : 'ios';
      const device = await registerDevice(name, platform);
      setDevice(device.id, device.session_code);
      setStatus('online');

      connect(device.id, device.session_code);

      heartbeatRef.current = setInterval(() => {
        sendHeartbeat(device.id).catch(console.error);
      }, 30_000);
    } catch (err) {
      setStatus('error', (err as Error).message);
    }
  }

  function copyCode() {
    if (!sessionCode) return;
    Clipboard.setString(sessionCode);
    Alert.alert('Copied', 'Session code copied to clipboard');
  }

  function saveSettings() {
    setServerUrl(serverUrl);
    setShowSettings(false);
    // Re-register with new URL
    if (deviceId) deregisterDevice(deviceId).catch(console.error);
    disconnect();
    init();
  }

  const isActive = status === 'sharing' || status === 'agent_joined';

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">

        {/* Header */}
        <View style={styles.header}>
          <Text style={styles.headerLogo}>REMOTESUPPORT</Text>
          <TouchableOpacity onPress={() => setShowSettings(!showSettings)}>
            <Text style={styles.settingsIcon}>⚙</Text>
          </TouchableOpacity>
        </View>

        {/* Settings panel */}
        {showSettings && (
          <View style={styles.card}>
            <Text style={styles.cardLabel}>SERVER URL</Text>
            <TextInput
              style={styles.input}
              value={serverUrl}
              onChangeText={setServerUrlLocal}
              placeholder="http://192.168.1.100:4000"
              placeholderTextColor={COLORS.muted}
              autoCapitalize="none"
              keyboardType="url"
            />
            <TouchableOpacity style={styles.btnPrimary} onPress={saveSettings}>
              <Text style={styles.btnPrimaryText}>Save &amp; Reconnect</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* Session Code */}
        <View style={[styles.card, styles.codeCard]}>
          <Text style={styles.cardLabel}>SESSION CODE</Text>

          {status === 'registering' ? (
            <ActivityIndicator color={COLORS.accent} size="large" style={{ marginVertical: 16 }} />
          ) : sessionCode ? (
            <TouchableOpacity onPress={copyCode} activeOpacity={0.8}>
              <Text style={styles.codeText}>{sessionCode}</Text>
              <Text style={styles.codeSub}>Tap to copy · Share with your support agent</Text>
            </TouchableOpacity>
          ) : (
            <Text style={styles.codePlaceholder}>——</Text>
          )}
        </View>

        {/* Status */}
        <View style={styles.statusRow}>
          <View style={[styles.statusDot, { backgroundColor: STATUS_COLORS[status] ?? COLORS.muted }]} />
          <Text style={styles.statusText}>{STATUS_LABELS[status] ?? status}</Text>
          {status === 'error' && errorMsg ? (
            <Text style={styles.errorText}> — {errorMsg}</Text>
          ) : null}
        </View>

        {/* Active session indicator */}
        {isActive && (
          <View style={styles.activeBadge}>
            <View style={[styles.liveDot, { backgroundColor: COLORS.warn }]} />
            <Text style={styles.activeBadgeText}>
              {status === 'sharing' ? 'Screen sharing active' : 'Agent connecting…'}
            </Text>
          </View>
        )}

        {/* Platform note for iOS */}
        {Platform.OS === 'ios' && status === 'sharing' && (
          <View style={styles.iosNote}>
            <Text style={styles.iosNoteText}>
              iOS note: Full system screen capture requires a Broadcast Extension (Xcode). Currently sharing camera preview.
            </Text>
          </View>
        )}

        {/* How it works */}
        {status === 'online' && (
          <View style={styles.card}>
            <Text style={styles.cardLabel}>HOW IT WORKS</Text>
            <View style={styles.steps}>
              {[
                'Share the session code with your support agent',
                'Agent enters the code in the admin portal',
                'Screen sharing starts automatically',
                'Tap "Stop Sharing" to end the session',
              ].map((step, i) => (
                <View key={i} style={styles.step}>
                  <View style={styles.stepNum}>
                    <Text style={styles.stepNumText}>{i + 1}</Text>
                  </View>
                  <Text style={styles.stepText}>{step}</Text>
                </View>
              ))}
            </View>
          </View>
        )}

      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.bg },
  scroll:    { padding: 20, gap: 16 },

  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 4,
  },
  headerLogo:   { fontFamily: 'monospace', fontSize: 13, fontWeight: '700', color: COLORS.accent, letterSpacing: 3 },
  settingsIcon: { fontSize: 20, color: COLORS.muted },

  card: {
    backgroundColor: COLORS.panel,
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 12,
    padding: 20,
    gap: 12,
  },
  codeCard:    { alignItems: 'center', paddingVertical: 28 },
  cardLabel: {
    fontSize: 10,
    fontFamily: 'monospace',
    color: COLORS.muted,
    letterSpacing: 1.5,
    textTransform: 'uppercase',
  },

  codeText: {
    fontSize: 42,
    fontFamily: 'monospace',
    fontWeight: '700',
    color: COLORS.accent,
    letterSpacing: 10,
    textAlign: 'center',
  },
  codeSub:         { fontSize: 12, color: COLORS.muted, textAlign: 'center', marginTop: 6 },
  codePlaceholder: { fontSize: 42, fontFamily: 'monospace', color: COLORS.muted, letterSpacing: 10 },

  statusRow:   { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 2 },
  statusDot:   { width: 8, height: 8, borderRadius: 4 },
  statusText:  { fontSize: 13, fontFamily: 'monospace', color: COLORS.muted2 },
  errorText:   { fontSize: 12, color: COLORS.danger },

  activeBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: 'rgba(255,107,53,0.1)',
    borderWidth: 1,
    borderColor: 'rgba(255,107,53,0.3)',
    borderRadius: 8,
    padding: 12,
  },
  liveDot:          { width: 8, height: 8, borderRadius: 4 },
  activeBadgeText:  { fontSize: 13, color: COLORS.warn, fontWeight: '500' },

  iosNote: {
    backgroundColor: 'rgba(0,119,255,0.1)',
    borderWidth: 1,
    borderColor: 'rgba(0,119,255,0.3)',
    borderRadius: 8,
    padding: 12,
  },
  iosNoteText: { fontSize: 12, color: COLORS.accent2, lineHeight: 18 },

  steps:       { gap: 12, marginTop: 4 },
  step:        { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  stepNum: {
    width: 24, height: 24, borderRadius: 12,
    backgroundColor: 'rgba(0,229,160,0.1)',
    borderWidth: 1, borderColor: 'rgba(0,229,160,0.3)',
    alignItems: 'center', justifyContent: 'center', flexShrink: 0, marginTop: 1,
  },
  stepNumText:  { fontSize: 11, color: COLORS.accent, fontWeight: '700' },
  stepText:     { fontSize: 13, color: COLORS.muted2, flex: 1, lineHeight: 20 },

  input: {
    backgroundColor: '#1a1e27',
    borderWidth: 1, borderColor: COLORS.border,
    borderRadius: 8, padding: 12,
    color: COLORS.text, fontSize: 13,
    fontFamily: 'monospace',
  },
  btnPrimary:     { backgroundColor: COLORS.accent, borderRadius: 8, padding: 12, alignItems: 'center' },
  btnPrimaryText: { color: '#000', fontWeight: '700', fontSize: 14 },
});
