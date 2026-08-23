import React, { useState } from "react";
import {
  Modal,
  ScrollView,
  TouchableOpacity,
  View,
  Text,
  Pressable,
  FlatList,
  SafeAreaView,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { GlossaryEntry } from "@/hooks/reader/useGlossary";

interface GlossaryListModalProps {
  visible: boolean;
  entries: GlossaryEntry[];
  onEntryPress: (entry: GlossaryEntry) => void;
  onDismiss: () => void;
  onRemoveEntry?: (word: string) => Promise<void>;
}

export const GlossaryListModal = React.memo(
  ({
    visible,
    entries,
    onEntryPress,
    onDismiss,
    onRemoveEntry,
  }: GlossaryListModalProps) => {
    const insets = useSafeAreaInsets();
    const [selectedWord, setSelectedWord] = useState<string | null>(null);
    const [sortBy, setSortBy] = useState<"recent" | "alpha">("recent");

    if (!visible) {
      return null;
    }

    // Sort entries based on sortBy
    const sortedEntries =
      sortBy === "recent"
        ? [...entries].sort((a, b) => (b.added_at || 0) - (a.added_at || 0))
        : [...entries].sort((a, b) => a.word.localeCompare(b.word));

    const handleRemove = async (word: string) => {
      if (onRemoveEntry) {
        await onRemoveEntry(word);
        setSelectedWord(null);
      }
    };

    const renderEntry = ({ item }: { item: GlossaryEntry }) => (
      <Pressable
        onPress={() => onEntryPress(item)}
        style={{
          paddingHorizontal: 16,
          paddingVertical: 12,
          borderBottomWidth: 1,
          borderBottomColor: "#f0f0f0",
          backgroundColor: selectedWord === item.word ? "#f5f5f5" : "white",
        }}
      >
        <View
          style={{
            flexDirection: "row",
            justifyContent: "space-between",
            alignItems: "flex-start",
            gap: 8,
          }}
        >
          <View style={{ flex: 1 }}>
            <Text
              style={{
                fontSize: 14,
                fontWeight: "600",
                color: "#1a1a1a",
                marginBottom: 4,
              }}
            >
              {item.word}
            </Text>
            <Text
              numberOfLines={2}
              style={{
                fontSize: 12,
                color: "#666",
                lineHeight: 16,
              }}
            >
              {item.meaning}
            </Text>
            <View style={{ flexDirection: "row", gap: 6, marginTop: 4 }}>
              <View
                style={{
                  backgroundColor: "#fff3e0",
                  paddingHorizontal: 6,
                  paddingVertical: 2,
                  borderRadius: 3,
                }}
              >
                <Text
                  style={{
                    fontSize: 10,
                    fontWeight: "600",
                    color: "#e65100",
                  }}
                >
                  {item.pos}
                </Text>
              </View>
              {item.source === "online" && (
                <View
                  style={{
                    backgroundColor: "#e3f2fd",
                    paddingHorizontal: 6,
                    paddingVertical: 2,
                    borderRadius: 3,
                  }}
                >
                  <Text
                    style={{
                      fontSize: 10,
                      fontWeight: "600",
                      color: "#0d47a1",
                    }}
                  >
                    Online
                  </Text>
                </View>
              )}
            </View>
          </View>
          {onRemoveEntry && (
            <TouchableOpacity
              onPress={() => handleRemove(item.word)}
              style={{
                paddingHorizontal: 8,
                paddingVertical: 4,
              }}
            >
              <Text
                style={{
                  fontSize: 18,
                  color: "#ccc",
                }}
              >
                ×
              </Text>
            </TouchableOpacity>
          )}
        </View>
      </Pressable>
    );

    return (
      <Modal
        visible={visible}
        transparent
        animationType="slide"
        onRequestClose={onDismiss}
      >
        <SafeAreaView
          style={{
            flex: 1,
            backgroundColor: "white",
          }}
        >
          {/* Header */}
          <View
            style={{
              flexDirection: "row",
              justifyContent: "space-between",
              alignItems: "center",
              paddingHorizontal: 16,
              paddingVertical: 12,
              borderBottomWidth: 1,
              borderBottomColor: "#f0f0f0",
            }}
          >
            <Text
              style={{
                fontSize: 18,
                fontWeight: "600",
                color: "#1a1a1a",
              }}
            >
              Glossary
            </Text>
            <TouchableOpacity onPress={onDismiss}>
              <Text
                style={{
                  fontSize: 24,
                  color: "#999",
                }}
              >
                ×
              </Text>
            </TouchableOpacity>
          </View>

          {/* Sort Controls */}
          <View
            style={{
              flexDirection: "row",
              gap: 8,
              paddingHorizontal: 16,
              paddingVertical: 12,
              borderBottomWidth: 1,
              borderBottomColor: "#f0f0f0",
            }}
          >
            <TouchableOpacity
              onPress={() => setSortBy("recent")}
              style={{
                paddingHorizontal: 12,
                paddingVertical: 8,
                borderRadius: 16,
                backgroundColor: sortBy === "recent" ? "#667eea" : "#f0f0f0",
              }}
            >
              <Text
                style={{
                  fontSize: 12,
                  fontWeight: "600",
                  color: sortBy === "recent" ? "white" : "#666",
                }}
              >
                Recent
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => setSortBy("alpha")}
              style={{
                paddingHorizontal: 12,
                paddingVertical: 8,
                borderRadius: 16,
                backgroundColor: sortBy === "alpha" ? "#667eea" : "#f0f0f0",
              }}
            >
              <Text
                style={{
                  fontSize: 12,
                  fontWeight: "600",
                  color: sortBy === "alpha" ? "white" : "#666",
                }}
              >
                A–Z
              </Text>
            </TouchableOpacity>
          </View>

          {/* Entry Count */}
          <View
            style={{
              paddingHorizontal: 16,
              paddingVertical: 8,
              backgroundColor: "#f9f9f9",
            }}
          >
            <Text
              style={{
                fontSize: 12,
                color: "#999",
              }}
            >
              {sortedEntries.length} word{sortedEntries.length !== 1 ? "s" : ""}
              {sortedEntries.length === 0 &&
                " — Start saving to build your glossary"}
            </Text>
          </View>

          {/* Glossary List */}
          {sortedEntries.length > 0 ? (
            <FlatList
              data={sortedEntries}
              keyExtractor={(item) => item.word}
              renderItem={renderEntry}
              scrollEnabled
            />
          ) : (
            <View
              style={{
                flex: 1,
                justifyContent: "center",
                alignItems: "center",
              }}
            >
              <Text
                style={{
                  fontSize: 14,
                  color: "#999",
                }}
              >
                No saved words yet
              </Text>
            </View>
          )}
        </SafeAreaView>
      </Modal>
    );
  },
);

GlossaryListModal.displayName = "GlossaryListModal";
