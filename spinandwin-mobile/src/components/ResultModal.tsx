import React, { useEffect } from 'react';
import {
  Modal,
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Dimensions,
} from 'react-native';
import Animated, {
  useSharedValue,
  withSpring,
  withSequence,
  withTiming,
  useAnimatedStyle,
} from 'react-native-reanimated';
import type { SpinResult } from '../services/api';

const { width } = Dimensions.get('window');

interface ResultModalProps {
  visible: boolean;
  result: SpinResult | null;
  onClose: () => void;
}

export function ResultModal({ visible, result, onClose }: ResultModalProps) {
  const scale   = useSharedValue(0);
  const opacity = useSharedValue(0);

  useEffect(() => {
    if (visible) {
      scale.value   = withSpring(1, { damping: 12, stiffness: 180 });
      opacity.value = withTiming(1, { duration: 200 });
    } else {
      scale.value   = withTiming(0, { duration: 150 });
      opacity.value = withTiming(0, { duration: 150 });
    }
  }, [visible]);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
    opacity: opacity.value,
  }));

  if (!result) return null;

  const isWin     = result.multiplier > 0;
  const isJackpot = result.outcomeLabel === 'JACKPOT';

  const titleText  = isJackpot ? '🎰 JACKPOT!' : isWin ? '🎉 You Won!' : '😔 Better luck next time';
  const titleColor = isJackpot ? '#FFD700' : isWin ? '#7ED321' : '#E94560';

  return (
    <Modal transparent visible={visible} animationType="fade" onRequestClose={onClose}>
      <View style={styles.overlay}>
        <Animated.View style={[styles.card, animatedStyle]}>
          <Text style={[styles.title, { color: titleColor }]}>{titleText}</Text>

          <View style={styles.outcomeBox}>
            <Text style={styles.outcomeLabel}>{result.outcomeLabel}</Text>
            {result.multiplier > 0 && (
              <Text style={styles.multiplierText}>{result.multiplier}×</Text>
            )}
          </View>

          <View style={styles.statsRow}>
            <StatBox label="Wager"  value={`$${result.wagerUsd.toFixed(2)}`}  />
            <StatBox label="Payout" value={`$${result.payoutUsd.toFixed(2)}`} color={isWin ? '#7ED321' : '#E94560'} />
          </View>

          <View style={styles.balanceLine}>
            <Text style={styles.balanceLabel}>New Balance</Text>
            <Text style={styles.balanceValue}>${result.newBalanceUsd.toFixed(2)}</Text>
          </View>

          <TouchableOpacity style={styles.closeBtn} onPress={onClose} activeOpacity={0.8}>
            <Text style={styles.closeBtnText}>Spin Again</Text>
          </TouchableOpacity>
        </Animated.View>
      </View>
    </Modal>
  );
}

function StatBox({ label, value, color = '#FFFFFF' }: { label: string; value: string; color?: string }) {
  return (
    <View style={styles.statBox}>
      <Text style={styles.statLabel}>{label}</Text>
      <Text style={[styles.statValue, { color }]}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.75)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  card: {
    width: width - 48,
    backgroundColor: '#16213E',
    borderRadius: 24,
    padding: 28,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
  },
  title: {
    fontSize: 26,
    fontWeight: '800',
    marginBottom: 16,
    textAlign: 'center',
  },
  outcomeBox: {
    backgroundColor: 'rgba(255,255,255,0.05)',
    borderRadius: 16,
    paddingVertical: 16,
    paddingHorizontal: 32,
    alignItems: 'center',
    marginBottom: 20,
    minWidth: 140,
  },
  outcomeLabel: {
    color: '#FFFFFF',
    fontSize: 22,
    fontWeight: '700',
  },
  multiplierText: {
    color: '#FFD700',
    fontSize: 16,
    fontWeight: '600',
    marginTop: 4,
  },
  statsRow: {
    flexDirection: 'row',
    gap: 12,
    marginBottom: 16,
  },
  statBox: {
    flex: 1,
    backgroundColor: 'rgba(255,255,255,0.05)',
    borderRadius: 12,
    padding: 12,
    alignItems: 'center',
  },
  statLabel: {
    color: 'rgba(255,255,255,0.5)',
    fontSize: 12,
    marginBottom: 4,
  },
  statValue: {
    fontSize: 18,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  balanceLine: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    width: '100%',
    paddingTop: 16,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255,255,255,0.08)',
    marginBottom: 24,
  },
  balanceLabel: {
    color: 'rgba(255,255,255,0.5)',
    fontSize: 14,
  },
  balanceValue: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '700',
  },
  closeBtn: {
    backgroundColor: '#E94560',
    borderRadius: 14,
    paddingVertical: 14,
    paddingHorizontal: 40,
    width: '100%',
    alignItems: 'center',
  },
  closeBtnText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '700',
  },
});
