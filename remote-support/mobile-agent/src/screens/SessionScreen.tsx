import React, { useRef, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  FlatList,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  ListRenderItem,
} from 'react-native';
import { useDeviceStore, type ChatMessage } from '../store/deviceStore';
import { sendChat, endSession } from '../services/signalingService';

const COLORS = {
  bg:      '#0d0f12',
  panel:   '#13161b',
  border:  '#1f2530',
  accent:  '#00e5a0',
  text:    '#e4e8f0',
  muted:   '#5a6070',
  muted2:  '#8899aa',
  danger:  '#ef4444',
  warn:    '#ff6b35',
};

export default function SessionScreen() {
  const { sessionCode, sessionId, chat, addChat, clearSession } = useDeviceStore();
  const [msg, setMsg] = useState('');
  const listRef = useRef<FlatList>(null);

  function send() {
    const text = msg.trim();
    if (!text || !sessionCode) return;
    addChat({ role: 'device', text, ts: new Date().toLocaleTimeString() });
    sendChat(sessionCode, text);
    setMsg('');
  }

  function stopSharing() {
    if (!sessionCode) return;
    endSession(sessionCode, sessionId);
    clearSession();
  }

  const renderMsg: ListRenderItem<ChatMessage> = ({ item }) => {
    if (item.role === 'sys') {
      return (
        <View style={styles.sysRow}>
          <Text style={styles.sysText}>{item.text}</Text>
        </View>
      );
    }
    const isMe = item.role === 'device';
    return (
      <View style={[styles.msgRow, isMe ? styles.msgRight : styles.msgLeft]}>
        <View style={[styles.bubble, isMe ? styles.bubbleMe : styles.bubbleThem]}>
          <Text style={[styles.bubbleText, isMe && { color: '#c0f0d8' }]}>{item.text}</Text>
        </View>
        <Text style={styles.msgTime}>{item.ts}</Text>
      </View>
    );
  };

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={90}
    >
      {/* Header */}
      <View style={styles.header}>
        <View>
          <Text style={styles.headerTitle}>Session Active</Text>
          <Text style={styles.headerCode}>{sessionCode}</Text>
        </View>
        <View style={styles.livePill}>
          <View style={styles.liveDot} />
          <Text style={styles.liveText}>LIVE</Text>
        </View>
      </View>

      {/* Sharing status */}
      <View style={styles.sharingBar}>
        <Text style={styles.sharingText}>
          {Platform.OS === 'ios'
            ? '📷  Sharing camera (iOS view-only mode)'
            : '📱  Sharing screen with agent'}
        </Text>
      </View>

      {/* Chat */}
      <FlatList
        ref={listRef}
        data={chat}
        keyExtractor={(item) => item.id}
        renderItem={renderMsg}
        contentContainerStyle={styles.chatList}
        onContentSizeChange={() => listRef.current?.scrollToEnd({ animated: true })}
        ListEmptyComponent={
          <View style={styles.emptyChat}>
            <Text style={styles.emptyChatText}>No messages yet</Text>
          </View>
        }
      />

      {/* Input bar */}
      <View style={styles.inputBar}>
        <TextInput
          style={styles.input}
          placeholder="Message agent…"
          placeholderTextColor={COLORS.muted}
          value={msg}
          onChangeText={setMsg}
          onSubmitEditing={send}
          returnKeyType="send"
          multiline={false}
        />
        <TouchableOpacity style={styles.sendBtn} onPress={send}>
          <Text style={styles.sendIcon}>→</Text>
        </TouchableOpacity>
      </View>

      {/* Stop sharing */}
      <TouchableOpacity style={styles.stopBtn} onPress={stopSharing}>
        <Text style={styles.stopBtnText}>Stop Sharing</Text>
      </TouchableOpacity>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.bg },

  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    padding: 16, borderBottomWidth: 1, borderBottomColor: COLORS.border,
    backgroundColor: COLORS.panel,
  },
  headerTitle: { fontSize: 15, fontWeight: '600', color: COLORS.text },
  headerCode:  { fontSize: 11, fontFamily: 'monospace', color: COLORS.muted, marginTop: 2 },

  livePill: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: 'rgba(255,107,53,0.15)', borderRadius: 12,
    paddingHorizontal: 10, paddingVertical: 5,
    borderWidth: 1, borderColor: 'rgba(255,107,53,0.3)',
  },
  liveDot:  { width: 7, height: 7, borderRadius: 4, backgroundColor: COLORS.warn },
  liveText: { fontSize: 10, fontFamily: 'monospace', fontWeight: '700', color: COLORS.warn },

  sharingBar: {
    backgroundColor: 'rgba(0,229,160,0.06)', borderBottomWidth: 1,
    borderBottomColor: 'rgba(0,229,160,0.15)', padding: 10, alignItems: 'center',
  },
  sharingText: { fontSize: 12, color: COLORS.accent },

  chatList: { padding: 14, gap: 8, flexGrow: 1 },

  sysRow:  { alignItems: 'center', marginVertical: 4 },
  sysText: { fontSize: 10, fontFamily: 'monospace', color: COLORS.muted },

  msgRow:   { marginVertical: 2 },
  msgRight: { alignItems: 'flex-end' },
  msgLeft:  { alignItems: 'flex-start' },

  bubble: {
    maxWidth: '80%', padding: 10, borderRadius: 10,
  },
  bubbleMe: {
    backgroundColor: 'rgba(0,229,160,0.08)',
    borderWidth: 1, borderColor: 'rgba(0,229,160,0.2)',
  },
  bubbleThem: {
    backgroundColor: '#1a1e27',
    borderWidth: 1, borderColor: COLORS.border,
  },
  bubbleText: { fontSize: 13, color: COLORS.text, lineHeight: 19 },
  msgTime:    { fontSize: 10, color: COLORS.muted, fontFamily: 'monospace', marginTop: 3 },

  emptyChat:     { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32 },
  emptyChatText: { fontSize: 12, fontFamily: 'monospace', color: COLORS.muted },

  inputBar: {
    flexDirection: 'row', alignItems: 'center',
    borderTopWidth: 1, borderTopColor: COLORS.border,
    padding: 10, gap: 8, backgroundColor: COLORS.panel,
  },
  input: {
    flex: 1, backgroundColor: '#1a1e27',
    borderWidth: 1, borderColor: COLORS.border, borderRadius: 8,
    paddingHorizontal: 12, paddingVertical: 9,
    color: COLORS.text, fontSize: 13,
  },
  sendBtn:  { width: 38, height: 38, backgroundColor: COLORS.accent, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  sendIcon: { color: '#000', fontSize: 16, fontWeight: '700' },

  stopBtn: {
    margin: 12, backgroundColor: 'rgba(239,68,68,0.12)',
    borderWidth: 1, borderColor: 'rgba(239,68,68,0.3)',
    borderRadius: 10, padding: 14, alignItems: 'center',
  },
  stopBtnText: { color: COLORS.danger, fontWeight: '600', fontSize: 14 },
});
