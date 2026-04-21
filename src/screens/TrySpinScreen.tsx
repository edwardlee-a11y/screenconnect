import React, { useState, useCallback, useRef } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity,
  ScrollView, Modal, Animated,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { useNavigation } from '@react-navigation/native';
import { SpinWheel } from '../components/SpinWheel';
import { useGameStore } from '../store/gameStore';
import type { WheelSegment } from '../services/api';
import { Haptics, Sounds } from '../services/sound';

// Mirrors the server WHEEL — used for local weighted random
const LOCAL_WHEEL = [
  { index: 0,  label: 'LOSE',    multiplier: 0,   weight: 280 },
  { index: 1,  label: 'LOSE',    multiplier: 0,   weight: 200 },
  { index: 2,  label: '1.2x',   multiplier: 1.2,  weight: 150 },
  { index: 3,  label: '1.5x',   multiplier: 1.5,  weight: 120 },
  { index: 4,  label: 'LOSE',    multiplier: 0,   weight: 80  },
  { index: 5,  label: '2x',     multiplier: 2,    weight: 60  },
  { index: 6,  label: '1.2x',   multiplier: 1.2,  weight: 40  },
  { index: 7,  label: '3x',     multiplier: 3,    weight: 30  },
  { index: 8,  label: '2x',     multiplier: 2,    weight: 20  },
  { index: 9,  label: '5x',     multiplier: 5,    weight: 12  },
  { index: 10, label: '10x',    multiplier: 10,   weight: 5   },
  { index: 11, label: 'JACKPOT', multiplier: 50,  weight: 3   },
];
const TOTAL_WEIGHT = LOCAL_WHEEL.reduce((s, seg) => s + seg.weight, 0);

const STARTING_BALANCE = 1_000;
const WAGER_PRESETS    = [10, 25, 50, 100, 250];

function pickWeightedRandom(): number {
  let r = Math.random() * TOTAL_WEIGHT;
  for (let i = 0; i < LOCAL_WHEEL.length; i++) {
    r -= LOCAL_WHEEL[i].weight;
    if (r <= 0) return i;
  }
  return LOCAL_WHEEL.length - 1;
}

interface RoundResult {
  playerIdx:    number;
  botIdx:       number;
  playerPayout: number;
  botPayout:    number;
  wager:        number;
}

