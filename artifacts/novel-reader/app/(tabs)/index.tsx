import { Ionicons } from "@expo/vector-icons";
import { Image } from "expo-image";
import * as Haptics from "expo-haptics";
import { router } from "expo-router";
import Constants from "expo-constants";
import React, { useState, useMemo } from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Modal,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import Animated, {
  cancelAnimation,
  Easing,
  FadeIn,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withSpring,
  withTiming,
  runOnJS,
} from "react-native-reanimated";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import { downloadApk, installApk } from "@/hooks/useUpdateChecker";
import { useUpdateContext } from "@/context/UpdateContext";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useLibrary, Novel, NovelStatus } from "@/context/LibraryContext";
import { useTheme } from "@/context/ThemeContext";

// ── Helper: Extract readable source name from URL ───────────────────────────
const getSourceDisplayName = (sourceUrl: string): string => {
  try {
    const domain = new URL(sourceUrl).hostname;
    const clean = domain.replace("www.", "");
    const siteNames: Record<string, string> = {
      "freewebnovel.com": "FreeWebNovelCom",
      "freewebnovel.org": "FreeWebNovelOrg",
      "bednovel.com": "BedNovelCom",
      "readnovelfull.com": "ReadNovelFull",
      "novelfull.net": "NovelFullNet",
      "novelfull.com": "NovelFullCom",
      "allnovel.org": "AllNovel",
      "novgo.net": "NovGoNet",
      "lightnovelworld.org": "LightNovelWorld",
      "wuxiaworld.site": "WuxiaWorldSite",
      "asianovel.net": "AsiaNovel",
      "novelphoenix.com": "NovelPhoenix",
      "novelarrow.com": "NovelArrow",
      "novel-bin.com": "Novel-Bin",
      "novelbin.cc": "NovelBinCC",
    };
    return siteNames[clean] || clean.split(".")[0];
  } catch {
    return "Unknown";
  }
};

// ── Status config ────────────────────────────────────────────────────────────

const STATUS_CONFIG: Record<
  NovelStatus,
  { label: string; color: string; icon: string }
> = {
  unread: { label: "Unread", color: "#8B8B8B", icon: "bookmark-outline" },
  reading: { label: "Reading", color: "#4A90E2", icon: "book-outline" },
  completed: {
    label: "Completed",
    color: "#27AE60",
    icon: "checkmark-circle-outline",
  },
};

const FILTER_TABS: { key: NovelStatus | "all"; label: string }[] = [
  { key: "all", label: "All" },
  { key: "unread", label: "Unread" },
  { key: "reading", label: "Reading" },
  { key: "completed", label: "Completed" },
];

// ── NovelCard ────────────────────────────────────────────────────────────────

function NovelCard({
  novel,
  onPress,
  onLongPress,
  isSelected,
  selectionMode,
}: {
  novel: Novel;
  onPress: () => void;
  onLongPress: () => void;
  isSelected: boolean;
  selectionMode: boolean;
}) {
  const { colors } = useTheme();
  const scale = useSharedValue(1);
  const animStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));

  const totalChapters = novel.chapters.length;
  const currentChapter = novel.lastRead ? novel.lastRead.chapterIndex + 1 : 0;
  const progressPercent =
    totalChapters > 0 ? (currentChapter / totalChapters) * 100 : 0;

  const status = novel.status ?? "unread";
  const statusCfg = STATUS_CONFIG[status];
  const sourceName = getSourceDisplayName(novel.sourceUrl);

  return (
    <Pressable
      onPress={() => {
        scale.value = withSpring(1, { damping: 15 });
        onPress();
      }}
      onLongPress={() => {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
        onLongPress();
      }}
      onPressIn={() => {
        scale.value = withSpring(0.97, { damping: 15 });
      }}
      onPressOut={() => {
        scale.value = withSpring(1, { damping: 15 });
      }}
    >
      <Animated.View
        style={[
          styles.card,
          {
            backgroundColor: isSelected ? colors.accent + "20" : colors.card,
            borderColor: isSelected ? colors.accent : colors.border,
          },
          animStyle,
        ]}
      >
        {/* Selection mode checkbox */}
        {selectionMode && (
          <View style={styles.checkboxContainer}>
            <Ionicons
              name={isSelected ? "checkbox" : "square-outline"}
              size={24}
              color={isSelected ? colors.accent : colors.textSecondary}
            />
          </View>
        )}

        {/* Cover Image - Left side */}
        <View style={styles.coverContainer}>
          {novel.coverUrl ? (
            <Image
              source={{ uri: novel.coverUrl }}
              style={styles.cover}
              contentFit="cover"
            />
          ) : (
            <View
              style={[
                styles.coverPlaceholder,
                { backgroundColor: colors.surface },
              ]}
            >
              <Ionicons name="book" size={28} color={colors.accent} />
            </View>
          )}
        </View>

        {/* Right side content */}
        <View style={styles.info}>
          {/* Title row with status badge */}
          <View style={styles.titleRow}>
            <Text
              style={[styles.title, { color: colors.text }]}
              numberOfLines={2}
            >
              {novel.title}
            </Text>
            <View
              style={[
                styles.statusBadge,
                { backgroundColor: statusCfg.color + "22" },
              ]}
            >
              <View
                style={[styles.statusDot, { backgroundColor: statusCfg.color }]}
              />
              <Text style={[styles.statusText, { color: statusCfg.color }]}>
                {statusCfg.label}
              </Text>
            </View>
          </View>

          {/* Author row */}
          <View style={styles.metaRow}>
            <Text style={[styles.authorLabel, { color: colors.textSecondary }]}>
              Author:
            </Text>
            <Text
              style={[styles.author, { color: colors.textSecondary }]}
              numberOfLines={1}
            >
              {novel.author}
            </Text>
          </View>

          {/* Source row */}
          <View style={styles.metaRow}>
            <Text style={[styles.sourceLabel, { color: colors.textMuted }]}>
              Source:
            </Text>
            <Text
              style={[styles.source, { color: colors.textMuted }]}
              numberOfLines={1}
            >
              {sourceName}
            </Text>
          </View>

          {/* Progress row with button */}
          <View style={styles.progressRow}>
            <View style={styles.progressLeft}>
              <Text
                style={[styles.progressText, { color: colors.textSecondary }]}
              >
                Ch. {currentChapter}/{totalChapters}
              </Text>
              <View style={styles.progressBarContainer}>
                <View
                  style={[
                    styles.progressBar,
                    {
                      width: `${progressPercent}%`,
                      backgroundColor: colors.accent,
                    },
                  ]}
                />
              </View>
            </View>

            <Pressable
              style={[
                styles.continueButton,
                { backgroundColor: colors.accent },
              ]}
              onPress={() => {
                router.push({
                  pathname: "/novel/[id]",
                  params: { id: novel.id },
                });
              }}
            >
              <Text style={styles.continueButtonText}>
                {currentChapter === 0 ? "Read" : "Continue"}
              </Text>
            </Pressable>
          </View>
        </View>
      </Animated.View>
    </Pressable>
  );
}

