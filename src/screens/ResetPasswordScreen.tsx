import React, { useEffect, useState } from 'react';
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

// パスワード再設定メールのリンクから開かれたときに表示する画面。
// リンクのcode交換（App.tsx側のOAuthHandlerが担当）が完了してセッションが
// 確立するまでは入力を受け付けず待機する。
export default function ResetPasswordScreen() {
  const [checkingSession, setCheckingSession] = useState(true);
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
      if (session && !cancelled) setCheckingSession(false);
    });
    supabase.auth.getSession().then(({ data }) => {
      if (!cancelled && data.session) setCheckingSession(false);
    });
    return () => {
      cancelled = true;
      listener.subscription.unsubscribe();
    };
  }, []);

  const handleSubmit = async () => {
    setError(null);
    if (password.length < 6) {
      setError('パスワードは6文字以上にしてください');
      return;
    }
    if (password !== confirmPassword) {
      setError('パスワードが一致しません');
      return;
    }
    setLoading(true);
    try {
      const { error: err } = await supabase.auth.updateUser({ password });
      if (err) throw err;
      setDone(true);
      if (Platform.OS === 'web') {
        window.history.replaceState({}, '', window.location.pathname);
      }
    } catch (e: any) {
      setError(e?.message ? '更新に失敗しました。もう一度メールのリンクを開き直してください。' : '更新に失敗しました');
    } finally {
      setLoading(false);
    }
  };

  const handleOpenApp = () => {
    if (Platform.OS === 'web') {
      window.location.href = window.location.pathname;
    }
  };

  if (checkingSession) {
    return (
      <View style={styles.wrapper}>
        <View style={styles.centerBox}>
          <ActivityIndicator color={COLORS.primary} size="large" />
          <Text style={styles.checkingText}>リンクを確認しています…</Text>
        </View>
      </View>
    );
  }

  if (done) {
    return (
      <View style={styles.wrapper}>
        <View style={styles.centerBox}>
          <Text style={styles.logo}>AImark</Text>
          <Text style={styles.title}>パスワードを更新しました</Text>
          <Text style={styles.subtitle}>新しいパスワードでログインできます</Text>
          <TouchableOpacity style={styles.submitBtn} onPress={handleOpenApp} activeOpacity={0.85}>
            <Text style={styles.submitText}>アプリを開く</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  return (
    <KeyboardAvoidingView style={styles.wrapper} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
        <Text style={styles.logo}>AImark</Text>
        <Text style={styles.title}>新しいパスワードを設定</Text>
        <Text style={styles.subtitle}>アカウントの新しいパスワードを入力してください</Text>

        <View style={styles.card}>
          <Text style={styles.label}>新しいパスワード</Text>
          <TextInput
            style={styles.input}
            value={password}
            onChangeText={setPassword}
            placeholder="6文字以上"
            placeholderTextColor={COLORS.textMuted}
            secureTextEntry
            autoCapitalize="none"
          />

          <Text style={styles.label}>新しいパスワード（確認）</Text>
          <TextInput
            style={styles.input}
            value={confirmPassword}
            onChangeText={setConfirmPassword}
            placeholder="もう一度入力"
            placeholderTextColor={COLORS.textMuted}
            secureTextEntry
            autoCapitalize="none"
          />

          {error && <Text style={styles.error}>{error}</Text>}

          <TouchableOpacity
            style={[styles.submitBtn, loading && styles.submitBtnDisabled]}
            onPress={handleSubmit}
            disabled={loading}
          >
            {loading ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={styles.submitText}>パスワードを更新する</Text>
            )}
          </TouchableOpacity>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  wrapper: { flex: 1, backgroundColor: COLORS.background },
  centerBox: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: SPACING.lg,
  },
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
  title: {
    color: COLORS.text,
    fontSize: 18,
    fontWeight: '800',
    textAlign: 'center',
    marginTop: SPACING.lg,
  },
  subtitle: {
    color: COLORS.textSecondary,
    fontSize: 14,
    textAlign: 'center',
    marginTop: SPACING.sm,
    marginBottom: SPACING.xl,
  },
  checkingText: {
    color: COLORS.textSecondary,
    fontSize: 14,
    marginTop: SPACING.md,
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
  submitBtn: {
    backgroundColor: COLORS.primary,
    borderRadius: RADIUS.full,
    paddingVertical: SPACING.md,
    alignItems: 'center',
    marginTop: SPACING.lg,
  },
  submitBtnDisabled: { opacity: 0.6 },
  submitText: { color: '#fff', fontWeight: '700', fontSize: 16 },
});
