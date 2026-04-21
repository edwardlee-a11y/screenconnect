import React, { useState, useCallback } from 'react';
import {
  View, Text, StyleSheet, TextInput, TouchableOpacity,
  FlatList, ActivityIndicator, Alert, ScrollView, RefreshControl,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { adminApi, type AdminStats, type AdminUser } from '../services/api';

export function AdminDashboardScreen() {
  const navigation = useNavigation();

  const [secret,       setSecret]       = useState('');
  const [authed,       setAuthed]        = useState(false);
  const [loading,      setLoading]       = useState(false);
  const [refreshing,   setRefreshing]    = useState(false);
  const [stats,        setStats]         = useState<AdminStats | null>(null);
  const [users,        setUsers]         = useState<AdminUser[]>([]);
  const [search,       setSearch]        = useState('');
  const [page,         setPage]          = useState(1);
  const [totalPages,   setTotalPages]    = useState(1);
  const [totalUsers,   setTotalUsers]    = useState(0);
  const [activeSecret, setActiveSecret] = useState('');

  const load = useCallback(async (sec: string, pg: number, q: string) => {
    const [statsRes, usersRes] = await Promise.all([
      adminApi.getStats(sec),
      adminApi.getUsers(sec, pg, q),
    ]);

    if (statsRes.error || usersRes.error) {
      Alert.alert('Access Denied', statsRes.error ?? usersRes.error ?? 'Invalid secret.');
      return false;
    }

    if (statsRes.data)  setStats(statsRes.data);
    if (usersRes.data) {
      setUsers(usersRes.data.users);
      setTotalPages(usersRes.data.pagination.totalPages);
      setTotalUsers(usersRes.data.pagination.total);
    }
    return true;
  }, []);

  const handleAccess = async () => {
    const sec = secret.trim();
    if (!sec) return;
    setLoading(true);
    const ok = await load(sec, 1, '');
    setLoading(false);
    if (ok) {
      setActiveSecret(sec);
      setAuthed(true);
      setPage(1);
    }
  };

  const handleRefresh = async () => {
    setRefreshing(true);
    await load(activeSecret, page, search);
    setRefreshing(false);
  };

  const handleSearch = async (q: string) => {
    setSearch(q);
    setPage(1);
    await load(activeSecret, 1, q);
  };

  const handlePage = async (next: number) => {
    setPage(next);
    await load(activeSecret, next, search);
  };

  const handleBan = (user: AdminUser) => {
    const action = user.is_banned ? 'Unban' : 'Ban';
    Alert.alert(`${action} ${user.username}?`, undefined, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: action,
        style: user.is_banned ? 'default' : 'destructive',
        onPress: async () => {
          const { error } = await adminApi.banUser(activeSecret, user.id, !user.is_banned);
          if (error) { Alert.alert('Error', error); return; }
          await load(activeSecret, page, search);
        },
      },
    ]);
  };

  // ── Login gate ─────────────────────────────────────────────────────────────
  if (!authed) {
    return (
      <View style={styles.gate}>
        <SafeAreaView>
          <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
            <Text style={styles.backText}>← Back</Text>
          </TouchableOpacity>
          <Text style={styles.gateTitle}>Admin Dashboard</Text>
          <Text style={styles.gateSubtitle}>Enter your admin secret to continue</Text>
          <TextInput
            style={styles.secretInput}
            placeholder="Admin secret"
            placeholderTextColor="rgba(255,255,255,0.3)"
            secureTextEntry
            value={secret}
            onChangeText={setSecret}
            autoCapitalize="none"
          />
          <TouchableOpacity
            style={[styles.accessBtn, loading && styles.btnDisabled]}
            onPress={handleAccess}
            disabled={loading}
          >
            {loading
              ? <ActivityIndicator color="#0D0D1A" />
              : <Text style={styles.accessBtnText}>Access Dashboard</Text>}
          </TouchableOpacity>
        </SafeAreaView>
      </View>
    );
  }

  // ── Dashboard ──────────────────────────────────────────────────────────────
  return (
    <View style={styles.container}>
      <SafeAreaView style={{ flex: 1 }}>
        {/* Header */}
        <View style={styles.header}>
          <TouchableOpacity onPress={() => navigation.goBack()}>
            <Text style={styles.backText}>← Back</Text>
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Admin Dashboard</Text>
          <TouchableOpacity onPress={handleRefresh}>
            <Text style={styles.refreshText}>↻</Text>
          </TouchableOpacity>
        </View>

        <FlatList
          data={users}
          keyExtractor={(u) => u.id}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={handleRefresh} tintColor="#FFD700" />
          }
          ListHeaderComponent={
            <>
              {/* Stats cards */}
              {stats && (
                <View style={styles.statsGrid}>
                  <StatCard label="Total Users"    value={stats.platform.totalUsers.toLocaleString()} color="#FFD700" />
                  <StatCard label="Total Spins"    value={stats.platform.totalSpins.toLocaleString()} color="#00D4FF" />
                  <StatCard label="Total Deposits" value={`$${stats.platform.totalDepositsUsd.toFixed(2)}`}    color="#2ECC71" />
                  <StatCard label="Withdrawals"    value={`$${stats.platform.totalWithdrawalsUsd.toFixed(2)}`} color="#E74C3C" />
                  {stats.blockchain.hotWallet && (
                    <StatCard label="Hot Wallet" value={`$${stats.blockchain.hotWallet.balanceUsd.toFixed(2)}`} color="#9B59B6" />
                  )}
                  {stats.blockchain.prizePool && (
                    <StatCard label="Prize Pool" value={`$${stats.blockchain.prizePool.balanceUsd.toFixed(2)}`} color="#F39C12" />
                  )}
                </View>
              )}

              {/* Search + count */}
              <View style={styles.searchRow}>
                <TextInput
                  style={styles.searchInput}
                  placeholder="Search username or email…"
                  placeholderTextColor="rgba(255,255,255,0.3)"
                  value={search}
                  onChangeText={handleSearch}
                  autoCapitalize="none"
                  returnKeyType="search"
                />
              </View>
              <Text style={styles.countText}>{totalUsers.toLocaleString()} users</Text>

              {/* Table header */}
              <View style={styles.tableHeader}>
                <Text style={[styles.col, styles.colUser]}>User</Text>
                <Text style={[styles.col, styles.colBalance]}>Balance</Text>
                <Text style={[styles.col, styles.colSpins]}>Spins</Text>
                <Text style={[styles.col, styles.colStatus]}>Status</Text>
              </View>
            </>
          }
          renderItem={({ item }) => (
            <TouchableOpacity
              style={[styles.tableRow, item.is_banned && styles.tableRowBanned]}
              onLongPress={() => handleBan(item)}
              activeOpacity={0.7}
            >
              <View style={styles.colUser}>
                <Text style={styles.username}>{item.username}</Text>
                <Text style={styles.email} numberOfLines={1}>{item.email}</Text>
              </View>
              <Text style={[styles.col, styles.colBalance, styles.balanceText]}>
                ${item.balance_usd.toFixed(2)}
              </Text>
              <Text style={[styles.col, styles.colSpins, styles.mutedText]}>
                {item.total_spins}
              </Text>
              <View style={styles.colStatus}>
                {item.is_banned && <View style={styles.tagBanned}><Text style={styles.tagText}>BANNED</Text></View>}
                {item.kyc_verified && <View style={styles.tagKyc}><Text style={styles.tagText}>KYC</Text></View>}
                {!item.is_banned && !item.kyc_verified && <Text style={styles.mutedText}>—</Text>}
              </View>
            </TouchableOpacity>
          )}
          ListFooterComponent={
            totalPages > 1 ? (
              <View style={styles.pagination}>
                <TouchableOpacity
                  style={[styles.pageBtn, page <= 1 && styles.pageBtnDisabled]}
                  onPress={() => page > 1 && handlePage(page - 1)}
                  disabled={page <= 1}
                >
                  <Text style={styles.pageBtnText}>‹ Prev</Text>
                </TouchableOpacity>
                <Text style={styles.pageIndicator}>
                  {page} / {totalPages}
                </Text>
                <TouchableOpacity
                  style={[styles.pageBtn, page >= totalPages && styles.pageBtnDisabled]}
                  onPress={() => page < totalPages && handlePage(page + 1)}
                  disabled={page >= totalPages}
                >
                  <Text style={styles.pageBtnText}>Next ›</Text>
                </TouchableOpacity>
              </View>
            ) : null
          }
          ListEmptyComponent={
            <Text style={styles.emptyText}>No users found.</Text>
          }
        />
      </SafeAreaView>
    </View>
  );
}