export function TrySpinScreen() {
  const navigation = useNavigation();
  const { wheelSegments } = useGameStore();

  // Use API segments if loaded, otherwise fall back to local config
  const segments: WheelSegment[] = wheelSegments.length > 0
    ? wheelSegments
    : LOCAL_WHEEL.map(s => ({ index: s.index, label: s.label, multiplier: s.multiplier }));

  const [virtualBalance, setVirtualBalance] = useState(STARTING_BALANCE);
  const [wager,          setWager]          = useState(WAGER_PRESETS[0]);
  const [isSpinning,     setIsSpinning]     = useState(false);
  const [targetIndex,    setTargetIndex]    = useState<number | null>(null);
  const [roundResult,    setRoundResult]    = useState<RoundResult | null>(null);
  const [showResult,     setShowResult]     = useState(false);
  const [botSpinning,    setBotSpinning]    = useState(false);
  const botTargetRef = useRef<number>(0);

  const pendingResultRef = useRef<RoundResult | null>(null);

  const handleSpin = useCallback(() => {
    if (isSpinning) return;

    const effectiveWager = Math.min(wager, virtualBalance);
    if (effectiveWager <= 0) {
      setVirtualBalance(STARTING_BALANCE);
      return;
    }

    const playerIdx = pickWeightedRandom();
    const botIdx    = pickWeightedRandom();

    const playerPayout = parseFloat((effectiveWager * LOCAL_WHEEL[playerIdx].multiplier).toFixed(2));
    const botPayout    = parseFloat((effectiveWager * LOCAL_WHEEL[botIdx].multiplier).toFixed(2));

    pendingResultRef.current = { playerIdx, botIdx, playerPayout, botPayout, wager: effectiveWager };
    botTargetRef.current = botIdx;

    setIsSpinning(true);
    setTargetIndex(playerIdx);
    setRoundResult(null);
    setShowResult(false);
    Haptics.spinStart();
    Sounds.spin();
  }, [isSpinning, wager, virtualBalance]);

  const onSpinComplete = useCallback(() => {
    setIsSpinning(false);
    setTargetIndex(null);
    setBotSpinning(true);

    // Short pause then reveal bot result + show modal
    setTimeout(() => {
      setBotSpinning(false);
      const result = pendingResultRef.current;
      if (!result) return;

      const netChange = result.playerPayout - result.wager;
      setVirtualBalance(prev => {
        const next = prev + netChange;
        // Auto-reset if broke
        return next < WAGER_PRESETS[0] ? STARTING_BALANCE : Math.round(next * 100) / 100;
      });

      setRoundResult(result);
      setShowResult(true);

      if (LOCAL_WHEEL[result.playerIdx].label === 'JACKPOT') {
        Haptics.jackpot(); Sounds.jackpot();
      } else if (result.playerPayout > result.wager) {
        Haptics.win(); Sounds.win();
      } else {
        Haptics.lose(); Sounds.lose();
      }
    }, 1200);
  }, []);

  const handleClose = useCallback(() => {
    setShowResult(false);
    setRoundResult(null);
  }, []);

  const spinDisabled = isSpinning || botSpinning;

  return (
    <LinearGradient colors={['#0D0D1A', '#16213E', '#0D0D1A']} style={styles.gradient}>
      <SafeAreaView style={styles.safe}>
        <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>

          {/* Header */}
          <View style={styles.header}>
            <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
              <Text style={styles.backText}>← Lobby</Text>
            </TouchableOpacity>
            <View style={styles.balancePill}>
              <Text style={styles.balancePillLabel}>Play Credits</Text>
              <Text style={styles.balancePillValue}>{virtualBalance.toLocaleString()}</Text>
            </View>
          </View>

          {/* Mode label */}
          <View style={styles.modeBadge}>
            <Text style={styles.modeBadgeText}>🎯 FREE PLAY — vs Bot · No real money</Text>
          </View>

          {/* Wheel */}
          <View style={styles.wheelContainer}>
            <SpinWheel
              segments={segments}
              targetIndex={targetIndex}
              onSpinComplete={onSpinComplete}
            />
          </View>

          {/* Bot spinner indicator */}
          {botSpinning && (
            <View style={styles.botRow}>
              <Text style={styles.botText}>🤖 Bot is spinning...</Text>
            </View>
          )}

          {/* Wager presets */}
          <Text style={styles.wagerLabel}>Select Wager (Play Credits)</Text>
          <View style={styles.presets}>
            {WAGER_PRESETS.map(p => (
              <TouchableOpacity
                key={p}
                style={[styles.presetBtn, wager === p && styles.presetBtnActive]}
                onPress={() => setWager(p)}
                disabled={spinDisabled}
              >
                <Text style={[styles.presetText, wager === p && styles.presetTextActive]}>
                  {p}
                </Text>
              </TouchableOpacity>
            ))}
          </View>

          {/* Spin button */}
          <TouchableOpacity
            style={[styles.spinBtn, spinDisabled && styles.spinBtnDisabled]}
            onPress={handleSpin}
            activeOpacity={0.85}
            disabled={spinDisabled}
          >
            <LinearGradient
              colors={spinDisabled ? ['#333', '#222'] : ['#1A6B47', '#0F3460']}
              style={styles.spinBtnGradient}
            >
              <Text style={styles.spinBtnText}>
                {isSpinning  ? 'Spinning...'
                : botSpinning ? '🤖 Bot Spinning...'
                : `SPIN FREE — ${wager} Credits`}
              </Text>
            </LinearGradient>
          </TouchableOpacity>

          {/* Odds reference */}
          <View style={styles.oddsGrid}>
            {LOCAL_WHEEL.filter(s => s.multiplier > 0).map((seg) => (
              <View key={seg.index} style={styles.oddsItem}>
                <Text style={styles.oddsLabel}>{seg.label}</Text>
                <Text style={styles.oddsChance}>{((seg.weight / TOTAL_WEIGHT) * 100).toFixed(1)}%</Text>
              </View>
            ))}
          </View>

        </ScrollView>
      </SafeAreaView>

      {/* Result modal */}
      {roundResult && (
        <TrySpinResultModal
          visible={showResult}
          result={roundResult}
          onClose={handleClose}
        />
      )}
    </LinearGradient>
  );
}

// ─── Result modal ──────────────────────────────────────────────────────────────

interface TrySpinResultModalProps {
  visible:  boolean;
  result:   RoundResult;
  onClose:  () => void;
}