// ── Status Picker Sheet ──────────────────────────────────────────────────────

function StatusSheet({
  novel,
  visible,
  onClose,
  onSelect,
}: {
  novel: Novel | null;
  visible: boolean;
  onClose: () => void;
  onSelect: (status: NovelStatus) => void;
}) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const bottomPad = Platform.OS === "web" ? 34 : insets.bottom;
  if (!novel) return null;

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
    >
      <Pressable style={styles.sheetBackdrop} onPress={onClose} />
      <View
        style={[
          styles.sheet,
          { backgroundColor: colors.card, paddingBottom: bottomPad + 20 },
        ]}
      >
        <View
          style={[styles.sheetHandle, { backgroundColor: colors.border }]}
        />
        <Text
          style={[styles.sheetTitle, { color: colors.text }]}
          numberOfLines={1}
        >
          {novel.title}
        </Text>
        <Text style={[styles.sheetSub, { color: colors.textSecondary }]}>
          Set reading status
        </Text>

        {(Object.keys(STATUS_CONFIG) as NovelStatus[]).map((key) => {
          const cfg = STATUS_CONFIG[key];
          const active = (novel.status ?? "unread") === key;
          return (
            <Pressable
              key={key}
              style={[
                styles.sheetOption,
                {
                  backgroundColor: active ? cfg.color + "18" : "transparent",
                  borderColor: active ? cfg.color : colors.border,
                },
              ]}
              onPress={() => {
                Haptics.selectionAsync();
                onSelect(key);
              }}
            >
              <Ionicons
                name={cfg.icon as any}
                size={20}
                color={active ? cfg.color : colors.textSecondary}
              />
              <Text
                style={[
                  styles.sheetOptionText,
                  { color: active ? cfg.color : colors.text },
                ]}
              >
                {cfg.label}
              </Text>
              {active && (
                <Ionicons
                  name="checkmark"
                  size={18}
                  color={cfg.color}
                  style={{ marginLeft: "auto" }}
                />
              )}
            </Pressable>
          );
        })}

        <Pressable
          style={[styles.sheetCancel, { borderColor: colors.border }]}
          onPress={onClose}
        >
          <Text
            style={[styles.sheetCancelText, { color: colors.textSecondary }]}
          >
            Cancel
          </Text>
        </Pressable>
      </View>
    </Modal>
  );
}

// ── LibraryScreen ────────────────────────────────────────────────────────────

