import React, { useEffect, useState, useCallback } from 'react';
import {
  View, Text, StyleSheet, FlatList,
  ActivityIndicator, RefreshControl,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { gameApi } from '../services/api';
import type { SpinResult } from '../services/api';

export function HistoryScreen() {
  const [spins,      setSpins]      = useState<SpinResult[]>([]);
  const [loading,    setLoading]    = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [page,       setPage]       = useState(1);
  const [totalPages, setTotalPages] = useState(1);

  const fetchHistory = useCallback(async (p = 1, reset = false) => {
    if (p === 1) setLoading(true);
    const { data } = await gameApi.getHistory(p, 20);
    if (data) {
      setSpins(prev => reset ? (data.spins as unknown as SpinResult[]) : [...prev, ...(data.spins as unknown as SpinResult[])]);
      setTotalPages(data.pagination.totalPages);
      setPage(p);
    }
    setLoading(false);
    setRefreshing(false);
  }, []);

  useEffect(() => { fetchHistory(1, true); }, []);

  const onRefresh = () => { setRefreshing(true); fetchHistory(1, true); };
  const onEndReached = () => { if (page < totalPages) fetchHistory(page + 1); };

  const renderItem = ({ item }: { item: SpinResult }) => {
    const isWin = item.multiplier > 0;
    return (
      <View style={styles.row}>
        <View style={styles.rowLeft}>
          <Text style={[styles.outcomeLabel, isWin ? styles.win : styles.lose]}>
            {item.outcomeLabel}
          </Text>
          <Text style={styles.nonce}>Spin #{item.nonce}</Text>
        </View>
        <View style={styles.rowRight}>
          <Text style={[styles.payout, isWin ? styles.win : styles.lose]}>
            {isWin ? '+' : ''}{item.netChangeUsd?.toFixed(2) ?? '0.00'}
          </Text>
          <Text style={styles.wager}>Wager: ${item.wagerUsd?.toFixed(2)}</Text>
        </View>
      </View>
    );
  };

  return (
    <LinearGradient colors={['#0D0D1A', '#16213E', '#0D0D1A']} style={{ flex: 1 }}>
      <SafeAreaView style={{ flex: 1 }}>
        <Text style={styles.heading}>Spin History</Text>
        {loading && page === 1 ? (
          <ActivityIndicator size="large" color="#FFD700" style={{ marginTop: 60 }} />
        ) : (
          <FlatList
            data={spins}
            keyExtractor={(_, i) => i.toString()}
            renderItem={renderItem}
            contentContainerStyle={styles.list}
            refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#FFD700" />}
            onEndReached={onEndReached}
            onEndReachedThreshold={0.3}
            ItemSeparatorComponent={() => <View style={styles.separator} />}
            ListEmptyComponent={<Text style={styles.empty}>No spins yet. Start playing!</Text>}
          />
        )}
      </SafeAreaView>
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  heading: { color: '#FFD700', fontSize: 24, fontWeight: '800', padding: 20, paddingBottom: 12 },
  list:    { paddingHorizontal: 20, paddingBottom: 40 },
  row: {
    flexDirection: 'row', justifyContent: 'space-between',
    backgroundColor: 'rgba(255,255,255,0.04)', borderRadius: 12, padding: 14,
  },
  rowLeft:  { gap: 4 },
  rowRight: { alignItems: 'flex-end', gap: 4 },
  outcomeLabel: { fontSize: 16, fontWeight: '700' },
  nonce:   { color: 'rgba(255,255,255,0.3)', fontSize: 12 },
  payout:  { fontSize: 16, fontWeight: '700' },
  wager:   { color: 'rgba(255,255,255,0.3)', fontSize: 12 },
  win:     { color: '#7ED321' },
  lose:    { color: '#E94560' },
  separator:  { height: 8 },
  empty: { color: 'rgba(255,255,255,0.3)', textAlign: 'center', marginTop: 60, fontSize: 15 },
});
