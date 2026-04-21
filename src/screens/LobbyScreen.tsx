import React, { useEffect, useRef } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity,
  ScrollView, Animated,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useAuthStore } from '../store/authStore';
import { useGameStore } from '../store/gameStore';
import type { GameStackParamList } from '../navigation/AppNavigator';

type Nav = NativeStackNavigationProp<GameStackParamList>;

export function LobbyScreen() {
  const navigation = useNavigation<Nav>();
  const { user } = useAuthStore();
  const { jackpotHistory } = useGameStore();

  const pulseAnim = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, { toValue: 1.06, duration: 900, useNativeDriver: true }),
        Animated.timing(pulseAnim, { toValue: 1,    duration: 900, useNativeDriver: true }),
      ]),
    ).start();
  }, []);

  const lastJackpot = jackpotHistory[0];

  return (
    <LinearGradient colors={['#0D0D1A', '#16213E', '#0D0D1A']} style={styles.gradient}>
      <SafeAreaView style={styles.safe}>
        <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>

          {/* Header */}
          <View style={styles.header}>
            <View>
              <Text style={styles.greeting}>Welcome back,</Text>
              <Text style={styles.username}>{user?.username ?? 'Player'}</Text>
            </View>
            <View style={styles.balancePill}>
              <Text style={styles.balanceLabel}>Balance</Text>
              <Text style={styles.balanceValue}>${(user?.balanceUsd ?? 0).toFixed(2)}</Text>
            </View>
          </View>

          {/* Live jackpot ticker */}
          {lastJackpot && (
            <View style={styles.ticker}>
              <Text style={styles.tickerText}>
                🎉 {lastJackpot.username} just hit {lastJackpot.outcomeLabel} — ${lastJackpot.payoutUsd.toFixed(2)}!
              </Text>
            </View>
          )}

          {/* Title */}
          <Text style={styles.title}>Spin & Win</Text>
          <Text style={styles.subtitle}>Choose your game mode</Text>

          {/* Try Spin card */}
          <Animated.View style={{ transform: [{ scale: pulseAnim }] }}>
            <TouchableOpacity
              style={styles.tryCard}
              onPress={() => navigation.navigate('TrySpin')}
              activeOpacity={0.85}
            >
              <LinearGradient
                colors={['#0F3460', '#1A6B47']}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={styles.tryCardInner}
              >
                <Text style={styles.tryCardEmoji}>🎯</Text>
                <View style={styles.tryCardText}>
                  <View style={styles.freeBadge}>
                    <Text style={styles.freeBadgeText}>FREE</Text>
                  </View>
                  <Text style={styles.tryCardTitle}>Try Spin</Text>
                  <Text style={styles.tryCardSub}>Play vs a bot · No real money · Practice the wheel</Text>
                </View>
                <Text style={styles.arrow}>→</Text>
              </LinearGradient>
            </TouchableOpacity>
          </Animated.View>

          {/* Rooms card */}
          <TouchableOpacity
            style={styles.roomsCard}
            onPress={() => navigation.navigate('Rooms')}
            activeOpacity={0.85}
          >
            <LinearGradient
              colors={['#3D1C00', '#7A3B00']}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={styles.roomsCardInner}
            >
              <Text style={styles.roomsCardEmoji}>🏆</Text>
              <View style={styles.roomsCardText}>
                <View style={styles.liveBadge}>
                  <View style={styles.liveDot} />
                  <Text style={styles.liveBadgeText}>LIVE</Text>
                </View>
                <Text style={styles.roomsCardTitle}>Multiplayer Rooms</Text>
                <Text style={styles.roomsCardSub}>9 tiers · $5 to $10,000 · 5-player minimum</Text>
              </View>
              <Text style={styles.arrow}>→</Text>
            </LinearGradient>
          </TouchableOpacity>

          {/* Info grid */}
          <View style={styles.infoGrid}>
            <InfoBox emoji="🎰" label="Wheel Segments" value="12" />
            <InfoBox emoji="💰" label="Max Jackpot" value="50×" />
            <InfoBox emoji="🔒" label="Provably Fair" value="Yes" />
            <InfoBox emoji="⚡" label="Instant Payout" value="Yes" />
          </View>

        </ScrollView>
      </SafeAreaView>
    </LinearGradient>
  );
}

