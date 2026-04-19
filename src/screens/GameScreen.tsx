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
import { useNavigation, useRoute } from '@react-navigation/native';
import type { NativeStackNavigationProp, NativeStackScreenProps } from '@react-navigation/native-stack';
import { SpinWheel } from '../components/SpinWheel';
import { ResultModal } from '../components/ResultModal';
import { gameApi } from '../services/api';
import { useAuthStore } from '../store/authStore';
import { useGameStore } from '../store/gameStore';
import {
  getSocket,
  joinGameSession,
  leaveGameSession,
  joinRoom,
  leaveRoom,
} from '../services/socket';
import type { SpinResult } from '../services/api';
import type { RoomUpdatePayload, RoomRoundStartPayload, RoomRoundResultPayload } from '../services/socket';
import type { GameStackParamList } from '../navigation/AppNavigator';

const MIN_PLAYERS = 5;

function generateClientSeed(): string {
  const chars = 'abcdef0123456789';
  return Array.from({ length: 16 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
}

type Props = NativeStackScreenProps<GameStackParamList, 'Game'>;

export function GameScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<GameStackParamList>>();
  const route = useRoute<Props['route']>();
  const tier = route.params?.tier ?? 1;

  const { user, updateUser }     = useAuthStore();
  const {
    sessionId, isSpinning, wheelSegments,
    setSession, clearSession, setSpinning,
    setLastResult, setWheelConfig,
    setCurrentRoom, updateRoomPlayers,
    roomPlayerCount, roomPlayers, isRoomReady,
    addJackpot, setLiveLeaderboard,
  } = useGameStore();

  const [targetIndex,    setTargetIndex]    = useState<number | null>(null);
  const [pendingResult,  setPendingResult]  = useState<SpinResult | null>(null);
  const [showResult,     setShowResult]     = useState(false);
  const [loadingSession, setLoadingSession] = useState(false);
  const [jackpotBanner,  setJackpotBanner]  = useState<string | null>(null);
  const [roundId,        setRoundId]        = useState<string | null>(null);
  const [hasSpun,        setHasSpun]        = useState(false);
  const [countdown,      setCountdown]      = useState<number | null>(null);
  const [roundResult,    setRoundResult]    = useState<RoomRoundResultPayload | null>(null);
  const countdownRef = React.useRef<ReturnType<typeof setInterval> | null>(null);

  // ── Load wheel config ──────────────────────────────────────────────────────
  useEffect(() => {
    gameApi.getWheelConfig().then(({ data }) => {
      if (data) setWheelConfig(data.segments, data.minWager, data.maxWager);
    });
  }, []);

  // ── Socket: jackpot, leaderboard, room updates ─────────────────────────────
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

    const onRoomUpdate = (payload: RoomUpdatePayload) => {
      if (payload.tier === tier) {
        updateRoomPlayers(payload.tier, payload.players, payload.isReady);
      }
    };

    const onRoundStart = (payload: RoomRoundStartPayload) => {
      if (payload.tier !== tier) return;
      setRoundId(payload.roundId);
      setHasSpun(false);
      setRoundResult(null);

      // Countdown timer
      const tick = () => {
        const remaining = Math.max(0, Math.ceil((payload.deadlineMs - Date.now()) / 1000));
        setCountdown(remaining);
        if (remaining <= 0 && countdownRef.current) {
          clearInterval(countdownRef.current);
          countdownRef.current = null;
        }
      };
      tick();
      countdownRef.current = setInterval(tick, 1000);
    };

    const onRoundResult = (payload: RoomRoundResultPayload) => {
      if (payload.tier !== tier) return;
      setRoundId(null);
      setCountdown(null);
      setRoundResult(payload);
      if (countdownRef.current) {
        clearInterval(countdownRef.current);
        countdownRef.current = null;
      }
    };

    socket.on('game:jackpot', onJackpot);
    socket.on('leaderboard:update', onLeaderboard);
    socket.on('room:update', onRoomUpdate);
    socket.on('room:round:start' as never, onRoundStart as never);
    socket.on('room:round:result' as never, onRoundResult as never);

    return () => {
      socket.off('game:jackpot', onJackpot);
      socket.off('leaderboard:update', onLeaderboard);
      socket.off('room:update', onRoomUpdate);
      socket.off('room:round:start' as never, onRoundStart as never);
      socket.off('room:round:result' as never, onRoundResult as never);
      if (countdownRef.current) clearInterval(countdownRef.current);
    };
  }, [tier]);

  // ── Join room + start session on mount ─────────────────────────────────────
  useEffect(() => {
    setCurrentRoom(tier);
    joinRoom(tier);
    if (!sessionId) startSession();

    return () => {
      leaveRoom();
      if (sessionId) {
        leaveGameSession();
        gameApi.endSession();
      }
      clearSession();
    };
  }, []);

  const startSession = useCallback(async () => {
    setLoadingSession(true);
    const { data, error } = await gameApi.startSession();
    if (error) {
      if (error.includes('already')) {
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

  // ── Spin handler ───────────────────────────────────────────────────────────
  const handleSpin = useCallback(() => {
    if (isSpinning || !sessionId || loadingSession || !roundId || hasSpun) return;

    setSpinning(true);
    setHasSpun(true);
    const clientSeed = generateClientSeed();
    getSocket().emit('room:spin' as never, { tier, clientSeed } as never);
    // Spin animation runs; result comes back via room:round:result
    setTimeout(() => setSpinning(false), 4000);
  }, [isSpinning, sessionId, roundId, hasSpun, tier, loadingSession]);

  const onSpinComplete = useCallback(() => {
    setSpinning(false);
    setTargetIndex(null);
    if (pendingResult) setShowResult(true);
  }, [pendingResult]);

  const handleCloseResult = useCallback(() => {
    setShowResult(false);
    setPendingResult(null);
  }, []);

  const spinDisabled = isSpinning || loadingSession || !roundId || hasSpun;

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
            <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
              <Text style={styles.backText}>← Rooms</Text>
            </TouchableOpacity>
            <View style={styles.balancePill}>
              <Text style={styles.balanceText}>${(user?.balanceUsd ?? 0).toFixed(2)}</Text>
            </View>
          </View>

          {/* Room info */}
          <View style={styles.roomInfo}>
            <Text style={styles.roomTitle}>${tier.toLocaleString()} Room</Text>
            <View style={[styles.roomBadge, roundId ? styles.roomBadgeReady : styles.roomBadgeWaiting]}>
              <Text style={styles.roomBadgeText}>
                {roundId
                  ? countdown !== null ? `${countdown}s` : 'ROUND'
                  : `${roomPlayerCount}/${MIN_PLAYERS}`}
              </Text>
            </View>
          </View>

          {/* Round result banner */}
          {roundResult && (
            <View style={styles.resultBanner}>
              <Text style={styles.resultTitle}>
                {roundResult.winner === (user?.username ?? '') ? '🏆 You Won!' : `Winner: ${roundResult.winner}`}
              </Text>
              <Text style={styles.resultSub}>
                Prize: ${roundResult.winnerPayout.toFixed(2)}  ·  Pool: ${roundResult.pool.toFixed(2)}  ·  Platform: ${roundResult.platformFee.toFixed(2)}
              </Text>
            </View>
          )}

          {/* Waiting overlay on wheel */}
          <View style={styles.wheelContainer}>
            {loadingSession ? (
              <ActivityIndicator size="large" color="#FFD700" />
            ) : (
              <>
                <SpinWheel
                  segments={wheelSegments}
                  targetIndex={targetIndex}
                  onSpinComplete={onSpinComplete}
                />
                {!isRoomReady && (
                  <View style={styles.waitingOverlay}>
                    <Text style={styles.waitingEmoji}>⏳</Text>
                    <Text style={styles.waitingTitle}>Waiting for players</Text>
                    <Text style={styles.waitingCount}>{roomPlayerCount} / {MIN_PLAYERS} joined</Text>
                    {roomPlayers.length > 0 && (
                      <Text style={styles.waitingNames}>{roomPlayers.join(', ')}</Text>
                    )}
                  </View>
                )}
              </>
            )}
          </View>

          {/* Spin button */}
          <TouchableOpacity
            style={[styles.spinBtn, spinDisabled && styles.spinBtnDisabled]}
            onPress={handleSpin}
            activeOpacity={0.85}
            disabled={spinDisabled}
          >
            <LinearGradient
              colors={spinDisabled ? ['#555', '#333'] : ['#E94560', '#C0392B']}
              style={styles.spinBtnGradient}
            >
              <Text style={styles.spinBtnText}>
                {isSpinning
                  ? 'Spinning...'
                  : !roundId
                  ? 'Waiting for Players...'
                  : hasSpun
                  ? 'Waiting for Others...'
                  : `SPIN — $${tier}`}
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
  },
  jackpotBannerText: {
    color: '#0D0D1A', fontWeight: '800', fontSize: 13, textAlign: 'center',
  },

  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 16,
  },
  backBtn:    { paddingVertical: 6, paddingRight: 12 },
  backText:   { color: '#FFD700', fontSize: 15, fontWeight: '600' },
  balancePill: {
    backgroundColor: 'rgba(255,255,255,0.1)',
    borderRadius: 20,
    paddingHorizontal: 14,
    paddingVertical: 6,
  },
  balanceText: { color: '#FFFFFF', fontSize: 15, fontWeight: '700' },

  roomInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    marginBottom: 8,
  },
  roomTitle: { color: '#FFD700', fontSize: 20, fontWeight: '800' },
  roomBadge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 8 },
  roomBadgeReady:   { backgroundColor: 'rgba(46,213,115,0.2)' },
  roomBadgeWaiting: { backgroundColor: 'rgba(255,200,0,0.15)' },
  roomBadgeText: { color: '#fff', fontSize: 11, fontWeight: '700', letterSpacing: 1 },

  wheelContainer: {
    alignItems: 'center',
    marginVertical: 20,
    minHeight: 340,
    justifyContent: 'center',
  },

  resultBanner: {
    backgroundColor: 'rgba(255,215,0,0.12)',
    borderRadius: 12,
    padding: 14,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: 'rgba(255,215,0,0.3)',
    alignItems: 'center',
  },
  resultTitle: { color: '#FFD700', fontSize: 16, fontWeight: '800', marginBottom: 4 },
  resultSub:   { color: 'rgba(255,255,255,0.5)', fontSize: 12, textAlign: 'center' },

  waitingOverlay: {
    position: 'absolute',
    top: 0, left: 0, right: 0, bottom: 0,
    backgroundColor: 'rgba(13,13,26,0.85)',
    borderRadius: 180,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 24,
  },
  waitingEmoji: { fontSize: 40, marginBottom: 10 },
  waitingTitle: { color: '#FFD700', fontSize: 18, fontWeight: '800', marginBottom: 6 },
  waitingCount: { color: '#fff', fontSize: 14, marginBottom: 8 },
  waitingNames: { color: 'rgba(255,255,255,0.5)', fontSize: 12, textAlign: 'center' },

  spinBtn:         { borderRadius: 18, overflow: 'hidden', marginBottom: 24 },
  spinBtnDisabled: { opacity: 0.6 },
  spinBtnGradient: { paddingVertical: 18, alignItems: 'center' },
  spinBtnText:     { color: '#FFFFFF', fontSize: 18, fontWeight: '900', letterSpacing: 1 },

  oddsGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, justifyContent: 'center' },
  oddsItem: {
    backgroundColor: 'rgba(255,255,255,0.05)',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  oddsLabel: { color: 'rgba(255,255,255,0.5)', fontSize: 12 },
});
