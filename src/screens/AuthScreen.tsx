import React, { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
} from 'react-native';
import { supabase } from '../services/supabaseClient';
import { COLORS, SPACING, RADIUS } from '../utils/theme';

type Mode = 'login' | 'signup';

export default function AuthScreen() {
  const [mode, setMode] = useState<Mode>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async () => {
    setError(null);
    setMessage(null);

    if (!email.trim() || !password) {
      setError('メールアドレスとパスワードを入力してください');
      return;
    }
    if (password.length < 6) {
      setError('パスワードは6文字以上にしてください');
      return;
    }

    setLoading(true);
    try {
      if (mode === 'signup') {
        const { data, error } = await supabase.auth.signUp({
          email: email.trim(),
          password,
        });
        if (error) throw error;
        // メール確認が有効な場合はセッションが返らない
        if (!data.session) {
          setMessage('確認メールを送信しました。メール内のリンクを開いてから、ログインしてください。');
          setMode('login');
        }
      } else {
        const { error } = await supabase.auth.signInWithPassword({
          email: email.trim(),
          password,
        });
        if (error) throw error;
      }
    } catch (e: any) {
      setError(translateError(e?.message ?? '失敗しました'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <KeyboardAvoidingView
      style={styles.wrapper}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
        <Text style={styles.logo}>InstaAI</Text>
        <Text style={styles.subtitle}>
          {mode === 'login' ? 'ログインして始めましょう' : 'アカウントを作成しましょう'}
        </Text>

        <View style={styles.card}>
          <Text style={styles.label}>メールアドレス</Text>
          <TextInput
            style={styles.input}
            value={email}
            onChangeText={setEmail}
            placeholder="you@example.com"
            placeholderTextColor={COLORS.textMuted}
            autoCapitalize="none"
            keyboardType="email-address"
            autoCorrect={false}
          />

          <Text style={styles.label}>パスワード</Text>
          <TextInput
            style={styles.input}
            value={password}
            onChangeText={setPassword}
            placeholder="6文字以上"
            placeholderTextColor={COLORS.textMuted}
            secureTextEntry
            autoCapitalize="none"
          />

          {error && <Text style={styles.error}>{error}</Text>}
          {message && <Text style={styles.message}>{message}</Text>}

          <TouchableOpacity
            style={[styles.submitBtn, loading && styles.submitBtnDisabled]}
            onPress={handleSubmit}
            disabled={loading}
          >
            {loading ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={styles.submitText}>
                {mode === 'login' ? 'ログイン' : '新規登録'}
              </Text>
            )}
          </TouchableOpacity>
        </View>

        <TouchableOpacity
          style={styles.switchBtn}
          onPress={() => {
            setMode((m) => (m === 'login' ? 'signup' : 'login'));
            setError(null);
            setMessage(null);
          }}
        >
          <Text style={styles.switchText}>
            {mode === 'login'
              ? 'アカウントをお持ちでない方はこちら（新規登録）'
              : 'すでにアカウントをお持ちの方はこちら（ログイン）'}
          </Text>
        </TouchableOpacity>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

function translateError(msg: string): string {
  if (/Invalid login credentials/i.test(msg)) return 'メールアドレスまたはパスワードが正しくありません';
  if (/User already registered/i.test(msg)) return 'このメールアドレスは既に登録されています';
  if (/Email not confirmed/i.test(msg)) return 'メール確認が完了していません。確認メールのリンクを開いてください';
  if (/Password should be/i.test(msg)) return 'パスワードは6文字以上にしてください';
  return msg;
}

const styles = StyleSheet.create({
  wrapper: { flex: 1, backgroundColor: COLORS.background },
  container: {
    flexGrow: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: SPACING.lg,
    paddingVertical: SPACING.xxl,
  },
  logo: {
    color: COLORS.primary,
    fontSize: 40,
    fontWeight: '900',
    textAlign: 'center',
  },
  subtitle: {
    color: COLORS.textSecondary,
    fontSize: 14,
    textAlign: 'center',
    marginTop: SPACING.sm,
    marginBottom: SPACING.xl,
  },
  card: {
    width: '100%',
    maxWidth: 400,
    backgroundColor: COLORS.surface,
    borderRadius: RADIUS.lg,
    padding: SPACING.lg,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  label: {
    color: COLORS.textSecondary,
    fontSize: 13,
    fontWeight: '600',
    marginBottom: SPACING.xs,
    marginTop: SPACING.md,
  },
  input: {
    backgroundColor: COLORS.background,
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: RADIUS.md,
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.sm,
    color: COLORS.text,
    fontSize: 15,
  },
  error: {
    color: COLORS.error,
    fontSize: 13,
    marginTop: SPACING.md,
  },
  message: {
    color: COLORS.success,
    fontSize: 13,
    marginTop: SPACING.md,
    lineHeight: 19,
  },
  submitBtn: {
    backgroundColor: COLORS.primary,
    borderRadius: RADIUS.full,
    paddingVertical: SPACING.md,
    alignItems: 'center',
    marginTop: SPACING.lg,
  },
  submitBtnDisabled: { opacity: 0.6 },
  submitText: { color: '#fff', fontWeight: '700', fontSize: 16 },
  switchBtn: { marginTop: SPACING.lg, alignItems: 'center' },
  switchText: { color: COLORS.textSecondary, fontSize: 13 },
});
