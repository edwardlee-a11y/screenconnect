import React, { useState } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, TextInput,
  Alert, ActivityIndicator, ScrollView,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { authApi } from '../services/api';
import { firebaseChangePassword, firebaseResetPassword } from '../services/firebase';
import { useAuthStore } from '../store/authStore';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../navigation/AppNavigator';

export function AccountSettingsScreen() {
  const { user, updateUser, clearAuth } = useAuthStore();
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();

  // ── Username ─────────────────────────────────────────────────────────────
  const [newUsername,     setNewUsername]     = useState('');
  const [savingUsername,  setSavingUsername]  = useState(false);

  // ── Password ─────────────────────────────────────────────────────────────
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword,     setNewPassword]     = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [savingPassword,  setSavingPassword]  = useState(false);

  const handleUpdateUsername = async () => {
    const trimmed = newUsername.trim();
    if (!trimmed) {
      Alert.alert('Error', 'Enter a new username.');
      return;
    }
    if (trimmed === user?.username) {
      Alert.alert('Error', 'That is already your username.');
      return;
    }

    setSavingUsername(true);
    const { data, error } = await authApi.updateProfile(trimmed);
    setSavingUsername(false);

    if (error) {
      Alert.alert('Update Failed', error);
      return;
    }
    if (data) {
      updateUser({ username: data.username });
      setNewUsername('');
      Alert.alert('Success', `Username changed to "${data.username}".`);
    }
  };

  const handleChangePassword = async () => {
    if (!currentPassword || !newPassword || !confirmPassword) {
      Alert.alert('Error', 'All password fields are required.');
      return;
    }
    if (newPassword !== confirmPassword) {
      Alert.alert('Error', 'New passwords do not match.');
      return;
    }
    if (newPassword.length < 6) {
      Alert.alert('Error', 'New password must be at least 6 characters.');
      return;
    }

    setSavingPassword(true);
    try {
      await firebaseChangePassword(currentPassword, newPassword);
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      Alert.alert('Success', 'Password changed successfully.');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to change password.';
      Alert.alert('Error', msg);
    } finally {
      setSavingPassword(false);
    }
  };

  const handleForgotPassword = async () => {
    if (!user?.email) return;
    try {
      await firebaseResetPassword(user.email);
      Alert.alert('Reset Email Sent', `A password reset link has been sent to ${user.email}.`);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to send reset email.';
      Alert.alert('Error', msg);
    }
  };

  const handleLogout = () => {
    Alert.alert('Sign Out', 'Are you sure you want to sign out?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Sign Out',
        style: 'destructive',
        onPress: async () => {
          await authApi.logout();
          await clearAuth();
        },
      },
    ]);
  };

  return (
    <LinearGradient colors={['#0D0D1A', '#16213E', '#0D0D1A']} style={{ flex: 1 }}>
      <SafeAreaView style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
          <Text style={styles.heading}>Account Settings</Text>

          {/* ── Profile info ───────────────────────────────────────────── */}
          <View style={styles.infoCard}>
            <Row label="Username"   value={user?.username ?? '—'} />
            <Row label="Email"      value={user?.email    ?? '—'} />
            <Row label="USD Balance" value={`$${(user?.balanceUsd ?? 0).toFixed(2)}`} />
            <Row label="Total Spins" value={String(0)} />
            <Row label="Verified"   value={user?.kycVerified ? '✓ Yes' : '✗ No'} highlight={user?.kycVerified} />
          </View>

          {/* ── Change username ─────────────────────────────────────────── */}
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Change Username</Text>
            <TextInput
              style={styles.input}
              placeholder={`Current: ${user?.username ?? ''}`}
              placeholderTextColor="rgba(255,255,255,0.3)"
              value={newUsername}
              onChangeText={setNewUsername}
              autoCapitalize="none"
              autoCorrect={false}
            />
            <TouchableOpacity
              style={[styles.btn, styles.btnPrimary, savingUsername && styles.btnDisabled]}
              onPress={handleUpdateUsername}
              disabled={savingUsername}
            >
              {savingUsername
                ? <ActivityIndicator color="#fff" size="small" />
                : <Text style={styles.btnText}>Save Username</Text>
              }
            </TouchableOpacity>
          </View>

          {/* ── Change password ─────────────────────────────────────────── */}
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Change Password</Text>
            <TextInput
              style={styles.input}
              placeholder="Current password"
              placeholderTextColor="rgba(255,255,255,0.3)"
              value={currentPassword}
              onChangeText={setCurrentPassword}
              secureTextEntry
            />
            <TextInput
              style={styles.input}
              placeholder="New password"
              placeholderTextColor="rgba(255,255,255,0.3)"
              value={newPassword}
              onChangeText={setNewPassword}
              secureTextEntry
            />
            <TextInput
              style={styles.input}
              placeholder="Confirm new password"
              placeholderTextColor="rgba(255,255,255,0.3)"
              value={confirmPassword}
              onChangeText={setConfirmPassword}
              secureTextEntry
            />
            <TouchableOpacity
              style={[styles.btn, styles.btnPrimary, savingPassword && styles.btnDisabled]}
              onPress={handleChangePassword}
              disabled={savingPassword}
            >
              {savingPassword
                ? <ActivityIndicator color="#fff" size="small" />
                : <Text style={styles.btnText}>Change Password</Text>
              }
            </TouchableOpacity>
            <TouchableOpacity onPress={handleForgotPassword} style={{ marginTop: 8 }}>
              <Text style={styles.linkText}>Forgot password? Send reset email</Text>
            </TouchableOpacity>
          </View>

          {/* ── Danger zone ─────────────────────────────────────────────── */}
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Session</Text>
            <TouchableOpacity
              style={[styles.btn, styles.btnDanger]}
              onPress={handleLogout}
            >
              <Text style={styles.btnText}>Sign Out</Text>
            </TouchableOpacity>
          </View>
        </ScrollView>
      </SafeAreaView>
    </LinearGradient>
  );
}

