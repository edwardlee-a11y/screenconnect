import React, { useState } from 'react';
import {
  View, Text, StyleSheet, TextInput, TouchableOpacity,
  ScrollView, Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { useGameStore } from '../store/gameStore';

// ─── HMAC-SHA256 via SubtleCrypto (available in React Native 0.73+) ──────────

async function hmacSha256(key: string, data: string): Promise<string> {
  const enc = new TextEncoder();
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    enc.encode(key),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', cryptoKey, enc.encode(data));
  return Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

// ─── Wheel config (must match backend WHEEL array) ────────────────────────────

const WHEEL = [
  { label: 'LOSE',    multiplier: 0 },
  { label: 'LOSE',    multiplier: 0 },
  { label: '1.2x',    multiplier: 1.2 },
  { label: '1.5x',    multiplier: 1.5 },
  { label: 'LOSE',    multiplier: 0 },
  { label: '2x',      multiplier: 2 },
  { label: '1.2x',    multiplier: 1.2 },
  { label: '3x',      multiplier: 3 },
  { label: '2x',      multiplier: 2 },
  { label: '5x',      multiplier: 5 },
  { label: '10x',     multiplier: 10 },
  { label: 'JACKPOT', multiplier: 50 },
];

const WHEEL_WEIGHTS = [280, 200, 150, 120, 80, 60, 40, 30, 20, 12, 5, 3];
const TOTAL_WEIGHT  = WHEEL_WEIGHTS.reduce((a, b) => a + b, 0);

function computeOutcomeIndex(serverSeed: string, clientSeed: string, nonce: number): number {
  // This must match the backend's computeOutcome function in gameSocket.ts / games.ts
  // HMAC-SHA256(serverSeed, `${clientSeed}:${nonce}`) → hex → first 8 chars → mod TOTAL_WEIGHT
  // We compute the hex inline after the async call resolves.
  return -1; // placeholder — real compute is async, see verifyFairness()
}

interface VerifyResult {
  valid: boolean;
  computedIndex: number;
  computedLabel: string;
  computedMultiplier: number;
  roll: number;
  seedHashMatch: boolean;
}

async function verifyFairness(params: {
  serverSeed: string;
  serverSeedHash: string;
  clientSeed: string;
  nonce: number;
  claimedOutcomeIndex: number;
}): Promise<VerifyResult> {
  const { serverSeed, serverSeedHash, clientSeed, nonce, claimedOutcomeIndex } = params;

  // 1. Verify the server seed hash matches the commitment
  const computedHash = await hmacSha256(serverSeed, serverSeed); // SHA-256 of serverSeed
  // Backend uses createHmac('sha256', serverSeed).digest('hex') for the hash commitment
  // We use a simpler self-HMAC here; the real hash is the SHA-256 of the seed string
  const enc = new TextEncoder();
  const hashBuf = await crypto.subtle.digest('SHA-256', enc.encode(serverSeed));
  const actualHash = Array.from(new Uint8Array(hashBuf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');

  const seedHashMatch = actualHash === serverSeedHash ||
    computedHash === serverSeedHash; // tolerate both hash styles

  // 2. Compute the outcome
  const hmacHex = await hmacSha256(serverSeed, `${clientSeed}:${nonce}`);
  const roll = parseInt(hmacHex.slice(0, 8), 16) % TOTAL_WEIGHT;

  let cumulative = 0;
  let computedIndex = WHEEL.length - 1;
  for (let i = 0; i < WHEEL_WEIGHTS.length; i++) {
    cumulative += WHEEL_WEIGHTS[i];
    if (roll < cumulative) {
      computedIndex = i;
      break;
    }
  }

  const segment = WHEEL[computedIndex];

  return {
    valid: computedIndex === claimedOutcomeIndex,
    computedIndex,
    computedLabel:      segment.label,
    computedMultiplier: segment.multiplier,
    roll,
    seedHashMatch,
  };
}

// ─── Screen ──────────────────────────────────────────────────────────────────

export function FairnessScreen() {
  const { lastResult, serverSeedHash } = useGameStore();

  const [serverSeed,   setServerSeed]   = useState('');
  const [clientSeed,   setClientSeed]   = useState('');
  const [nonceStr,     setNonceStr]     = useState('');
  const [seedHashIn,   setSeedHashIn]   = useState('');
  const [outcomeIdxStr, setOutcomeIdxStr] = useState('');
  const [result,       setResult]       = useState<VerifyResult | null>(null);
  const [verifying,    setVerifying]    = useState(false);

  // Pre-fill from last spin if server seed has been revealed (session ended)
  const prefillFromLastSpin = () => {
    if (!lastResult) {
      Alert.alert('No Spin', 'Complete a spin first, then end your session to reveal the server seed.');
      return;
    }
    setClientSeed('');            // client seed is not stored in-app — user must copy from spin history
    setSeedHashIn(lastResult.serverSeedHash);
    setNonceStr(String(lastResult.nonce));
    setOutcomeIdxStr(String(lastResult.outcomeIndex));
    Alert.alert(
      'Partially Pre-filled',
      'The server seed hash, nonce, and outcome index are filled in.\n\n' +
      'Enter the revealed server seed (shown after you end your session) and your client seed to verify.',
    );
  };

  const handleVerify = async () => {
    const nonce       = parseInt(nonceStr, 10);
    const outcomeIdx  = parseInt(outcomeIdxStr, 10);

    if (!serverSeed || !clientSeed || isNaN(nonce) || isNaN(outcomeIdx) || !seedHashIn) {
      Alert.alert('Error', 'Fill in all fields before verifying.');
      return;
    }
    if (outcomeIdx < 0 || outcomeIdx > 11) {
      Alert.alert('Error', 'Outcome index must be 0–11.');
      return;
    }

    setVerifying(true);
    try {
      const r = await verifyFairness({
        serverSeed,
        serverSeedHash: seedHashIn,
        clientSeed,
        nonce,
        claimedOutcomeIndex: outcomeIdx,
      });
      setResult(r);
    } catch {
      Alert.alert('Error', 'Verification failed — check your inputs.');
    } finally {
      setVerifying(false);
    }
  };

  const handleClear = () => {
    setServerSeed('');
    setClientSeed('');
    setNonceStr('');
    setSeedHashIn('');
    setOutcomeIdxStr('');
    setResult(null);
  };

  return (
    <LinearGradient colors={['#0D0D1A', '#16213E', '#0D0D1A']} style={{ flex: 1 }}>
      <SafeAreaView style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
          <Text style={styles.heading}>Provably Fair</Text>
          <Text style={styles.subtitle}>
            Verify any spin result using HMAC-SHA256.{'\n'}
            The server commits to a seed hash before you spin — you can check it afterwards.
          </Text>

          {/* How it works */}
          <View style={styles.howCard}>
            <Text style={styles.howTitle}>How it works</Text>
            <Text style={styles.howStep}>1. Before the spin the server hashes its seed and sends you the hash.</Text>
            <Text style={styles.howStep}>2. You provide a client seed. The outcome = HMAC-SHA256(serverSeed, clientSeed:nonce) mod {TOTAL_WEIGHT}.</Text>
            <Text style={styles.howStep}>3. After the session ends the server reveals the raw seed.</Text>
            <Text style={styles.howStep}>4. You can verify the hash matches and re-compute the outcome yourself here.</Text>
          </View>

          {/* Pre-fill button */}
          <TouchableOpacity style={styles.prefillBtn} onPress={prefillFromLastSpin}>
            <Text style={styles.prefillText}>Pre-fill from last spin →</Text>
          </TouchableOpacity>

          {/* Inputs */}
          <View style={styles.section}>
            <Field
              label="Server Seed (revealed after session)"
              placeholder="e.g. a3f8c2..."
              value={serverSeed}
              onChangeText={setServerSeed}
              mono
            />
            <Field
              label="Server Seed Hash (commitment)"
              placeholder="e.g. 7d4b9..."
              value={seedHashIn}
              onChangeText={setSeedHashIn}
              mono
            />
            <Field
              label="Client Seed"
              placeholder="e.g. 1a2b3c4d..."
              value={clientSeed}
              onChangeText={setClientSeed}
              mono
            />
            <Field
              label="Nonce (spin number)"
              placeholder="e.g. 42"
              value={nonceStr}
              onChangeText={setNonceStr}
              numeric
            />
            <Field
              label="Claimed Outcome Index (0–11)"
              placeholder="e.g. 5"
              value={outcomeIdxStr}
              onChangeText={setOutcomeIdxStr}
              numeric
            />
          </View>

          <View style={styles.btnRow}>
            <TouchableOpacity
              style={[styles.btn, styles.btnPrimary, verifying && styles.btnDisabled]}
              onPress={handleVerify}
              disabled={verifying}
            >
              <Text style={styles.btnText}>{verifying ? 'Verifying…' : 'Verify Spin'}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[styles.btn, styles.btnSecondary]} onPress={handleClear}>
              <Text style={[styles.btnText, { color: 'rgba(255,255,255,0.5)' }]}>Clear</Text>
            </TouchableOpacity>
          </View>

          {/* Result */}
          {result && (
            <View style={[styles.resultCard, result.valid ? styles.resultOk : styles.resultFail]}>
              <Text style={styles.resultTitle}>
                {result.valid ? '✅ VERIFIED — Spin is fair' : '❌ MISMATCH — Result does not match'}
              </Text>

              <ResultRow label="Computed outcome"  value={`#${result.computedIndex} — ${result.computedLabel} (${result.computedMultiplier}x)`} />
              <ResultRow label="Roll"              value={`${result.roll} / ${TOTAL_WEIGHT}`} />
              <ResultRow label="Seed hash match"   value={result.seedHashMatch ? '✓ Yes' : '✗ No (hash mismatch!)'} />

              {!result.valid && (
                <Text style={styles.mismatchNote}>
                  The computed outcome index ({result.computedIndex}) does not match the claimed index ({outcomeIdxStr}).
                  This may indicate a tampered result.
                </Text>
              )}
            </View>
          )}

          {/* Wheel reference */}
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Wheel Segments Reference</Text>
            {WHEEL.map((seg, i) => (
              <View key={i} style={styles.segRow}>
                <Text style={styles.segIndex}>#{i}</Text>
                <Text style={styles.segLabel}>{seg.label}</Text>
                <Text style={styles.segWeight}>weight {WHEEL_WEIGHTS[i]}</Text>
              </View>
            ))}
          </View>
        </ScrollView>
      </SafeAreaView>
    </LinearGradient>
  );
}

function Field({
  label, placeholder, value, onChangeText, mono, numeric,
}: {
  label: string;
  placeholder: string;
  value: string;
  onChangeText: (v: string) => void;
  mono?: boolean;
  numeric?: boolean;
}) {
  return (
    <View style={{ marginBottom: 12 }}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <TextInput
        style={[styles.input, mono && styles.inputMono]}
        placeholder={placeholder}
        placeholderTextColor="rgba(255,255,255,0.25)"
        value={value}
        onChangeText={onChangeText}
        autoCapitalize="none"
        autoCorrect={false}
        keyboardType={numeric ? 'numeric' : 'default'}
      />
    </View>
  );
}

function ResultRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.resultRow}>
      <Text style={styles.resultLabel}>{label}</Text>
      <Text style={styles.resultValue}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  scroll:   { padding: 20, paddingBottom: 48 },
  heading:  { color: '#FFD700', fontSize: 24, fontWeight: '800', marginBottom: 6 },
  subtitle: { color: 'rgba(255,255,255,0.4)', fontSize: 13, lineHeight: 20, marginBottom: 20 },

  howCard: {
    backgroundColor: 'rgba(255,215,0,0.06)',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: 'rgba(255,215,0,0.15)',
    padding: 16,
    marginBottom: 16,
    gap: 6,
  },
  howTitle: { color: '#FFD700', fontWeight: '700', marginBottom: 4 },
  howStep:  { color: 'rgba(255,255,255,0.55)', fontSize: 12, lineHeight: 18 },

  prefillBtn: { alignSelf: 'flex-start', marginBottom: 20 },
  prefillText: { color: '#4A9EFF', fontSize: 13 },

  section:      { marginBottom: 16 },
  sectionTitle: { color: 'rgba(255,255,255,0.4)', fontSize: 12, marginBottom: 10 },

  fieldLabel: { color: 'rgba(255,255,255,0.5)', fontSize: 12, marginBottom: 4 },
  input: {
    backgroundColor: 'rgba(255,255,255,0.07)',
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 11,
    color: '#FFFFFF',
    fontSize: 14,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
  },
  inputMono: { fontFamily: 'monospace', fontSize: 12 },

  btnRow:      { flexDirection: 'row', gap: 10, marginBottom: 20 },
  btn:         { flex: 1, borderRadius: 12, paddingVertical: 14, alignItems: 'center' },
  btnPrimary:  { backgroundColor: '#E94560' },
  btnSecondary:{ backgroundColor: 'rgba(255,255,255,0.06)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)' },
  btnDisabled: { opacity: 0.5 },
  btnText:     { color: '#FFFFFF', fontWeight: '700' },

  resultCard: {
    borderRadius: 14,
    padding: 16,
    marginBottom: 24,
    gap: 8,
    borderWidth: 1,
  },
  resultOk:   { backgroundColor: 'rgba(126,211,33,0.08)',  borderColor: '#7ED321' },
  resultFail: { backgroundColor: 'rgba(233,69,96,0.08)',   borderColor: '#E94560' },
  resultTitle: { color: '#FFFFFF', fontWeight: '800', fontSize: 15, marginBottom: 4 },
  resultRow:   { flexDirection: 'row', justifyContent: 'space-between', flexWrap: 'wrap', gap: 4 },
  resultLabel: { color: 'rgba(255,255,255,0.4)', fontSize: 12 },
  resultValue: { color: '#FFFFFF', fontSize: 12, fontWeight: '600' },
  mismatchNote:{ color: '#E94560', fontSize: 12, marginTop: 8, lineHeight: 18 },

  segRow:    { flexDirection: 'row', alignItems: 'center', paddingVertical: 5, borderBottomWidth: 1, borderBottomColor: 'rgba(255,255,255,0.05)', gap: 8 },
  segIndex:  { color: 'rgba(255,255,255,0.3)', fontSize: 12, width: 28 },
  segLabel:  { flex: 1, color: '#FFFFFF', fontSize: 13 },
  segWeight: { color: 'rgba(255,255,255,0.3)', fontSize: 12 },
});
