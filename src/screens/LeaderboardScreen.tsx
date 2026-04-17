import React, { useEffect, useState } from 'react';
import {
  View, Text, StyleSheet, FlatList,
  ActivityIndicator, RefreshControl,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { gameApi } from '../services/api';
import { useGameStore } from '../store/gameStore';
import type { LeaderboardEntry } from '../services/api';

const MEDAL: Record<number, string> = { 1: '🥇', 2: '🥈', 3: '🥉' };

export function LeaderboardScreen() {
  const liveLeaderboard = useGameStore((s) => s.liveLeaderboard);
  const [entries,    setEntries]    = useState<LeaderboardEntry[]>([]);
  const [loading,    setLoading]    = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  // Merge live socket updates into the displayed list
  const displayedEntries: LeaderboardEntry[] = liveLeaderboard.length > 0
    ? liveLeaderboard.map((e, i) => ({ ...e, rank: i + 1 }))
    : entries;

  const fetchLeaderboard = async () => {
    const { data } = await gameApi.getLeaderboard();
    if (data) setEntries(data.leaderboard);
    setLoading(false);
    setRefreshing(false);
  };

  useEffect(() => { fetchLeaderboard(); }, []);

  const renderItem = ({ item }: { item: LeaderboardEntry }) => (
    <View style={[styles.row, item.rank <= 3 && styles.topRow]}>
      <Text style={styles.rank}>{MEDAL[item.rank] ?? `#${item.rank}`}</Text>
      <Text style={styles.username}>{item.username}</Text>
      <Text style={styles.payout}>${item.payoutUsd?.toFixed(2)}</Text>
    </View>
  );

  return (
    <LinearGradient colors={['#0D0D1A', '#16213E', '#0D0D1A']} style={{ flex: 1 }}>
      <SafeAreaView style={{ flex: 1 }}>
        <Text style={styles.heading}>Daily Leaders</Text>
        <Text style={styles.subtitle}>Resets at midnight UTC</Text>
        {loading ? (
          <ActivityIndicator size="large" color="#FFD700" style={{ marginTop: 60 }} />
        ) : (
          <FlatList
            data={displayedEntries}
            keyExtractor={(_, i) => i.toString()}
            renderItem={renderItem}
            contentContainerStyle={styles.list}
            refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); fetchLeaderboard(); }} tintColor="#FFD700" />}
            ListEmptyComponent={<Text style={styles.empty}>No entries yet today.</Text>}
            ItemSeparatorComponent={() => <View style={{ height: 8 }} />}
          />
        )}
      </SafeAreaView>
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  heading:  { color: '#FFD700', fontSize: 24, fontWeight: '800', padding: 20, paddingBottom: 4 },
  subtitle: { color: 'rgba(255,255,255,0.3)', fontSize: 12, paddingHorizontal: 20, marginBottom: 16 },
  list:     { paddingHorizontal: 20, paddingBottom: 40 },
  row: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.04)',
    borderRadius: 12, padding: 14, gap: 12,
  },
  topRow:    { borderColor: 'rgba(255,215,0,0.2)', borderWidth: 1 },
  rank:      { fontSize: 20, width: 36 },
  username:  { flex: 1, color: '#FFFFFF', fontWeight: '600', fontSize: 15 },
  payout:    { color: '#7ED321', fontWeight: '800', fontSize: 15 },
  empty:     { color: 'rgba(255,255,255,0.3)', textAlign: 'center', marginTop: 60, fontSize: 15 },
});