function Row({
  label,
  value,
  highlight,
}: {
  label: string;
  value: string;
  highlight?: boolean;
}) {
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text style={[styles.rowValue, highlight && styles.rowValueGreen]}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  scroll:   { padding: 20, paddingBottom: 48 },
  heading:  { color: '#FFD700', fontSize: 24, fontWeight: '800', marginBottom: 20 },

  infoCard: {
    backgroundColor: 'rgba(255,255,255,0.05)',
    borderRadius: 16,
    padding: 16,
    marginBottom: 24,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    gap: 10,
  },
  row:            { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  rowLabel:       { color: 'rgba(255,255,255,0.4)', fontSize: 13 },
  rowValue:       { color: '#FFFFFF', fontSize: 13, fontWeight: '600' },
  rowValueGreen:  { color: '#7ED321' },

  section:      { marginBottom: 24 },
  sectionTitle: { color: 'rgba(255,255,255,0.5)', fontSize: 13, marginBottom: 10 },

  input: {
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 13,
    color: '#FFFFFF',
    fontSize: 15,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
    marginBottom: 10,
  },

  btn:        { borderRadius: 12, paddingVertical: 14, alignItems: 'center' },
  btnPrimary: { backgroundColor: '#E94560' },
  btnAdmin:   { backgroundColor: 'rgba(255,215,0,0.12)', borderWidth: 1, borderColor: '#FFD700' },
  btnDanger:  { backgroundColor: 'rgba(233,69,96,0.15)', borderWidth: 1, borderColor: '#E94560' },
  btnDisabled:{ opacity: 0.5 },
  btnText:    { color: '#FFFFFF', fontWeight: '700', fontSize: 15 },
  linkText:   { color: 'rgba(255,255,255,0.4)', fontSize: 13, textAlign: 'center' },
});