function TrySpinResultModal({ visible, result, onClose }: TrySpinResultModalProps) {
  const scaleAnim = useRef(new Animated.Value(0)).current;

  React.useEffect(() => {
    if (visible) {
      Animated.spring(scaleAnim, { toValue: 1, damping: 12, stiffness: 180, useNativeDriver: true }).start();
    } else {
      Animated.timing(scaleAnim, { toValue: 0, duration: 150, useNativeDriver: true }).start();
    }
  }, [visible]);

  const playerSeg    = LOCAL_WHEEL[result.playerIdx];
  const botSeg       = LOCAL_WHEEL[result.botIdx];
  const playerWon    = result.playerPayout > result.botPayout;
  const tie          = result.playerPayout === result.botPayout;
  const netChange    = result.playerPayout - result.wager;
  const isPlayerWin  = playerSeg.multiplier > 0;

  const headline = tie       ? "🤝 It's a Tie!"
                 : playerWon ? '🏆 You Beat the Bot!'
                 :             '🤖 Bot Wins This Round';

  const headlineColor = tie       ? '#FFD700'
                      : playerWon ? '#2ED573'
                      :             '#E94560';

  return (
    <Modal transparent visible={visible} animationType="fade" onRequestClose={onClose}>
      <View style={modalStyles.overlay}>
        <Animated.View style={[modalStyles.card, { transform: [{ scale: scaleAnim }] }]}>
          <Text style={[modalStyles.headline, { color: headlineColor }]}>{headline}</Text>

          {/* VS comparison */}
          <View style={modalStyles.vsRow}>
            <ResultSide
              label="You"
              emoji="👤"
              outcome={playerSeg.label}
              payout={result.playerPayout}
              wager={result.wager}
              isWinner={playerWon && !tie}
            />
            <Text style={modalStyles.vsText}>VS</Text>
            <ResultSide
              label="Bot"
              emoji="🤖"
              outcome={botSeg.label}
              payout={result.botPayout}
              wager={result.wager}
              isWinner={!playerWon && !tie}
            />
          </View>

          {/* Net change summary */}
          <View style={modalStyles.netRow}>
            <Text style={modalStyles.netLabel}>Your net change</Text>
            <Text style={[modalStyles.netValue, { color: netChange >= 0 ? '#2ED573' : '#E94560' }]}>
              {netChange >= 0 ? '+' : ''}{netChange} credits
            </Text>
          </View>

          <Text style={modalStyles.disclaimer}>
            Free play only · No real money involved
          </Text>

          <TouchableOpacity style={modalStyles.btn} onPress={onClose} activeOpacity={0.85}>
            <LinearGradient colors={['#1A6B47', '#0F3460']} style={modalStyles.btnGradient}>
              <Text style={modalStyles.btnText}>Spin Again</Text>
            </LinearGradient>
          </TouchableOpacity>
        </Animated.View>
      </View>
    </Modal>
  );
}

