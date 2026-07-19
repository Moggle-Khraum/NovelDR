import React from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';

import { useTheme } from '@/context/ThemeContext';
import Colors from '@/constants/colors';
import { CHAPTER_LIMIT_MAX } from '@/hooks/useChapterLimiter';

interface ChapterLimitModalProps {
  visible: boolean;
  chapterCount: number;
  onLower: () => void;
  onProceed: () => void;
}

export function ChapterLimitModal({
  visible,
  chapterCount,
  onLower,
  onProceed,
}: ChapterLimitModalProps) {
  const { colors } = useTheme();

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onLower}>
      <Pressable style={styles.overlay} onPress={onLower}>
        <Pressable
          style={[styles.content, { backgroundColor: colors.card, borderColor: colors.border }]}
          onPress={() => {}}
        >
          <Text style={[styles.title, { color: colors.text }]}>⚠️ Danger Zone</Text>

          <View style={[styles.separator, { backgroundColor: colors.border }]} />

          <Text style={[styles.warningLine, { color: colors.text }]}>
            You are treading into a dangerous threshold:{' '}
            <Text style={styles.dangerNumber}>{chapterCount}</Text>
          </Text>

          <Text style={[styles.body, { color: colors.textSecondary }]}>
            Batches this large push the app well past what it&apos;s built to safely handle in a
            single run. Here&apos;s what you&apos;re risking the longer it goes:
          </Text>

          <View style={styles.riskList}>
            <Text style={[styles.riskItem, { color: colors.textSecondary }]}>
              • Losing all download progress if the app crashes mid-run
            </Text>
            <Text style={[styles.riskItem, { color: colors.textSecondary }]}>
              • Draining your battery much faster from sustained network activity
            </Text>
            <Text style={[styles.riskItem, { color: colors.textSecondary }]}>
              • Consuming more RAM, which can force the OS to kill the app
            </Text>
            <Text style={[styles.riskItem, { color: colors.textSecondary }]}>
              • Corrupting some chapter files if a write gets interrupted
            </Text>
          </View>

          <Text style={[styles.body, { color: colors.textSecondary }]}>
            {CHAPTER_LIMIT_MAX} chapters is the hard ceiling. Only push this close to it if
            you&apos;re confident about your device and connection.
          </Text>

          <View style={styles.buttons}>
            <Pressable
              style={[styles.btn, styles.lowerBtn, { borderColor: colors.border }]}
              onPress={onLower}
            >
              <Text style={[styles.btnText, { color: colors.text }]}>Lower It</Text>
            </Pressable>
            <Pressable style={[styles.btn, styles.proceedBtn]} onPress={onProceed}>
              <Text style={[styles.btnText, { color: '#FFFFFF' }]}>Proceed Anyway</Text>
            </Pressable>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.6)',
    paddingHorizontal: 20,
  },
  content: {
    width: '100%',
    maxWidth: 420,
    borderRadius: 18,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 18,
    paddingVertical: 20,
  },
  title: {
    fontFamily: 'Inter_700Bold',
    fontSize: 19,
    textAlign: 'center',
  },
  separator: {
    height: StyleSheet.hairlineWidth,
    width: '100%',
    marginTop: 12,
    marginBottom: 16,
  },
  warningLine: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 15,
    textAlign: 'center',
    marginBottom: 14,
    lineHeight: 21,
  },
  dangerNumber: {
    fontFamily: 'Inter_700Bold',
    color: Colors.error,
    fontSize: 18,
  },
  body: {
    fontFamily: 'Inter_400Regular',
    fontSize: 13,
    lineHeight: 19,
    marginBottom: 10,
  },
  riskList: {
    marginBottom: 10,
    gap: 6,
  },
  riskItem: {
    fontFamily: 'Inter_400Regular',
    fontSize: 13,
    lineHeight: 19,
  },
  buttons: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 8,
  },
  btn: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 12,
    alignItems: 'center',
  },
  lowerBtn: {
    borderWidth: StyleSheet.hairlineWidth,
  },
  proceedBtn: {
    backgroundColor: Colors.error,
  },
  btnText: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 14,
  },
});