export default function LibraryScreen() {
  const { novels, removeNovels, loading, setNovelStatus, refreshLibrary } =
    useLibrary();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();

  const topPad = Platform.OS === "web" ? 67 : insets.top;
  const bottomPad = Platform.OS === "web" ? 34 : insets.bottom;

  const [activeFilter, setActiveFilter] = useState<NovelStatus | "all">("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [showSearch, setShowSearch] = useState(false);

  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedNovels, setSelectedNovels] = useState<string[]>([]);
  const [confirmDeleteVisible, setConfirmDeleteVisible] = useState(false);

  const [statusSheetNovel, setStatusSheetNovel] = useState<Novel | null>(null);

  // ── Force re‑render of list on refresh ────────────────────────────────────
  const [refreshKey, setRefreshKey] = useState(0);
  // ── Invisible modal trick (optional fallback) ─────────────────────────────
  const [dummyModalVisible, setDummyModalVisible] = useState(false);

  // ── Refresh state ──────────────────────────────────────────────────────────
  const [refreshing, setRefreshing] = useState(false);
  const fabRotation = useSharedValue(0);

  // ── Update checker (shared across Library + Settings via UpdateContext) ────
  const { updateInfo, skipVersion: skipUpdateVersion } = useUpdateContext();
  const [updateModalVisible, setUpdateModalVisible] = useState(false);
  const [updatePhase, setUpdatePhase] = useState<
    "idle" | "downloading" | "ready" | "installing"
  >("idle");
  const [updateProgress, setUpdateProgress] = useState(0);
  const [localApkUri, setLocalApkUri] = useState<string | null>(null);

  const handleDownloadUpdate = async () => {
    if (!updateInfo) return;
    setUpdatePhase("downloading");
    setUpdateProgress(0);
    try {
      const uri = await downloadApk(updateInfo, setUpdateProgress);
      setLocalApkUri(uri);
      setUpdatePhase("ready");
    } catch {
      setUpdatePhase("idle");
      Alert.alert(
        "Download failed",
        "Could not download the update. Check your connection and try again.",
      );
    }
  };

  const handleApplyUpdate = async () => {
    if (!localApkUri) return;
    setUpdatePhase("installing");
    try {
      await installApk(localApkUri);
      // Android takes over from here — the app backgrounds while the installer runs.
      // If "Install unknown apps" isn't granted yet, Android shows its own system
      // prompt at this point automatically, before the installer screen appears.
    } catch {
      setUpdatePhase("ready");
      Alert.alert("Install failed", "Could not open the installer.");
    }
  };

  const handleSkipVersion = async () => {
    await skipUpdateVersion();
    setUpdateModalVisible(false);
    setUpdatePhase("idle");
    setLocalApkUri(null);
  };

  const closeUpdateModal = () => {
    // Session-only close — doesn't dismiss the tag, so it'll show again next cold start
    setUpdateModalVisible(false);
  };
  const fabSpinStyle = useAnimatedStyle(() => ({
    transform: [{ rotate: `${fabRotation.value}deg` }],
  }));

  const startSpin = () => {
    fabRotation.value = 0;
    fabRotation.value = withRepeat(
      withTiming(360, { duration: 600, easing: Easing.linear }),
      -1,
      false,
    );
  };

  const stopSpin = () => {
    cancelAnimation(fabRotation);
    fabRotation.value = withTiming(0, { duration: 200 });
  };

  const handleRefresh = async () => {
    if (refreshing) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setRefreshing(true);
    startSpin();
    try {
      await refreshLibrary();
    } finally {
      stopSpin();
      setRefreshing(false);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);

      // ── Force a complete remount of the FlatList ──
      setRefreshKey((prev) => prev + 1);
      // (Optional) invisible modal as extra insurance
      setDummyModalVisible(true);
      setTimeout(() => setDummyModalVisible(false), 100);
    }
  };

  // ── Swipe Animation Values ─────────────────────────────────────────────────
  const translateX = useSharedValue(0);
  const filterKeys = FILTER_TABS.map((tab) => tab.key);

  const changeFilterSwipe = (direction: "left" | "right") => {
    const currentIndex = filterKeys.indexOf(activeFilter);
    let newIndex: number;

    if (direction === "left" && currentIndex < filterKeys.length - 1) {
      newIndex = currentIndex + 1;
    } else if (direction === "right" && currentIndex > 0) {
      newIndex = currentIndex - 1;
    } else {
      return;
    }

    setActiveFilter(filterKeys[newIndex] as NovelStatus | "all");
    Haptics.selectionAsync();
  };

  const panGesture = Gesture.Pan()
    .activeOffsetX([-10, 10])
    .failOffsetY([-10, 10])
    .onUpdate((event) => {
      translateX.value = event.translationX * 0.5;
    })
    .onEnd((event) => {
      const threshold = 60;

      if (event.translationX < -threshold) {
        runOnJS(changeFilterSwipe)("left");
      } else if (event.translationX > threshold) {
        runOnJS(changeFilterSwipe)("right");
      }

      translateX.value = withSpring(0, {
        damping: 80,
        stiffness: 150,
        mass: 0.5,
        overshootClamping: true,
      });
    });

  const animatedContentStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: translateX.value }],
    opacity: 1 - Math.abs(translateX.value) / 300,
  }));

  // ── Filtered novels ────────────────────────────────────────────────────────
  const filteredNovels = useMemo(() => {
    let result =
      activeFilter === "all"
        ? novels
        : novels.filter((n) => (n.status ?? "unread") === activeFilter);

    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase().trim();
      result = result.filter(
        (n) =>
          n.title.toLowerCase().includes(query) ||
          n.author.toLowerCase().includes(query),
      );
    }

    return result;
  }, [novels, activeFilter, searchQuery]);

  const counts = {
    all: novels.length,
    unread: novels.filter((n) => (n.status ?? "unread") === "unread").length,
    reading: novels.filter((n) => (n.status ?? "unread") === "reading").length,
    completed: novels.filter((n) => (n.status ?? "unread") === "completed")
      .length,
  };

  // ── Selection helpers ──────────────────────────────────────────────────────
  const enterSelectionMode = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setSelectionMode(true);
    setSelectedNovels([]);
    setShowSearch(false);
    setSearchQuery("");
  };

  const exitSelectionMode = () => {
    setSelectionMode(false);
    setSelectedNovels([]);
  };

  const toggleNovelSelection = (novelId: string) => {
    setSelectedNovels((prev) =>
      prev.includes(novelId)
        ? prev.filter((id) => id !== novelId)
        : [...prev, novelId],
    );
  };

  const showFirstConfirmation = () => {
    if (selectedNovels.length === 0) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    Alert.alert(
      "Confirm Deletion",
      `Remove ${selectedNovels.length} novel(s) from your Library?`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: () => setConfirmDeleteVisible(true),
        },
      ],
    );
  };

  const performBatchDelete = async () => {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
    setConfirmDeleteVisible(false);
    await removeNovels(selectedNovels);
    setSelectionMode(false);
    setSelectedNovels([]);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  };

  const handleNovelPress = (novel: Novel) => {
    if (selectionMode) {
      toggleNovelSelection(novel.id);
    } else {
      router.push({ pathname: "/novel/[id]", params: { id: novel.id } });
    }
  };

  const handleNovelLongPress = (novel: Novel) => {
    if (selectionMode) {
      toggleNovelSelection(novel.id);
    } else {
      setStatusSheetNovel(novel);
    }
  };

  const handleStatusSelect = async (status: NovelStatus) => {
    if (!statusSheetNovel) return;
    await setNovelStatus(statusSheetNovel.id, status);
    setStatusSheetNovel(null);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  };

  const toggleSearch = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setShowSearch(!showSearch);
    if (!showSearch) setSearchQuery("");
  };

  // ── Render helpers ─────────────────────────────────────────────────────────
  const renderHeader = () => (
    <View
      style={[
        styles.header,
        {
          paddingTop: topPad + 12,
          borderBottomColor: colors.border,
          backgroundColor: colors.background,
        },
      ]}
    >
      <View>
        <Text style={[styles.headerTitle, { color: colors.text }]}>
          Novel DR
        </Text>
        <Text style={[styles.headerSub, { color: colors.textSecondary }]}>
          {filteredNovels.length}{" "}
          {filteredNovels.length === 1 ? "novel" : "novels"}
          {searchQuery ? ` (filtered from ${novels.length})` : ""}
        </Text>
      </View>
      <View style={styles.headerButtons}>
        <Pressable onPress={toggleSearch} style={styles.iconButton}>
          <Ionicons
            name={showSearch ? "close" : "search"}
            size={24}
            color={colors.text}
          />
        </Pressable>
        <Pressable onPress={enterSelectionMode} style={styles.iconButton}>
          <Ionicons name="ellipsis-vertical" size={24} color={colors.text} />
        </Pressable>
      </View>
    </View>
  );

  const renderSearchBar = () => (
    <Animated.View
      entering={FadeIn}
      style={[
        styles.searchContainer,
        { backgroundColor: colors.surface, borderBottomColor: colors.border },
      ]}
    >
      <View
        style={[
          styles.searchInputContainer,
          { backgroundColor: colors.background, borderColor: colors.border },
        ]}
      >
        <Ionicons name="search" size={20} color={colors.textSecondary} />
        <TextInput
          style={[styles.searchInput, { color: colors.text }]}
          placeholder="Search by title or author..."
          placeholderTextColor={colors.textMuted}
          value={searchQuery}
          onChangeText={setSearchQuery}
          autoFocus
        />
        {searchQuery.length > 0 && (
          <Pressable onPress={() => setSearchQuery("")}>
            <Ionicons
              name="close-circle"
              size={20}
              color={colors.textSecondary}
            />
          </Pressable>
        )}
      </View>
      <Text style={[styles.searchResultText, { color: colors.textSecondary }]}>
        Found {filteredNovels.length} result
        {filteredNovels.length !== 1 ? "s" : ""}
      </Text>
    </Animated.View>
  );

  const renderSelectionHeader = () => (
    <View
      style={[
        styles.selectionHeader,
        {
          backgroundColor: colors.surface,
          borderBottomColor: colors.border,
          paddingTop: topPad + 12,
        },
      ]}
    >
      <Pressable onPress={exitSelectionMode} style={styles.iconButton}>
        <Ionicons name="arrow-back" size={24} color={colors.text} />
      </Pressable>
      <Text style={[styles.selectionTitle, { color: colors.text }]}>
        Selected: {selectedNovels.length}
      </Text>
      {selectedNovels.length > 0 && (
        <Pressable onPress={showFirstConfirmation} style={styles.iconButton}>
          <Ionicons name="trash-outline" size={24} color={colors.text} />
        </Pressable>
      )}
    </View>
  );

  const renderFilterTabs = () => (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      style={[
        styles.filterBar,
        {
          backgroundColor: colors.background,
          borderBottomColor: colors.border,
        },
      ]}
      contentContainerStyle={styles.filterBarContent}
    >
      {FILTER_TABS.map((tab) => {
        const active = activeFilter === tab.key;
        const color =
          tab.key !== "all"
            ? STATUS_CONFIG[tab.key as NovelStatus].color
            : colors.accent;
        return (
          <Pressable
            key={tab.key}
            style={[
              styles.filterTab,
              {
                backgroundColor: active ? color + "18" : "transparent",
                borderColor: active ? color : colors.border,
              },
            ]}
            onPress={() => {
              Haptics.selectionAsync();
              setActiveFilter(tab.key as any);
            }}
          >
            <Text
              style={[
                styles.filterTabText,
                { color: active ? color : colors.textSecondary },
              ]}
            >
              {tab.label}
            </Text>
            <View
              style={[
                styles.filterCount,
                { backgroundColor: active ? color : colors.surface },
              ]}
            >
              <Text
                style={[
                  styles.filterCountText,
                  { color: active ? "#fff" : colors.textMuted },
                ]}
              >
                {counts[tab.key as keyof typeof counts]}
              </Text>
            </View>
          </Pressable>
        );
      })}
    </ScrollView>
  );

  const renderEmptyState = () => {
    const isFiltered = searchQuery || activeFilter !== "all";

    if (novels.length === 0) {
      return (
        <View style={styles.emptyState}>
          <Image
            source={require("@/assets/images/shook.png")}
            style={styles.shookImg}
            contentFit="contain"
          />
          <Text style={[styles.emptyTitle, { color: colors.text }]}>
            Your library is empty
          </Text>
          <Text style={[styles.emptySubtitle, { color: colors.textSecondary }]}>
            Head to the Download tab to add your first novel
          </Text>
          <Pressable
            style={[styles.addBtn, { backgroundColor: colors.accent }]}
            onPress={() => router.push("/(tabs)/add")}
          >
            <Ionicons name="add" size={18} color="#fff" />
            <Text style={styles.addBtnText}>Add Novel</Text>
          </Pressable>
        </View>
      );
    }

    return (
      <View style={styles.emptyState}>
        <Image
          source={require("@/assets/images/shook.png")}
          style={styles.shookImg}
          contentFit="contain"
        />
        <Text style={[styles.emptyTitle, { color: colors.text }]}>
          No novels found
        </Text>
        <Text style={[styles.emptySubtitle, { color: colors.textSecondary }]}>
          {searchQuery
            ? `No novels matching "${searchQuery}"`
            : `No novels marked as "${FILTER_TABS.find((t) => t.key === activeFilter)?.label}" yet.`}
        </Text>
        {isFiltered && (
          <Pressable
            style={[
              styles.clearBtn,
              { backgroundColor: colors.surface, borderColor: colors.border },
            ]}
            onPress={() => {
              setSearchQuery("");
              setActiveFilter("all");
              setShowSearch(false);
            }}
          >
            <Text style={[styles.clearBtnText, { color: colors.text }]}>
              Clear Filters
            </Text>
          </Pressable>
        )}
      </View>
    );
  };

  const renderContent = () => {
    if (!loading && filteredNovels.length === 0) {
      return renderEmptyState();
    }

    return (
      <FlatList
        key={refreshKey} // <-- forces a full remount when refreshed
        data={filteredNovels}
        keyExtractor={(n) => n.id}
        renderItem={({ item, index }) => (
          <Animated.View entering={FadeIn.delay(index * 50)}>
            <NovelCard
              novel={item}
              onPress={() => handleNovelPress(item)}
              onLongPress={() => handleNovelLongPress(item)}
              isSelected={selectedNovels.includes(item.id)}
              selectionMode={selectionMode}
            />
          </Animated.View>
        )}
        contentContainerStyle={{
          padding: 16,
          paddingBottom: bottomPad + 90,
          gap: 12,
        }}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={handleRefresh}
            tintColor={colors.accent}
            colors={[colors.accent]}
          />
        }
      />
    );
  };

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      {/* Top chrome */}
      <View style={styles.topChrome}>
        {selectionMode ? renderSelectionHeader() : renderHeader()}
        {showSearch && !selectionMode && renderSearchBar()}
        {!selectionMode && renderFilterTabs()}
      </View>

      {/* Swipeable Content Area */}
      {!selectionMode && !showSearch ? (
        <GestureDetector gesture={panGesture}>
          <Animated.View style={[{ flex: 1 }, animatedContentStyle]}>
            {renderContent()}
          </Animated.View>
        </GestureDetector>
      ) : (
        <View style={{ flex: 1 }}>{renderContent()}</View>
      )}

      {/* ── Floating Refresh Button (FAB) – REMOVED ── */}

      {/* ── Update Notification Bell — only shown when a newer release exists ── */}
      {!selectionMode && updateInfo && (
        <Pressable
          style={[
            styles.fab,
            {
              backgroundColor: colors.card,
              borderColor: colors.accent,
              bottom: bottomPad + 90 + 44 + 12, // sits just above the reload FAB
            },
          ]}
          onPress={() => setUpdateModalVisible(true)}
        >
          <Ionicons name="notifications" size={20} color={colors.accent} />
          <View
            style={[
              styles.updateBadgeDot,
              { backgroundColor: colors.error, borderColor: colors.card },
            ]}
          />
        </Pressable>
      )}

      {/* ── Floating Refresh Button (FAB) ── */}
      {!selectionMode && (
        <Pressable
          style={[
            styles.fab,
            {
              backgroundColor: colors.card,
              borderColor: colors.accent,
              bottom: bottomPad + 90,
            },
          ]}
          onPress={handleRefresh}
        >
          <Animated.View style={fabSpinStyle}>
            <Ionicons name="refresh" size={22} color={colors.text} />
          </Animated.View>
        </Pressable>
      )}

      {/* Batch Delete Confirmation Modal */}
      <Modal
        visible={confirmDeleteVisible}
        transparent={true}
        animationType="fade"
        onRequestClose={() => setConfirmDeleteVisible(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={[styles.modalContent, { backgroundColor: colors.card }]}>
            <Ionicons
              name="alert-circle"
              size={48}
              color={colors.text}
              style={styles.modalIcon}
            />
            <Text style={[styles.modalTitle, { color: colors.text }]}>
              Confirm Deletion
            </Text>
            <Text
              style={[styles.modalMessage, { color: colors.textSecondary }]}
            >
              This will permanently delete {selectedNovels.length} novel(s) and
              all related chapters.{"\n\n"}
              Are you sure about this? {"\n\n"}
              If YES, click the &apos;DELETE&apos; button.
            </Text>

            <View style={styles.modalButtons}>
              <Pressable
                style={[
                  styles.modalButton,
                  styles.modalCancelButton,
                  { borderColor: colors.border },
                ]}
                onPress={() => setConfirmDeleteVisible(false)}
              >
                <Text
                  style={[
                    styles.modalButtonText,
                    { color: colors.textSecondary },
                  ]}
                >
                  Cancel
                </Text>
              </Pressable>
              <Pressable
                style={[
                  styles.modalButton,
                  styles.modalDeleteButton,
                  { backgroundColor: "#FF4444" },
                ]}
                onPress={performBatchDelete}
              >
                <Text style={[styles.modalButtonText, { color: "#fff" }]}>
                  DELETE
                </Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>

      {/* Status Picker Sheet */}
      <StatusSheet
        novel={statusSheetNovel}
        visible={!!statusSheetNovel}
        onClose={() => setStatusSheetNovel(null)}
        onSelect={handleStatusSelect}
      />

      {/* ── INVISIBLE DUMMY MODAL (optional fallback) ── */}
      <Modal visible={dummyModalVisible} transparent animationType="none">
        <View style={{ flex: 1, backgroundColor: "transparent" }} />
      </Modal>

      {/* Update Available Modal */}
      <Modal
        visible={updateModalVisible}
        transparent
        animationType="fade"
        onRequestClose={closeUpdateModal}
      >
        <View style={styles.modalOverlay}>
          <View
            style={[
              styles.updateModalCard,
              { backgroundColor: colors.card, borderColor: colors.border },
            ]}
          >
            <View style={styles.updateModalHeader}>
              <Text style={[styles.updateModalTitle, { color: colors.text }]}>
                Update available
              </Text>
              {updatePhase === "idle" && (
                <Pressable onPress={closeUpdateModal}>
                  <Ionicons
                    name="close"
                    size={22}
                    color={colors.textSecondary}
                  />
                </Pressable>
              )}
            </View>

            <Text
              style={[styles.updateVersionRow, { color: colors.textMuted }]}
            >
              v{Constants.expoConfig?.version ?? "?"} → {updateInfo?.tag ?? ""}
            </Text>

            <ScrollView
              style={[
                styles.updateNotesBox,
                { backgroundColor: colors.surface, borderColor: colors.border },
              ]}
              showsVerticalScrollIndicator={false}
            >
              <Text
                style={[
                  styles.updateNotesText,
                  { color: colors.textSecondary },
                ]}
              >
                {updateInfo?.notes?.trim() || "No release notes provided."}
              </Text>
            </ScrollView>

            {updatePhase === "idle" && (
              <Pressable
                style={[
                  styles.updateActionBtn,
                  { backgroundColor: colors.accent },
                ]}
                onPress={handleDownloadUpdate}
              >
                <Text style={styles.updateActionBtnText}>Download update</Text>
              </Pressable>
            )}

            {updatePhase === "downloading" && (
              <View
                style={[
                  styles.updateProgressTrack,
                  { backgroundColor: colors.surface },
                ]}
              >
                <View
                  style={[
                    styles.updateProgressFill,
                    {
                      width: `${updateProgress}%`,
                      backgroundColor: colors.accent,
                    },
                  ]}
                />
                <Text
                  style={[styles.updateProgressLabel, { color: colors.text }]}
                >
                  {updateProgress}%
                </Text>
              </View>
            )}

            {updatePhase === "ready" && (
              <Pressable
                style={[
                  styles.updateActionBtn,
                  { backgroundColor: colors.accent },
                ]}
                onPress={handleApplyUpdate}
              >
                <Text style={styles.updateActionBtnText}>Apply update</Text>
              </Pressable>
            )}

            {updatePhase === "installing" && (
              <View
                style={[
                  styles.updateActionBtn,
                  {
                    backgroundColor: colors.accent,
                    flexDirection: "row",
                    gap: 8,
                  },
                ]}
              >
                <ActivityIndicator size="small" color="#fff" />
                <Text style={styles.updateActionBtnText}>
                  Opening installer...
                </Text>
              </View>
            )}

            {updatePhase === "idle" && (
              <View style={styles.updateSecondaryRow}>
                <Pressable onPress={closeUpdateModal}>
                  <Text
                    style={[
                      styles.updateSecondaryText,
                      { color: colors.textMuted },
                    ]}
                  >
                    Remind me later
                  </Text>
                </Pressable>
                <Pressable onPress={handleSkipVersion}>
                  <Text
                    style={[
                      styles.updateSecondaryText,
                      { color: colors.textMuted },
                    ]}
                  >
                    Skip this version
                  </Text>
                </Pressable>
              </View>
            )}
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },

  topChrome: { flexShrink: 0 },

  // header
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 20,
    paddingBottom: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  headerTitle: { fontFamily: "Inter_700Bold", fontSize: 28 },
  headerSub: { fontFamily: "Inter_400Regular", fontSize: 13, marginTop: 2 },
  headerButtons: { flexDirection: "row", alignItems: "center", gap: 8 },
  iconButton: { padding: 8 },

  // selection header
  selectionHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingBottom: 14,
    borderBottomWidth: 1,
  },
  selectionTitle: { fontFamily: "Inter_600SemiBold", fontSize: 18 },

  // search bar
  searchContainer: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    gap: 8,
  },
  searchInputContainer: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 10,
    borderWidth: 1,
  },
  searchInput: {
    flex: 1,
    fontFamily: "Inter_400Regular",
    fontSize: 16,
    paddingVertical: 4,
  },
  searchResultText: {
    fontFamily: "Inter_400Regular",
    fontSize: 12,
    paddingLeft: 4,
  },

  // filter bar
  filterBar: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexGrow: 0,
    flexShrink: 0,
  },
  filterBarContent: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    gap: 8,
    flexDirection: "row",
  },
  filterTab: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 20,
    borderWidth: 1,
    flexShrink: 0,
  },
  filterTabText: { fontFamily: "Inter_600SemiBold", fontSize: 13 },
  filterCount: {
    minWidth: 20,
    height: 20,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 5,
  },
  filterCountText: { fontFamily: "Inter_600SemiBold", fontSize: 11 },

  // Updated card styles
  card: {
    flexDirection: "row",
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: "hidden",
    padding: 12,
    gap: 12,
  },
  checkboxContainer: { marginRight: 4 },
  coverContainer: {
    width: 80,
    height: 110,
    borderRadius: 8,
    overflow: "hidden",
    flexShrink: 0,
  },
  cover: { width: "100%", height: "100%" },
  coverPlaceholder: {
    width: "100%",
    height: "100%",
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 8,
  },

  info: { flex: 1, gap: 6 },

  titleRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    gap: 8,
  },
  title: { fontFamily: "Inter_700Bold", fontSize: 16, flex: 1, lineHeight: 22 },

  statusBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 12,
  },
  statusDot: { width: 6, height: 6, borderRadius: 3 },
  statusText: { fontFamily: "Inter_500Medium", fontSize: 10 },

  metaRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    flexWrap: "wrap",
  },
  authorLabel: { fontFamily: "Inter_500Medium", fontSize: 12 },
  author: { fontFamily: "Inter_400Regular", fontSize: 12, flex: 1 },
  sourceLabel: { fontFamily: "Inter_500Medium", fontSize: 11 },
  source: { fontFamily: "Inter_400Regular", fontSize: 11, flex: 1 },

  progressRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    marginTop: 4,
  },
  progressLeft: { flex: 1 },
  progressText: {
    fontFamily: "Inter_500Medium",
    fontSize: 11,
    marginBottom: 4,
  },
  progressBarContainer: {
    height: 4,
    backgroundColor: "rgba(255,255,255,0.15)",
    borderRadius: 2,
    overflow: "hidden",
  },
  progressBar: { height: "100%", borderRadius: 2 },
  continueButton: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 8,
  },
  continueButtonText: {
    fontFamily: "Inter_600SemiBold",
    fontSize: 12,
    color: "#fff",
  },

  // floating refresh button (styles kept but unused)
  fab: {
    position: "absolute",
    right: 16,
    width: 44,
    height: 44,
    borderRadius: 22,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.15,
    shadowRadius: 4,
    elevation: 4,
  },

  // empty state
  emptyState: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 40,
    gap: 12,
  },
  shookImg: { width: 120, height: 120 },
  emptyTitle: {
    fontFamily: "Inter_600SemiBold",
    fontSize: 20,
    textAlign: "center",
  },
  emptySubtitle: {
    fontFamily: "Inter_400Regular",
    fontSize: 14,
    textAlign: "center",
    lineHeight: 20,
  },
  addBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 12,
    marginTop: 8,
  },
  addBtnText: { fontFamily: "Inter_600SemiBold", fontSize: 15, color: "#fff" },
  clearBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 12,
    marginTop: 8,
    borderWidth: 1,
  },
  clearBtnText: { fontFamily: "Inter_600SemiBold", fontSize: 15 },

  // batch delete modal
  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.5)",
    justifyContent: "center",
    alignItems: "center",
  },

  // ── Update notification bell ──
  updateBadgeDot: {
    position: "absolute",
    top: 6,
    right: 6,
    width: 9,
    height: 9,
    borderRadius: 5,
    borderWidth: 1.5,
  },

  // ── Update modal ──
  updateModalCard: {
    borderRadius: 20,
    borderWidth: 1,
    padding: 20,
    gap: 4,
    width: "88%",
    maxWidth: 400,
  },
  updateModalHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  updateModalTitle: { fontFamily: "Inter_700Bold", fontSize: 18 },
  updateVersionRow: {
    fontFamily: "Inter_400Regular",
    fontSize: 12,
    marginBottom: 8,
  },
  updateNotesBox: {
    maxHeight: 160,
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
    padding: 12,
    marginBottom: 14,
  },
  updateNotesText: {
    fontFamily: "Inter_400Regular",
    fontSize: 12,
    lineHeight: 19,
  },
  updateActionBtn: {
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  updateActionBtnText: {
    fontFamily: "Inter_600SemiBold",
    fontSize: 14,
    color: "#fff",
  },
  updateProgressTrack: {
    height: 40,
    borderRadius: 10,
    overflow: "hidden",
    justifyContent: "center",
  },
  updateProgressFill: {
    position: "absolute",
    left: 0,
    top: 0,
    bottom: 0,
    borderRadius: 10,
  },
  updateProgressLabel: {
    textAlign: "center",
    fontFamily: "Inter_600SemiBold",
    fontSize: 13,
  },
  updateSecondaryRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginTop: 12,
  },
  updateSecondaryText: { fontFamily: "Inter_400Regular", fontSize: 12 },
  modalContent: {
    width: "80%",
    borderRadius: 16,
    padding: 20,
    alignItems: "center",
    gap: 12,
  },
  modalIcon: { marginBottom: 8 },
  modalTitle: { fontFamily: "Inter_700Bold", fontSize: 20 },
  modalMessage: {
    fontFamily: "Inter_400Regular",
    fontSize: 14,
    textAlign: "center",
  },
  modalButtons: { flexDirection: "row", gap: 12, marginTop: 16, width: "100%" },
  modalButton: {
    flex: 1,
    height: 44,
    borderRadius: 8,
    justifyContent: "center",
    alignItems: "center",
  },
  modalCancelButton: { borderWidth: 1 },
  modalDeleteButton: { backgroundColor: "#ff4444" },
  modalButtonText: { fontFamily: "Inter_600SemiBold", fontSize: 14 },

  // status sheet
  sheetBackdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.4)" },
  sheet: {
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: 20,
    gap: 10,
  },
  sheetHandle: {
    width: 36,
    height: 4,
    borderRadius: 2,
    alignSelf: "center",
    marginBottom: 8,
  },
  sheetTitle: { fontFamily: "Inter_700Bold", fontSize: 16 },
  sheetSub: { fontFamily: "Inter_400Regular", fontSize: 13, marginBottom: 4 },
  sheetOption: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    padding: 14,
    borderRadius: 12,
    borderWidth: 1,
  },
  sheetOptionText: { fontFamily: "Inter_600SemiBold", fontSize: 15 },
  sheetCancel: {
    marginTop: 4,
    padding: 14,
    borderRadius: 12,
    borderWidth: 1,
    alignItems: "center",
  },
  sheetCancelText: { fontFamily: "Inter_600SemiBold", fontSize: 15 },
});