function ResultSide({
  label, emoji, outcome, payout, wager, isWinner,
}: {
  label: string; emoji: string; outcome: string;
  payout: number; wager: number; isWinner: boolean;
}) {
  const isWin = payout > 0;
  return (
    <View style={[modalStyles.side, isWinner && modalStyles.sideWinner]}>
      <Text style={modalStyles.sideEmoji}>{emoji}</Text>
      <Text style={modalStyles.sideLabel}>{label}</Text>
      <View style={[modalStyles.sideOutcomeBox, isWin && modalStyles.sideOutcomeBoxWin]}>
        <Text style={[modalStyles.sideOutcome, isWin && modalStyles.sideOutcomeWin]}>{outcome}</Text>
      </View>
      <Text style={[modalStyles.sidePayout, { color: isWin ? '#2ED573' : '#E94560' }]}>
        {isWin ? `+${(payout - wager).toFixed(0)}` : `-${wager}`}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  gradient: { flex: 1 },
  safe:     { flex: 1 },
  scroll:   { paddingHorizontal: 20, paddingBottom: 40 },

  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 16,
  },
  backBtn:  { paddingVertical: 6, paddingRight: 12 },
  backText: { color: '#2ED573', fontSize: 15, fontWeight: '600' },

  balancePill: {
    backgroundColor: 'rgba(46,213,115,0.1)',
    borderRadius: 20,
    paddingHorizontal: 14,
    paddingVertical: 8,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: 'rgba(46,213,115,0.25)',
  },
  balancePillLabel: { color: 'rgba(255,255,255,0.4)', fontSize: 10 },
  balancePillValue: { color: '#2ED573', fontSize: 15, fontWeight: '800' },

  modeBadge: {
    backgroundColor: 'rgba(46,213,115,0.08)',
    borderRadius: 10,
    paddingVertical: 8,
    paddingHorizontal: 14,
    marginBottom: 20,
    alignSelf: 'center',
    borderWidth: 1,
    borderColor: 'rgba(46,213,115,0.2)',
  },
  modeBadgeText: { color: '#2ED573', fontSize: 12, fontWeight: '600' },

  wheelContainer: {
    alignItems: 'center',
    marginVertical: 16,
    minHeight: 320,
    justifyContent: 'center',
  },

  botRow: { alignItems: 'center', marginBottom: 10 },
  botText: { color: 'rgba(255,255,255,0.5)', fontSize: 14 },

  wagerLabel: {
    color: 'rgba(255,255,255,0.5)',
    fontSize: 12,
    fontWeight: '600',
    marginBottom: 10,
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  presets: { flexDirection: 'row', gap: 8, marginBottom: 20, flexWrap: 'wrap' },
  presetBtn: {
    flex: 1,
    minWidth: 52,
    backgroundColor: 'rgba(255,255,255,0.05)',
    borderRadius: 10,
    paddingVertical: 10,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
  },
  presetBtnActive: {
    backgroundColor: 'rgba(46,213,115,0.15)',
    borderColor: '#2ED573',
  },
  presetText:       { color: 'rgba(255,255,255,0.5)', fontSize: 14, fontWeight: '700' },
  presetTextActive: { color: '#2ED573' },

  spinBtn:         { borderRadius: 18, overflow: 'hidden', marginBottom: 24 },
  spinBtnDisabled: { opacity: 0.55 },
  spinBtnGradient: { paddingVertical: 18, alignItems: 'center' },
  spinBtnText:     { color: '#FFFFFF', fontSize: 18, fontWeight: '900', letterSpacing: 1 },

  oddsGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, justifyContent: 'center' },
  oddsItem: {
    backgroundColor: 'rgba(255,255,255,0.05)',
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 6,
    alignItems: 'center',
    minWidth: 56,
  },
  oddsLabel:  { color: 'rgba(255,255,255,0.5)', fontSize: 12, fontWeight: '600' },
  oddsChance: { color: 'rgba(255,255,255,0.3)', fontSize: 10, marginTop: 2 },
});

const modalStyles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.8)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  card: {
    width: '100%',
    backgroundColor: '#16213E',
    borderRadius: 24,
    padding: 24,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
  },
  headline: { fontSize: 22, fontWeight: '800', marginBottom: 20, textAlign: 'center' },

  vsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginBottom: 20,
    width: '100%',
  },
  vsText: { color: 'rgba(255,255,255,0.3)', fontSize: 16, fontWeight: '800' },

  side: {
    flex: 1,
    backgroundColor: 'rgba(255,255,255,0.05)',
    borderRadius: 16,
    padding: 14,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
  },
  sideWinner: {
    borderColor: '#2ED573',
    backgroundColor: 'rgba(46,213,115,0.08)',
  },
  sideEmoji:  { fontSize: 28, marginBottom: 4 },
  sideLabel:  { color: 'rgba(255,255,255,0.5)', fontSize: 11, marginBottom: 8 },
  sideOutcomeBox: {
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 6,
    marginBottom: 8,
  },
  sideOutcomeBoxWin: { backgroundColor: 'rgba(255,215,0,0.12)' },
  sideOutcome:    { color: '#FFFFFF', fontSize: 14, fontWeight: '700' },
  sideOutcomeWin: { color: '#FFD700' },
  sidePayout:     { fontSize: 15, fontWeight: '800' },

  netRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    width: '100%',
    paddingTop: 16,
    paddingBottom: 10,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255,255,255,0.07)',
  },
  netLabel: { color: 'rgba(255,255,255,0.5)', fontSize: 13 },
  netValue: { fontSize: 15, fontWeight: '800' },

  disclaimer: {
    color: 'rgba(255,255,255,0.25)',
    fontSize: 11,
    textAlign: 'center',
    marginBottom: 16,
  },

  btn:         { width: '100%', borderRadius: 14, overflow: 'hidden' },
  btnGradient: { paddingVertical: 14, alignItems: 'center' },
  btnText:     { color: '#FFFFFF', fontSize: 16, fontWeight: '700' },
});
