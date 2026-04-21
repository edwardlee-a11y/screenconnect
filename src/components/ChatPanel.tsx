import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, FlatList,
  StyleSheet, KeyboardAvoidingView, Platform,
} from 'react-native';
import { getSocket } from '../services/socket';
import { useAuthStore } from '../store/authStore';
import type { ChatPayload } from '../services/socket';

const MAX_MESSAGES = 50;

export function ChatPanel() {
  const { user } = useAuthStore();
  const [messages, setMessages] = useState<ChatPayload[]>([]);
  const [input,    setInput]    = useState('');
  const listRef = useRef<FlatList<ChatPayload>>(null);

  useEffect(() => {
    const socket = getSocket();
    const onMessage = (payload: ChatPayload) => {
      setMessages((prev) => [...prev, payload].slice(-MAX_MESSAGES));
    };
    socket.on('chat:message', onMessage);
    return () => { socket.off('chat:message', onMessage); };
  }, []);

  // Auto-scroll to latest message
  useEffect(() => {
    if (messages.length > 0) {
      setTimeout(() => listRef.current?.scrollToEnd({ animated: true }), 50);
    }
  }, [messages.length]);

  const handleSend = useCallback(() => {
    const text = input.trim();
    if (!text) return;
    getSocket().emit('chat:message', { message: text });
    setInput('');
  }, [input]);

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      keyboardVerticalOffset={0}
    >
      <View style={styles.container}>
        <Text style={styles.label}>Room Chat</Text>

        <FlatList
          ref={listRef}
          data={messages}
          keyExtractor={(_, i) => String(i)}
          style={styles.list}
          renderItem={({ item }) => (
            <View style={styles.messageRow}>
              <Text style={[
                styles.msgUsername,
                item.username === user?.username && styles.msgUsernameSelf,
              ]}>
                {item.username}
              </Text>
              <Text style={styles.msgText}>{item.message}</Text>
            </View>
          )}
          ListEmptyComponent={
            <Text style={styles.empty}>No messages yet. Say hi!</Text>
          }
        />

        <View style={styles.inputRow}>
          <TextInput
            style={styles.input}
            placeholder="Message…"
            placeholderTextColor="rgba(255,255,255,0.25)"
            value={input}
            onChangeText={setInput}
            onSubmitEditing={handleSend}
            returnKeyType="send"
            maxLength={120}
            autoCorrect={false}
          />
          <TouchableOpacity
            style={[styles.sendBtn, !input.trim() && styles.sendBtnDisabled]}
            onPress={handleSend}
            disabled={!input.trim()}
          >
            <Text style={styles.sendBtnText}>↑</Text>
          </TouchableOpacity>
        </View>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    borderTopWidth: 1,
    borderTopColor: 'rgba(255,255,255,0.08)',
    backgroundColor: 'rgba(0,0,0,0.3)',
    paddingHorizontal: 12,
    paddingTop: 8,
    paddingBottom: 8,
    maxHeight: 200,
  },
  label: {
    color: 'rgba(255,255,255,0.25)',
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 1,
    textTransform: 'uppercase',
    marginBottom: 6,
  },
  list: { maxHeight: 110, marginBottom: 6 },

  messageRow: { flexDirection: 'row', gap: 6, marginBottom: 4, flexWrap: 'wrap' },
  msgUsername: { color: '#00D4FF', fontSize: 12, fontWeight: '700' },
  msgUsernameSelf: { color: '#FFD700' },
  msgText: { color: 'rgba(255,255,255,0.75)', fontSize: 12, flexShrink: 1 },

  empty: { color: 'rgba(255,255,255,0.2)', fontSize: 11, textAlign: 'center', paddingVertical: 8 },

  inputRow: { flexDirection: 'row', gap: 8, alignItems: 'center' },
  input: {
    flex: 1,
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderRadius: 10,
    color: '#fff',
    fontSize: 13,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
  },
  sendBtn: {
    backgroundColor: '#E94560',
    borderRadius: 10,
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendBtnDisabled: { backgroundColor: 'rgba(255,255,255,0.1)' },
  sendBtnText: { color: '#fff', fontSize: 18, fontWeight: '700', lineHeight: 20 },
});
