import React, { useEffect, useRef } from 'react';
import { View, Text, StyleSheet, Animated } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useLibrary } from '@/context/LibraryContext';
import { useTheme } from '@/context/ThemeContext';

export function InitScreen() {
  const { initSteps, initComplete } = useLibrary();
  const { colors } = useTheme();
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const slideAnim = useRef(new Animated.Value(30)).current;

  useEffect(() => {
    if (initComplete) {
      Animated.parallel([
        Animated.timing(fadeAnim, {
          toValue: 1,
          duration: 600,
          useNativeDriver: true,
        }),
        Animated.timing(slideAnim, {
          toValue: 0,
          duration: 600,
          useNativeDriver: true,
        }),
      ]).start();
    }
  }, [initComplete, fadeAnim, slideAnim]);

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'running':
        return 'sync-outline';
      case 'done':
        return 'checkmark-circle';
      case 'error':
        return 'alert-circle';
      default:
        return 'ellipse-outline';
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'running':
        return colors.accent;
      case 'done':
        return '#27AE60';
      case 'error':
        return '#FF4444';
      default:
        return colors.textMuted;
    }
  };

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <Animated.View
        style={[
          styles.content,
          {
            opacity: fadeAnim,
            transform: [{ translateY: slideAnim }],
          },
        ]}
      >
        <Ionicons name="book-outline" size={64} color={colors.accent} style={styles.icon} />
        <Text style={[styles.title, { color: colors.text }]}>Novel DR</Text>

        <View style={styles.stepsContainer}>
          {initSteps.map((step) => (
            <View key={step.id} style={styles.stepRow}>
              <Ionicons
                name={getStatusIcon(step.status)}
                size={18}
                color={getStatusColor(step.status)}
                style={[step.status === 'running' && styles.spinning]}
              />
              <View style={styles.stepTextContainer}>
                <Text style={[styles.stepMessage, { color: colors.text }]}>{step.message}</Text>
                {step.detail && (
                  <Text style={[styles.stepDetail, { color: colors.textSecondary }]}>
                    {step.detail}
                  </Text>
                )}
              </View>
            </View>
          ))}
        </View>

        {!initComplete && (
          <Text style={[styles.loadingText, { color: colors.textSecondary }]}>
            Preparing your library...
          </Text>
        )}
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 40,
  },
  content: {
    alignItems: 'center',
    width: '100%',
    maxWidth: 400,
  },
  icon: {
    marginBottom: 16,
  },
  title: {
    fontFamily: 'Inter_700Bold',
    fontSize: 28,
    marginBottom: 32,
  },
  stepsContainer: {
    width: '100%',
    gap: 12,
  },
  stepRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
  },
  stepTextContainer: {
    flex: 1,
  },
  stepMessage: {
    fontFamily: 'Inter_500Medium',
    fontSize: 14,
    lineHeight: 20,
  },
  stepDetail: {
    fontFamily: 'Inter_400Regular',
    fontSize: 12,
    marginTop: 2,
  },
  spinning: {
    // Rotation animation could be added
  },
  loadingText: {
    fontFamily: 'Inter_400Regular',
    fontSize: 13,
    marginTop: 24,
  },
});

