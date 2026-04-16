import React, { useEffect, useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  Alert,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { SpinWheel } from '../components/SpinWheel';
import { ResultModal } from '../components/ResultModal';
import { gameApi } from '../services/api';
import { useAuthStore } from '../store/authStore';
import { useGameStore } from '../store/gameStore';
import {
  getSocket,
  joinGameSession,
  leaveGameSession,
} from '../services/socket';
import type { SpinResult } from '../services/api';

// Generate a random client seed
function generateClientSeed(): string {
  const chars = 'abcdef0123456789';
  return Array.from({ length: 16 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
}

export function GameScreen() {
  const { user, updateUser }                       = useAuthStore();
  const { sessionId, isSpinning, wheelSegments,
          minWager, maxWager, wager,
          setSession, clearSession, setSpinning,
          setLastResult, setWheelConfig, setWager,
          addJackpot, setLiveLeaderboard }          = useGameStore();

  const [targetIndex,    setTargetIndex]    = useState<number | null>(null);
  const [pendingResult,  setPendingResult]  = useState<SpinResult | null>(null);
  const [showResult,     setShowResult]     = useState(false);
  const [loadingSession, setLoadingSession] = useState(false);
  const [jackpotBanner,  setJackpotBanner]  = useState<string | null>(null);

  // ── Load wheel config ────────────────────────────────────────────────────
  useEffect(() => {
    gameApi.getWheelConfig().then(({ data }) => {
      if (data) setWheelConfig(data.segments, data.minWager, data.maxWager);
    });
  }, []);

  // ── Socket: listen for jackpot & leaderboard events ─────────────────────
  useEffect(() => {
    const socket = getSocket();

    const onJackpot = (payload: { username: string; payoutUsd: number; outcomeLabel: string; timestamp: string }) => {
      addJackpot(payload);
      setJackpotBanner(`🎉 ${payload.username} hit JACKPOT — $${payload.payoutUsd.toFixed(2)}!`);
      setTimeout(() => setJackpotBanner(null), 4000);
    };

    const onLeaderboard = (entries: { username: string; payoutUsd: number }[]) => {
      setLiveLeaderboard(entries);
    };

    socket.on('game:jackpot', onJackpot);
    socket.on('leaderboard:update', onLeaderboard);

    return () => {
      socket.off('game:jackpot', onJackpot);
      socket.off('leaderboard:update', onLeaderboard);
    };
  }, []);

  // ── Start session on mount ───────────────────────────────────────────────
  useEffect(() => {
    if (!sessionId) startSession();
    return () => {
      // End session and leave socket room on unmount
      if (sessionId) {
        leaveGameSession();
        gameApi.endSession();
      }
    };
  }, []);

  const startSession = useCallback(async () => {
    setLoadingSession(true);
    const { data, error } = await gameApi.startSession();
    if (error) {
      if (error.includes('already')) {
        // Session exists — end it and create fresh
        await gameApi.endSession();
        const retry = await gameApi.startSession();
        if (retry.data) {
          setSession(retry.data.sessionId, retry.data.serverSeedHash);
          joinGameSession(retry.data.sessionId);
        }
      } else {
        Alert.alert('Error', error);
      }
    } else if (data) {
      setSession(data.sessionId, data.serverSeedHash);
      joinGameSession(data.sessionId);
    }
    setLoadingSession(false);
  }, []);

  // ── Spin handler ─────────────────────────────────────────────────────────
  const handleSpin = useCallback(async () => {
    if (isSpinning || !sessionId || loadingSession) return;

    const balance = user?.balanceUsd ?? 0;
    if (balance < wager) {
      Alert.alert('Insufficient Balance', `You need at least $${wager.toFixed(2)} to spin.`);
      return;
    }

    setSpinning(true);
    const clientSeed = generateClientSeed();

    const { data, error } = await gameApi.spin(wager, clientSeed);

    if (error) {
      setSpinning(false);
      Alert.alert('Spin Failed', error);
      return;
    }

    if (data) {
      // Store result — show modal after animation completes
      setPendingResult(data);
      setLastResult(data);
      setTargetIndex(data.outcomeIndex);
      // Update balance immediately in store
      updateUser({ balanceUsd: data.newBalanceUsd });
    }
  }, [isSpinning, sessionId, wager, user, loadingSession]);

  const onSpinComplete = useCallback(() => {
    setSpinning(false);
    setTargetIndex(null);
    if (pendingResult) {
      setShowResult(true);
    }
  }, [pendingResult]);

  const handleCloseResult = useCallback(() => {
    setShowResult(false);
    setPendingResult(null);
  }, []);

  // ── Wager controls ───────────────────────────────────────────────────────
  const adjustWager = (delta: number) => {
    const next = Math.min(maxWager, Math.max(minWager, parseFloat((wager + delta).toFixed(2))));
    setWager(next);
  };

  const WAGER_PRESETS = [0.5, 1, 5, 10, 25];

  return (
    <LinearGradient colors={['#0D0D1A', '#16213E', '#0D0D1A']} style={styles.gradient}>
      <SafeAreaView style={styles.safe}>
        <ScrollView
          contentContainerStyle={styles.scroll}
          showsVerticalScrollIndicator={false}
          bounces={false}
        >
          {/* Jackpot banner */}
          {jackpotBanner && (
            <View style={styles.jackpotBanner}>
              <Text style={styles.jackpotBannerText}>{jackpotBanner}</Text>
            </View>
          )}

          {/* Header */}
          <View style={styles.header}>
            <Text style={styles.appTitle}>Spin & Win</Text>
            <View style={styles.balancePill}>
              <Text style={styles.balanceText}>
                ${(user?.balanceUsd ?? 0).toFixed(2)}
              </Text>
            </View>
          </View>

          {/* Wheel */}
          <View style={styles.wheelContainer}>
            {loadingSession ? (
              <ActivityIndicator size="large" color="#FFD700" />
            ) : (
              <SpinWheel
                segments={wheelSegments}
                targetIndex={targetIndex}
                onSpinComplete={onSpinComplete}
              />
            )}
          </View>

          {/* Wager controls */}
          <View style={styles.wagerSection}>
            <Text style={styles.wagerLabel}>Wager Amount</Text>

            <View style={styles.wagerRow}>
              <TouchableOpacity style={styles.wagerBtn} onPress={() => adjustWager(-0.5)}>
                <Text style={styles.wagerBtnText}>−</Text>
              </TouchableOpacity>
              <View style={styles.wagerDisplay}>
                <Text style={styles.wagerAmount}>${wager.toFixed(2)}</Text>
              </View>
              <TouchableOpacity style={styles.wagerBtn} onPress={() => adjustWager(0.5)}>
                <Text style={styles.wagerBtnText}>+</Text>
              </TouchableOpacity>
            </View>

            <View style={styles.presetsRow}>
              {WAGER_PRESETS.map((preset) => (
                <TouchableOpacity
                  key={preset}
                  style={[styles.preset, wager === preset && styles.presetActive]}
                  onPress={() => setWager(preset)}
                >
                  <Text style={[styles.presetText, wager === preset && styles.presetTextActive]}>
                    ${preset}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>

          {/* Spin button */}
          <TouchableOpacity
            style={[styles.spinBtn, (isSpinning || loadingSession) && styles.spinBtnDisabled]}
            onPress={handleSpin}
            activeOpacity={0.85}
            disabled={isSpinning || loadingSession}
          >
            <LinearGradient
              colors={isSpinning ? ['#555', '#333'] : ['#E94560', '#C0392B']}
              style={styles.spinBtnGradient}
            >
              <Text style={styles.spinBtnText}>
                {isSpinning ? 'Spinning...' : 'SPIN'}
              </Text>
            </LinearGradient>
          </TouchableOpacity>

          {/* Odds reference */}
          <View style={styles.oddsGrid}>
            {wheelSegments.filter(s => s.multiplier > 0).map((seg) => (
              <View key={seg.index} style={styles.oddsItem}>
                <Text style={styles.oddsLabel}>{seg.label}</Text>
              </View>
            ))}
          </View>
        </ScrollView>

        <ResultModal
          visible={showResult}
          result={pendingResult}
          onClose={handleCloseResult}
        />
      </SafeAreaView>
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  gradient:  { flex: 1 },
  safe:      { flex: 1 },
  scroll:    { paddingHorizontal: 20, paddingBottom: 40 },

  jackpotBanner: {
    backgroundColor: '#FFD700',
    paddingVertical: 8,
    paddingHorizontal: 16,
    marginHorizontal: 0,
  },
  jackpotBannerText: {
    color: '#0D0D1A',
    fontWeight: '800',
    fontSize: 13,
    textAlign: 'center',
  },

  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 16,
  },
  appTitle: { color: '#FFD700', fontSize: 22, fontWeight: '800' },
  balancePill: {
    backgroundColor: 'rgba(255,255,255,0.1)',
    borderRadius: 20,
    paddingHorizontal: 14,
    paddingVertical: 6,
  },
  balanceText: { color: '#FFFFFF', fontSize: 15, fontWeight: '700' },

  wheelContainer: {
    alignItems: 'center',
    marginVertical: 24,
    minHeight: 340,
    justifyContent: 'center',
  },

  wagerSection:  { marginBottom: 20 },
  wagerLabel:    { color: 'rgba(255,255,255,0.5)', fontSize: 13, marginBottom: 10 },
  wagerRow:      { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 12 },
  wagerBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: 'rgba(255,255,255,0.1)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  wagerBtnText:  { color: '#FFFFFF', fontSize: 22, fontWeight: '700' },
  wagerDisplay: {
    flex: 1,
    backgroundColor: 'rgba(255,255,255,0.05)',
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: 'center',
  },
  wagerAmount:   { color: '#FFD700', fontSize: 22, fontWeight: '800' },
  presetsRow:    { flexDirection: 'row', gap: 8 },
  preset: {
    flex: 1,
    paddingVertical: 8,
    borderRadius: 10,
    backgroundColor: 'rgba(255,255,255,0.05)',
    alignItems: 'center',
  },
  presetActive:    { backgroundColor: 'rgba(233,69,96,0.3)', borderColor: '#E94560', borderWidth: 1 },
  presetText:      { color: 'rgba(255,255,255,0.6)', fontSize: 13 },
  presetTextActive:{ color: '#FFFFFF', fontWeight: '700' },

  spinBtn:         { borderRadius: 18, overflow: 'hidden', marginBottom: 24 },
  spinBtnDisabled: { opacity: 0.6 },
  spinBtnGradient: { paddingVertical: 18, alignItems: 'center' },
  spinBtnText:     { color: '#FFFFFF', fontSize: 20, fontWeight: '900', letterSpacing: 2 },

  oddsGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, justifyContent: 'center' },
  oddsItem: {
    backgroundColor: 'rgba(255,255,255,0.05)',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  oddsLabel: { color: 'rgba(255,255,255,0.5)', fontSize: 12 },
});
