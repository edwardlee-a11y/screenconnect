import React, { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { authApi } from '../services/api';
import { useAuthStore } from '../store/authStore';
import {
  firebaseLogin,
  firebaseRegister,
  firebaseResetPassword,
} from '../services/firebase';
import type { AuthUser } from '../store/authStore';
export function AuthScreen() {
  const { setAuth } = useAuthStore();

  const [mode,     setMode]     = useState<'login' | 'register'>('login');
  const [email,    setEmail]    = useState('');
  const [password, setPassword] = useState('');
  const [username, setUsername] = useState('');
  const [loading,  setLoading]  = useState(false);

  const handleSubmit = async () => {
    if (!email || !password) {
      Alert.alert('Error', 'Email and password are required.');
      return;
    }
    if (mode === 'register' && !username) {
      Alert.alert('Error', 'Username is required.');
      return;
    }

    setLoading(true);
    try {
      const firebaseToken = mode === 'login'
        ? await firebaseLogin(email, password)
        : await firebaseRegister(email, password);

      if (mode === 'register') {
        Alert.alert(
          'Verify your email',
          'A verification link has been sent to your email address. ' +
          'Please verify before signing in.',
        );
        setMode('login');
        return;
      }

      // At this point mode is always 'login' (register path returns early above)
      // Pass username so the backend can create the Supabase record on first login.
      const { data, error } = await authApi.login(firebaseToken, username || undefined);

      if (error) {
        Alert.alert('Login Failed', error);
        return;
      }

      if (data) {
        const authUser: AuthUser = {
          id:            data.user.id,
          email:         data.user.email,
          username:      data.user.username,
          balanceUsd:    data.user.balanceUsd,
          balanceSpin:   data.user.balanceSpin,
          walletAddress: data.user.walletAddress,
          kycVerified:   data.user.kycVerified,
        };
        await setAuth(data.token, authUser);
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'An error occurred.';
      Alert.alert('Error', msg);
    } finally {
      setLoading(false);
    }
  };

  const handleForgotPassword = async () => {
    if (!email) {
      Alert.alert('Reset Password', 'Enter your email address above, then tap Forgot Password.');
      return;
    }
    try {
      await firebaseResetPassword(email);
      Alert.alert('Reset Password', `A reset link has been sent to ${email}.`);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'An error occurred.';
      Alert.alert('Error', msg);
    }
  };

  return (
    <LinearGradient colors={['#0D0D1A', '#16213E']} style={styles.gradient}>
      <SafeAreaView style={styles.safe}>
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={styles.container}
        >
          {/* Logo */}
          <View style={styles.logoSection}>
            <Text style={styles.logo}>🎰</Text>
            <Text style={styles.title}>Spin & Win</Text>
            <Text style={styles.subtitle}>Spin & Win</Text>
          </View>

          {/* Mode toggle */}
          <View style={styles.toggle}>
            <TouchableOpacity
              style={[styles.toggleBtn, mode === 'login' && styles.toggleBtnActive]}
              onPress={() => setMode('login')}
            >
              <Text style={[styles.toggleText, mode === 'login' && styles.toggleTextActive]}>
                Login
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.toggleBtn, mode === 'register' && styles.toggleBtnActive]}
              onPress={() => setMode('register')}
            >
              <Text style={[styles.toggleText, mode === 'register' && styles.toggleTextActive]}>
                Register
              </Text>
            </TouchableOpacity>
          </View>

          {/* Form */}
          <View style={styles.form}>
            {mode === 'register' && (
              <TextInput
                style={styles.input}
                placeholder="Username"
                placeholderTextColor="rgba(255,255,255,0.3)"
                value={username}
                onChangeText={setUsername}
                autoCapitalize="none"
              />
            )}
            <TextInput
              style={styles.input}
              placeholder="Email"
              placeholderTextColor="rgba(255,255,255,0.3)"
              value={email}
              onChangeText={setEmail}
              keyboardType="email-address"
              autoCapitalize="none"
            />
            <TextInput
              style={styles.input}
              placeholder="Password"
              placeholderTextColor="rgba(255,255,255,0.3)"
              value={password}
              onChangeText={setPassword}
              secureTextEntry
            />

            <TouchableOpacity
              style={[styles.submitBtn, loading && styles.submitBtnDisabled]}
              onPress={handleSubmit}
              disabled={loading}
              activeOpacity={0.85}
            >
              {loading ? (
                <ActivityIndicator color="#FFFFFF" />
              ) : (
                <Text style={styles.submitText}>
                  {mode === 'login' ? 'Sign In' : 'Create Account'}
                </Text>
              )}
            </TouchableOpacity>

            {mode === 'login' && (
              <TouchableOpacity onPress={handleForgotPassword} activeOpacity={0.7}>
                <Text style={styles.forgotText}>Forgot password?</Text>
              </TouchableOpacity>
            )}
          </View>

          <Text style={styles.disclaimer}>
            Play responsibly. For entertainment purposes only.
          </Text>

        </KeyboardAvoidingView>
      </SafeAreaView>
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  gradient:  { flex: 1 },
  safe:      { flex: 1 },
  container: { flex: 1, justifyContent: 'center', padding: 24 },

  logoSection: { alignItems: 'center', marginBottom: 40 },
  logo:       { fontSize: 64, marginBottom: 12 },
  title:      { color: '#FFD700', fontSize: 32, fontWeight: '900', letterSpacing: 1 },
  subtitle:   { color: 'rgba(255,255,255,0.4)', fontSize: 14, marginTop: 4 },

  toggle: {
    flexDirection: 'row',
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderRadius: 14,
    padding: 4,
    marginBottom: 24,
  },
  toggleBtn:       { flex: 1, paddingVertical: 10, alignItems: 'center', borderRadius: 10 },
  toggleBtnActive: { backgroundColor: '#E94560' },
  toggleText:      { color: 'rgba(255,255,255,0.4)', fontWeight: '600' },
  toggleTextActive:{ color: '#FFFFFF' },

  form: { gap: 12, marginBottom: 24 },
  input: {
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderRadius: 14,
    paddingHorizontal: 16,
    paddingVertical: 14,
    color: '#FFFFFF',
    fontSize: 15,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
  },
  submitBtn: {
    backgroundColor: '#E94560',
    borderRadius: 14,
    paddingVertical: 16,
    alignItems: 'center',
    marginTop: 8,
  },
  submitBtnDisabled: { opacity: 0.6 },
  submitText:        { color: '#FFFFFF', fontSize: 16, fontWeight: '700' },
  forgotText:        { color: 'rgba(255,255,255,0.4)', fontSize: 13, textAlign: 'center', marginTop: 4 },

  disclaimer: {
    color: 'rgba(255,255,255,0.25)',
    fontSize: 11,
    textAlign: 'center',
    lineHeight: 16,
  },

});
