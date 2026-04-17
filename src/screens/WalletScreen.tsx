import React, { useEffect, useRef, useState } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity,
  TextInput, Alert, ActivityIndicator, ScrollView, Linking,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { useWalletConnectModal } from '@walletconnect/modal-react-native';
import { walletApi } from '../services/api';
import { useAuthStore } from '../store/authStore';

const MIN_WITHDRAWAL = 1.00;

export function WalletScreen() {
  const { user, updateUser } = useAuthStore();
  const { open, isConnected, address, provider } = useWalletConnectModal();

  const [loading,         setLoading]         = useState(false);
  const [connecting,      setConnecting]       = useState(false);
  const [withdrawAmount,  setWithdrawAmount]   = useState('');
  const [lastTxHash,      setLastTxHash]       = useState<string | null>(null);
  const [lastTxUrl,       setLastTxUrl]        = useState<string | null>(null);

  // Track previous connection state to detect new connections
  const wasConnected = useRef(false);

  useEffect(() => {
    refreshBalance();
  }, []);

  // When WalletConnect reports a newly connected wallet, sign and link it
  useEffect(() => {
    if (isConnected && address && !wasConnected.current) {
      wasConnected.current = true;
      handleWalletConnected(address);
    }
    if (!isConnected) {
      wasConnected.current = false;
    }
  }, [isConnected, address]);

  const refreshBalance = async () => {
    const { data } = await walletApi.getBalance();
    if (data) {
      updateUser({
        balanceUsd:    data.inApp.balanceUsd,
        balanceSpin:   data.inApp.balanceSpin,
        walletAddress: data.walletAddress,
      });
    }
  };

  const handleConnectWallet = async () => {
    setConnecting(true);
    try {
      await open();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to open wallet modal';
      Alert.alert('Error', msg);
    } finally {
      setConnecting(false);
    }
  };

  const handleWalletConnected = async (walletAddress: string) => {
    if (!provider) return;

    setLoading(true);
    try {
      // 1. Fetch nonce + message to sign from the backend
      const { data: nonceData, error: nonceError } = await walletApi.getNonce(walletAddress);
      if (nonceError || !nonceData) {
        Alert.alert('Error', nonceError ?? 'Failed to get nonce');
        return;
      }

      // 2. Ask the wallet to sign the message
      const signature = await provider.request({
        method: 'personal_sign',
        params: [nonceData.message, walletAddress],
      }) as string;

      // 3. Send address + signature to the backend for verification
      const { data: connectData, error: connectError } = await walletApi.connect(
        walletAddress,
        signature,
      );

      if (connectError) {
        Alert.alert('Connection Failed', connectError);
        return;
      }

      if (connectData) {
        updateUser({ walletAddress: connectData.address });
        Alert.alert('Wallet Connected', `${connectData.address.slice(0, 6)}...${connectData.address.slice(-4)} linked to your account.`);
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'An error occurred';
      Alert.alert('Error', msg);
    } finally {
      setLoading(false);
    }
  };

  const handleDisconnectWallet = async () => {
    const { error } = await walletApi.disconnect();
    if (!error) updateUser({ walletAddress: null });
  };

  const handleWithdraw = async () => {
    const amount = parseFloat(withdrawAmount);
    if (isNaN(amount) || amount < MIN_WITHDRAWAL) {
      Alert.alert('Invalid Amount', `Minimum withdrawal is $${MIN_WITHDRAWAL.toFixed(2)}.`);
      return;
    }
    if (amount > (user?.balanceUsd ?? 0)) {
      Alert.alert('Insufficient Balance', `You only have $${(user?.balanceUsd ?? 0).toFixed(2)}.`);
      return;
    }
    if (!user?.walletAddress) {
      Alert.alert('No Wallet', 'Connect a wallet before withdrawing.');
      return;
    }

    Alert.alert(
      'Confirm Withdrawal',
      `Withdraw $${amount.toFixed(2)} to ${user.walletAddress.slice(0, 6)}...${user.walletAddress.slice(-4)}?\n\nA 2% network fee applies.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Confirm',
          onPress: async () => {
            setLoading(true);
            const { data, error } = await walletApi.withdraw(amount);
            setLoading(false);

            if (error) {
              Alert.alert('Withdrawal Failed', error);
              return;
            }
            if (data) {
              setLastTxHash(data.txHash);
              setLastTxUrl(data.polygonscanUrl);
              setWithdrawAmount('');
              await refreshBalance();
              Alert.alert('Success!', `$${data.netAmountUsd.toFixed(2)} sent to your wallet.`);
            }
          },
        },
      ],
    );
  };

  return (
    <LinearGradient colors={['#0D0D1A', '#16213E', '#0D0D1A']} style={{ flex: 1 }}>
      <SafeAreaView style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={styles.scroll}>
          <Text style={styles.heading}>Wallet</Text>

          {/* Balance cards */}
          <View style={styles.cardsRow}>
            <View style={styles.balanceCard}>
              <Text style={styles.cardLabel}>USD Balance</Text>
              <Text style={styles.cardValue}>${(user?.balanceUsd ?? 0).toFixed(2)}</Text>
            </View>
            <View style={styles.balanceCard}>
              <Text style={styles.cardLabel}>SPIN Tokens</Text>
              <Text style={styles.cardValue}>{(user?.balanceSpin ?? 0).toFixed(4)}</Text>
            </View>
          </View>

          {/* Connected wallet */}
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Connected Wallet</Text>
            {user?.walletAddress ? (
              <View style={styles.addressBox}>
                <Text style={styles.address}>
                  {user.walletAddress.slice(0, 8)}...{user.walletAddress.slice(-6)}
                </Text>
                <TouchableOpacity onPress={handleDisconnectWallet}>
                  <Text style={styles.disconnectText}>Disconnect</Text>
                </TouchableOpacity>
              </View>
            ) : (
              <View style={styles.noWalletBox}>
                <Text style={styles.noWalletText}>
                  No wallet connected.{'\n'}Connect via WalletConnect to withdraw.
                </Text>
                <TouchableOpacity
                  style={[styles.connectBtn, (connecting || loading) && styles.btnDisabled]}
                  onPress={handleConnectWallet}
                  disabled={connecting || loading}
                >
                  {connecting || loading
                    ? <ActivityIndicator color="#FFFFFF" size="small" />
                    : <Text style={styles.connectBtnText}>Connect Wallet</Text>
                  }
                </TouchableOpacity>
              </View>
            )}
          </View>

          {/* Withdrawal */}
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Withdraw</Text>
            <View style={styles.inputRow}>
              <Text style={styles.dollarSign}>$</Text>
              <TextInput
                style={styles.amountInput}
                value={withdrawAmount}
                onChangeText={setWithdrawAmount}
                keyboardType="decimal-pad"
                placeholder="0.00"
                placeholderTextColor="rgba(255,255,255,0.3)"
              />
            </View>
            <Text style={styles.feeNote}>2% network fee · Min $1.00 · Max $500.00</Text>

            <TouchableOpacity
              style={[styles.withdrawBtn, (loading || !user?.walletAddress) && styles.btnDisabled]}
              onPress={handleWithdraw}
              disabled={loading || !user?.walletAddress}
            >
              {loading
                ? <ActivityIndicator color="#FFFFFF" />
                : <Text style={styles.withdrawBtnText}>Withdraw to Wallet</Text>
              }
            </TouchableOpacity>
          </View>

          {/* Last transaction */}
          {lastTxHash && (
            <TouchableOpacity
              style={styles.txLink}
              onPress={() => lastTxUrl && Linking.openURL(lastTxUrl)}
            >
              <Text style={styles.txLinkText}>
                View last tx: {lastTxHash.slice(0, 10)}...
              </Text>
            </TouchableOpacity>
          )}
        </ScrollView>
      </SafeAreaView>
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  scroll:      { padding: 20, paddingBottom: 40 },
  heading:     { color: '#FFD700', fontSize: 24, fontWeight: '800', marginBottom: 20 },

  cardsRow:    { flexDirection: 'row', gap: 12, marginBottom: 24 },
  balanceCard: {
    flex: 1,
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
  },
  cardLabel:   { color: 'rgba(255,255,255,0.4)', fontSize: 12, marginBottom: 6 },
  cardValue:   { color: '#FFFFFF', fontSize: 20, fontWeight: '800' },

  section:      { marginBottom: 24 },
  sectionTitle: { color: 'rgba(255,255,255,0.5)', fontSize: 13, marginBottom: 10 },

  addressBox:     { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
                    backgroundColor: 'rgba(255,255,255,0.06)', borderRadius: 12, padding: 14 },
  address:        { color: '#FFFFFF', fontWeight: '600' },
  disconnectText: { color: '#E94560', fontSize: 13 },

  noWalletBox:  { backgroundColor: 'rgba(255,255,255,0.04)', borderRadius: 12, padding: 16, gap: 12 },
  noWalletText: { color: 'rgba(255,255,255,0.4)', fontSize: 13, lineHeight: 20 },
  connectBtn:   { backgroundColor: '#E94560', borderRadius: 12, paddingVertical: 12, alignItems: 'center' },
  connectBtnText: { color: '#FFFFFF', fontWeight: '700' },

  inputRow: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.06)', borderRadius: 12,
    paddingHorizontal: 14, marginBottom: 8, borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)',
  },
  dollarSign:  { color: 'rgba(255,255,255,0.4)', fontSize: 18, marginRight: 4 },
  amountInput: { flex: 1, color: '#FFFFFF', fontSize: 20, fontWeight: '700', paddingVertical: 14 },
  feeNote:     { color: 'rgba(255,255,255,0.3)', fontSize: 11, marginBottom: 16 },

  withdrawBtn: { backgroundColor: '#7ED321', borderRadius: 14, paddingVertical: 15, alignItems: 'center' },
  btnDisabled: { opacity: 0.4 },
  withdrawBtnText: { color: '#FFFFFF', fontWeight: '700', fontSize: 15 },

  txLink:     { alignItems: 'center', paddingTop: 8 },
  txLinkText: { color: '#4A9EFF', fontSize: 13 },
});