function InfoBox({ emoji, label, value }: { emoji: string; label: string; value: string }) {
  return (
    <View style={styles.infoBox}>
      <Text style={styles.infoEmoji}>{emoji}</Text>
      <Text style={styles.infoValue}>{value}</Text>
      <Text style={styles.infoLabel}>{label}</Text>
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
    alignItems: 'flex-start',
    paddingTop: 20,
    paddingBottom: 16,
  },
  greeting: { color: 'rgba(255,255,255,0.45)', fontSize: 13 },
  username: { color: '#FFD700', fontSize: 20, fontWeight: '800', marginTop: 2 },

  balancePill: {
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderRadius: 14,
    paddingHorizontal: 16,
    paddingVertical: 10,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255,215,0,0.2)',
  },
  balanceLabel: { color: 'rgba(255,255,255,0.4)', fontSize: 11 },
  balanceValue: { color: '#FFD700', fontSize: 16, fontWeight: '800' },

  ticker: {
    backgroundColor: 'rgba(255,215,0,0.1)',
    borderRadius: 10,
    paddingVertical: 8,
    paddingHorizontal: 14,
    marginBottom: 20,
    borderWidth: 1,
    borderColor: 'rgba(255,215,0,0.2)',
  },
  tickerText: { color: '#FFD700', fontSize: 12, fontWeight: '600', textAlign: 'center' },

  title:    { color: '#FFFFFF', fontSize: 32, fontWeight: '900', textAlign: 'center', marginBottom: 4 },
  subtitle: { color: 'rgba(255,255,255,0.4)', fontSize: 14, textAlign: 'center', marginBottom: 28 },

  // Try Spin card
  tryCard:      { borderRadius: 20, overflow: 'hidden', marginBottom: 16 },
  tryCardInner: { padding: 24, flexDirection: 'row', alignItems: 'center', gap: 16 },
  tryCardEmoji: { fontSize: 40 },
  tryCardText:  { flex: 1 },
  tryCardTitle: { color: '#FFFFFF', fontSize: 22, fontWeight: '800', marginTop: 4 },
  tryCardSub:   { color: 'rgba(255,255,255,0.6)', fontSize: 12, marginTop: 4 },

  freeBadge: {
    alignSelf: 'flex-start',
    backgroundColor: 'rgba(46,213,115,0.25)',
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  freeBadgeText: { color: '#2ED573', fontSize: 10, fontWeight: '800', letterSpacing: 1 },

  // Rooms card
  roomsCard:      { borderRadius: 20, overflow: 'hidden', marginBottom: 28 },
  roomsCardInner: { padding: 24, flexDirection: 'row', alignItems: 'center', gap: 16 },
  roomsCardEmoji: { fontSize: 40 },
  roomsCardText:  { flex: 1 },
  roomsCardTitle: { color: '#FFFFFF', fontSize: 22, fontWeight: '800', marginTop: 4 },
  roomsCardSub:   { color: 'rgba(255,255,255,0.6)', fontSize: 12, marginTop: 4 },

  liveBadge: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: 'rgba(233,69,96,0.2)',
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  liveDot:      { width: 6, height: 6, borderRadius: 3, backgroundColor: '#E94560' },
  liveBadgeText: { color: '#E94560', fontSize: 10, fontWeight: '800', letterSpacing: 1 },

  arrow: { color: 'rgba(255,255,255,0.5)', fontSize: 24, fontWeight: '300' },

  // Info grid
  infoGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  infoBox: {
    flex: 1,
    minWidth: '45%',
    backgroundColor: 'rgba(255,255,255,0.05)',
    borderRadius: 14,
    padding: 16,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.07)',
  },
  infoEmoji: { fontSize: 22, marginBottom: 6 },
  infoValue: { color: '#FFD700', fontSize: 16, fontWeight: '800' },
  infoLabel: { color: 'rgba(255,255,255,0.4)', fontSize: 11, marginTop: 2, textAlign: 'center' },
});
