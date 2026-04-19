import React, { useEffect, useState, useCallback } from 'react';
import {
  View, Text, FlatList, TouchableOpacity,
  StyleSheet, ActivityIndicator, RefreshControl,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { roomsApi, type RoomInfo } from '../services/api';
import { getSocket } from '../services/socket';
import { useGameStore } from '../store/gameStore';
import type { RoomUpdatePayload } from '../services/socket';
import type { GameStackParamList } from '../navigation/AppNavigator';

const ROOM_TIERS = [5, 25, 50, 100, 200, 500, 1000, 5000, 10000];
const MIN_PLAYERS = 5;

export function RoomsScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<GameStackParamList>>();
  const { updateRoomPlayers } = useGameStore();
  const [rooms, setRooms]       = useState<RoomInfo[]>([]);
  const [loading, setLoading]   = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const fetchRooms = useCallback(async () => {
    const { data } = await roomsApi.getRooms();
    if (data) setRooms(data.rooms);
    setLoading(false);
    setRefreshing(false);
  }, []);

  useEffect(() => {
    fetchRooms();

    // Listen to live room updates from any room
    const socket = getSocket();
    const onRoomUpdate = (payload: RoomUpdatePayload) => {
      setRooms((prev) =>
        prev.map((r) =>
          r.tier === payload.tier
            ? { ...r, playerCount: payload.playerCount, isReady: payload.isReady }
            : r,
        ),
      );
      updateRoomPlayers(payload.tier, payload.players, payload.isReady);
    };
    socket.on('room:update', onRoomUpdate);
    return () => { socket.off('room:update', onRoomUpdate); };
  }, [fetchRooms, updateRoomPlayers]);

  const handleJoin = (tier: number) => {
    navigation.navigate('Game', { tier });
  };

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color="#FFD700" />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Choose a Room</Text>
      <Text style={styles.subtitle}>Need {MIN_PLAYERS} players to start spinning</Text>

      <FlatList
        data={rooms.length ? rooms : ROOM_TIERS.map((tier) => ({ tier, playerCount: 0, isReady: false }))}
        keyExtractor={(item) => String(item.tier)}
        numColumns={2}
        columnWrapperStyle={styles.row}
        contentContainerStyle={styles.list}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => { setRefreshing(true); fetchRooms(); }}
            tintColor="#FFD700"
          />
        }
        renderItem={({ item }) => {
          const pct = Math.min(item.playerCount / MIN_PLAYERS, 1);
          return (
            <TouchableOpacity
              style={[styles.card, item.isReady && styles.cardReady]}
              onPress={() => handleJoin(item.tier)}
              activeOpacity={0.8}
            >
              <Text style={styles.cardAmount}>${item.tier.toLocaleString()}</Text>
              <Text style={styles.cardLabel}>Entry Wager</Text>

              <View style={styles.progressBg}>
                <View style={[styles.progressFill, { width: `${pct * 100}%` as unknown as number }]} />
              </View>

              <Text style={styles.players}>
                {item.playerCount}/{MIN_PLAYERS} players
              </Text>
              <View style={[styles.badge, item.isReady ? styles.badgeReady : styles.badgeWaiting]}>
                <Text style={styles.badgeText}>
                  {item.isReady ? 'READY' : 'WAITING'}
                </Text>
              </View>
            </TouchableOpacity>
          );
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0D0D1A', paddingTop: 60 },
  center:    { flex: 1, backgroundColor: '#0D0D1A', justifyContent: 'center', alignItems: 'center' },
  title:     { color: '#FFD700', fontSize: 26, fontWeight: '800', textAlign: 'center', marginBottom: 4 },
  subtitle:  { color: 'rgba(255,255,255,0.4)', fontSize: 13, textAlign: 'center', marginBottom: 20 },
  list:      { paddingHorizontal: 12, paddingBottom: 20 },
  row:       { justifyContent: 'space-between', marginBottom: 12 },

  card: {
    flex: 0.48,
    backgroundColor: '#1A1A2E',
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    alignItems: 'center',
  },
  cardReady: {
    borderColor: '#FFD700',
    backgroundColor: '#1E1A0A',
  },
  cardAmount: { color: '#FFD700', fontSize: 22, fontWeight: '900', marginBottom: 2 },
  cardLabel:  { color: 'rgba(255,255,255,0.35)', fontSize: 11, marginBottom: 12 },

  progressBg: {
    width: '100%',
    height: 4,
    backgroundColor: 'rgba(255,255,255,0.1)',
    borderRadius: 2,
    marginBottom: 8,
    overflow: 'hidden',
  },
  progressFill: {
    height: 4,
    backgroundColor: '#FFD700',
    borderRadius: 2,
  },

  players: { color: 'rgba(255,255,255,0.5)', fontSize: 12, marginBottom: 10 },

  badge: {
    paddingHorizontal: 10,
    paddingVertical: 3,
    borderRadius: 8,
  },
  badgeReady:   { backgroundColor: 'rgba(46,213,115,0.15)' },
  badgeWaiting: { backgroundColor: 'rgba(255,255,255,0.05)' },
  badgeText: { color: '#fff', fontSize: 10, fontWeight: '700', letterSpacing: 1 },
});