function StatCard({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <View style={[styles.statCard, { borderColor: color + '44' }]}>
      <Text style={[styles.statValue, { color }]}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0D0D1A' },

  // ── Login gate ─────────────────────────────────────────────────────────────
  gate: { flex: 1, backgroundColor: '#0D0D1A', padding: 24, justifyContent: 'center' },
  gateTitle:    { color: '#FFD700', fontSize: 26, fontWeight: '800', marginBottom: 8, textAlign: 'center' },
  gateSubtitle: { color: 'rgba(255,255,255,0.4)', fontSize: 14, textAlign: 'center', marginBottom: 32 },
  secretInput: {
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderRadius: 12,
    color: '#fff',
    fontSize: 15,
    paddingHorizontal: 16,
    paddingVertical: 14,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
  },
  accessBtn: {
    backgroundColor: '#FFD700',
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
  },
  accessBtnText: { color: '#0D0D1A', fontWeight: '800', fontSize: 16 },
  btnDisabled:   { opacity: 0.5 },

  // ── Header ──────────────────────────────────────────────────────────────────
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.06)',
  },
  backBtn:     { padding: 4 },
  backText:    { color: '#FFD700', fontSize: 14, fontWeight: '600' },
  headerTitle: { color: '#fff', fontSize: 16, fontWeight: '800' },
  refreshText: { color: '#FFD700', fontSize: 22, fontWeight: '400' },

  // ── Stats ───────────────────────────────────────────────────────────────────
  statsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    paddingHorizontal: 12,
    paddingTop: 16,
    gap: 10,
  },
  statCard: {
    flex: 1,
    minWidth: '28%',
    backgroundColor: '#1A1A2E',
    borderRadius: 12,
    padding: 14,
    borderWidth: 1,
    alignItems: 'center',
  },
  statValue: { fontSize: 18, fontWeight: '800', marginBottom: 4 },
  statLabel: { color: 'rgba(255,255,255,0.4)', fontSize: 11, textAlign: 'center' },

  // ── Search ──────────────────────────────────────────────────────────────────
  searchRow: { paddingHorizontal: 12, paddingTop: 20, paddingBottom: 4 },
  searchInput: {
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderRadius: 10,
    color: '#fff',
    fontSize: 14,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
  },
  countText: { color: 'rgba(255,255,255,0.3)', fontSize: 11, paddingHorizontal: 14, paddingBottom: 8 },

  // ── Table ───────────────────────────────────────────────────────────────────
  tableHeader: {
    flexDirection: 'row',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.08)',
    backgroundColor: 'rgba(255,255,255,0.03)',
  },
  tableRow: {
    flexDirection: 'row',
    paddingHorizontal: 12,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.04)',
    alignItems: 'center',
  },
  tableRowBanned: { backgroundColor: 'rgba(231,76,60,0.06)' },

  col:       { color: 'rgba(255,255,255,0.5)', fontSize: 11, fontWeight: '600', textTransform: 'uppercase' },
  colUser:   { flex: 2 },
  colBalance:{ flex: 1, textAlign: 'right' },
  colSpins:  { flex: 0.8, textAlign: 'center' },
  colStatus: { flex: 1, flexDirection: 'row', justifyContent: 'flex-end', gap: 4, alignItems: 'center' },

  username:    { color: '#fff', fontSize: 13, fontWeight: '700' },
  email:       { color: 'rgba(255,255,255,0.35)', fontSize: 11 },
  balanceText: { color: '#2ECC71', fontWeight: '700', fontSize: 13 },
  mutedText:   { color: 'rgba(255,255,255,0.3)', fontSize: 12 },

  tagBanned: { backgroundColor: 'rgba(231,76,60,0.25)', borderRadius: 4, paddingHorizontal: 5, paddingVertical: 2 },
  tagKyc:    { backgroundColor: 'rgba(46,204,113,0.2)',  borderRadius: 4, paddingHorizontal: 5, paddingVertical: 2 },
  tagText:   { color: '#fff', fontSize: 9, fontWeight: '800', letterSpacing: 0.5 },

  // ── Pagination ──────────────────────────────────────────────────────────────
  pagination: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
    gap: 20,
  },
  pageBtn:         { backgroundColor: 'rgba(255,255,255,0.08)', borderRadius: 8, paddingHorizontal: 16, paddingVertical: 8 },
  pageBtnDisabled: { opacity: 0.3 },
  pageBtnText:     { color: '#fff', fontWeight: '600' },
  pageIndicator:   { color: 'rgba(255,255,255,0.4)', fontSize: 13 },

  emptyText: { color: 'rgba(255,255,255,0.3)', textAlign: 'center', padding: 32 },
});
