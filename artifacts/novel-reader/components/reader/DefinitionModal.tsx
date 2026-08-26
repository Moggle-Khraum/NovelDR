import React, { useEffect, useState } from "react";
import {
  Modal,
  ScrollView,
  TouchableOpacity,
  View,
  Text,
  ActivityIndicator,
  Pressable,
} from "react-native";
import { DictionaryEntry } from "@/constants/dictionary";
import { OnlineDefinition } from "@/hooks/reader/useDictionary";

interface DefinitionModalProps {
  visible: boolean;
  word: string | null;
  entries: DictionaryEntry[];
  notFound: boolean;
  onlineEntry: OnlineDefinition | null;
  fetching: boolean;
  isConnected: boolean | null;
  onFetch: () => Promise<void>;
  onDismiss: () => void;
}

export const DefinitionModal = React.memo(
  ({
    visible,
    word,
    entries,
    notFound,
    onlineEntry,
    fetching,
    isConnected,
    onFetch,
    onDismiss,
  }: DefinitionModalProps) => {
    const [showLoading, setShowLoading] = useState(false);

    useEffect(() => {
      if (fetching) {
        setShowLoading(true);
      } else {
        setShowLoading(false);
      }
    }, [fetching]);

    if (!visible || !word) {
      return null;
    }

    if (!word && !onlineEntry) {
      return null;
    }

    const handleFetch = async () => {
      await onFetch();
    };

    return (
      <Modal
        visible={visible}
        transparent
        animationType="fade"
        onRequestClose={onDismiss}
      >
        {/* Dismissible Overlay */}
        <Pressable
          style={{
            flex: 1,
            backgroundColor: "rgba(0, 0, 0, 0.45)",
            justifyContent: "center",
            alignItems: "center",
            paddingHorizontal: 16,
          }}
          onPress={onDismiss}
        >
          <Pressable
            onPress={(e) => e.stopPropagation()}
            style={{
              backgroundColor: "white",
              borderRadius: 16,
              width: "100%",
              maxWidth: 420,
              maxHeight: "80%",
              overflow: "hidden",
            }}
          >
            {/* EMPTY STATE: Word not found locally */}
            {notFound && !onlineEntry && !showLoading && (
              <View
                style={{
                  paddingHorizontal: 32,
                  paddingVertical: 32,
                  alignItems: "center",
                }}
              >
                <Text
                  style={{
                    fontSize: 20,
                    fontWeight: "500",
                    color: "#1a1a1a",
                    marginBottom: 8,
                  }}
                >
                  {word}
                </Text>
                <Text
                  style={{
                    fontSize: 13,
                    color: "#666",
                    marginBottom: 24,
                  }}
                >
                  Not in offline dictionary
                </Text>

                {/* Single Button: Fetch Meaning */}
                <View
                  style={{
                    width: "100%",
                    marginBottom: 24,
                  }}
                >
                  <TouchableOpacity
                    onPress={handleFetch}
                    disabled={!isConnected}
                    style={{
                      paddingVertical: 12,
                      backgroundColor: isConnected ? "#667eea" : "#ccc",
                      borderRadius: 8,
                      alignItems: "center",
                      justifyContent: "center",
                    }}
                  >
                    <Text
                      style={{
                        fontWeight: "500",
                        fontSize: 14,
                        color: "white",
                      }}
                    >
                      {isConnected ? "Fetch Meaning" : "No Internet"}
                    </Text>
                  </TouchableOpacity>
                </View>

                <Text
                  style={{
                    fontSize: 12,
                    color: "#999",
                  }}
                >
                  Press outside to dismiss
                </Text>
              </View>
            )}

            {/* LOADING STATE */}
            {showLoading && (
              <View
                style={{
                  paddingVertical: 48,
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <ActivityIndicator size="large" color="#667eea" />
                <Text
                  style={{
                    marginTop: 16,
                    fontSize: 14,
                    color: "#666",
                  }}
                >
                  Fetching from Wiktionary…
                </Text>
              </View>
            )}

            {/* OFFLINE DICTIONARY: Show offline entry (built‑in) */}
            {entries.length > 0 && (
              <ScrollView
                style={{ maxHeight: "100%" }}
                contentContainerStyle={{ paddingBottom: 16 }}
              >
                {/* Word Header */}
                <View
                  style={{
                    paddingHorizontal: 16,
                    paddingVertical: 12,
                    borderBottomWidth: 1,
                    borderBottomColor: "#f0f0f0",
                    backgroundColor: "#f9f9f9",
                    flexDirection: "row",
                    alignItems: "center",
                    justifyContent: "space-between",
                  }}
                >
                  <View
                    style={{
                      flexDirection: "row",
                      alignItems: "center",
                      gap: 8,
                      flex: 1,
                    }}
                  >
                    <Text
                      style={{
                        fontSize: 18,
                        fontWeight: "500",
                        color: "#1a1a1a",
                      }}
                    >
                      {word}
                    </Text>
                    <View
                      style={{
                        backgroundColor: "#fff8e1",
                        paddingHorizontal: 8,
                        paddingVertical: 3,
                        borderRadius: 3,
                      }}
                    >
                      <Text
                        style={{
                          fontSize: 10,
                          fontWeight: "600",
                          color: "#a67c00",
                        }}
                      >
                        Offline
                      </Text>
                    </View>
                  </View>
                  {/* Glossary button removed */}
                </View>

                {/* Definitions from Offline Dictionary */}
                <View style={{ paddingHorizontal: 16, paddingTop: 16 }}>
                  {entries.map((entry, idx) => (
                    <View key={idx} style={{ marginBottom: 16 }}>
                      <Text
                        style={{
                          fontSize: 11,
                          fontWeight: "600",
                          color: "#666",
                          textTransform: "uppercase",
                          letterSpacing: 0.5,
                          marginBottom: 8,
                        }}
                      >
                        <View
                          style={{
                            backgroundColor: "#fff3e0",
                            paddingHorizontal: 6,
                            paddingVertical: 2,
                          }}
                        >
                          <Text
                            style={{
                              color: "#e65100",
                              fontSize: 10,
                              fontWeight: "600",
                            }}
                          >
                            {entry.pos || "Definition"}
                          </Text>
                        </View>
                      </Text>
                      <Text
                        style={{
                          fontSize: 13,
                          color: "#333",
                          lineHeight: 18,
                        }}
                      >
                        {entry.meaning}
                      </Text>
                    </View>
                  ))}
                </View>

                {/* Footer */}
                <View
                  style={{
                    paddingHorizontal: 16,
                    paddingTop: 12,
                    paddingBottom: 12,
                    borderTopWidth: 1,
                    borderTopColor: "#f0f0f0",
                    marginTop: 12,
                  }}
                >
                  <Text
                    style={{
                      fontSize: 12,
                      color: "#999",
                    }}
                  >
                    Press outside to dismiss
                  </Text>
                </View>
              </ScrollView>
            )}

            {/* SAVED / FETCHED DEFINITION: Show online entry (now persisted) */}
            {onlineEntry && (
              <ScrollView
                style={{ maxHeight: "100%" }}
                contentContainerStyle={{ paddingBottom: 16 }}
              >
                {/* Word Header */}
                <View
                  style={{
                    paddingHorizontal: 16,
                    paddingVertical: 12,
                    borderBottomWidth: 1,
                    borderBottomColor: "#f0f0f0",
                    backgroundColor: "#f9f9f9",
                    flexDirection: "row",
                    alignItems: "center",
                    justifyContent: "space-between",
                  }}
                >
                  <View
                    style={{
                      flexDirection: "row",
                      alignItems: "center",
                      gap: 8,
                      flex: 1,
                    }}
                  >
                    <Text
                      style={{
                        fontSize: 18,
                        fontWeight: "500",
                        color: "#1a1a1a",
                      }}
                    >
                      {word}
                    </Text>
                    <View
                      style={{
                        backgroundColor:
                          onlineEntry.source === "saved"
                            ? "#e8f5e9"  // greenish for saved
                            : "#e3f2fd", // blueish for online (fallback)
                        paddingHorizontal: 8,
                        paddingVertical: 3,
                        borderRadius: 3,
                      }}
                    >
                      <Text
                        style={{
                          fontSize: 10,
                          fontWeight: "600",
                          color: onlineEntry.source === "saved" ? "#2e7d32" : "#0d47a1",
                        }}
                      >
                        {onlineEntry.source === "saved" ? "Saved" : "Online"}
                      </Text>
                    </View>
                  </View>
                  {/* Glossary button removed */}
                </View>

                {/* Definition Content */}
                <View style={{ paddingHorizontal: 16, paddingTop: 16 }}>
                  <Text
                    style={{
                      fontSize: 11,
                      fontWeight: "600",
                      color: "#666",
                      textTransform: "uppercase",
                      letterSpacing: 0.5,
                      marginBottom: 8,
                    }}
                  >
                    <View
                      style={{
                        backgroundColor: "#fff3e0",
                        paddingHorizontal: 6,
                        paddingVertical: 2,
                      }}
                    >
                      <Text
                        style={{
                          color: "#e65100",
                          fontSize: 10,
                          fontWeight: "600",
                        }}
                      >
                        {onlineEntry.pos}
                      </Text>
                    </View>
                  </Text>
                  <Text
                    style={{
                      fontSize: 13,
                      color: "#333",
                      lineHeight: 20,
                      marginBottom: 16,
                    }}
                  >
                    {onlineEntry.meaning}
                  </Text>
                </View>

                {/* Footer – show "Saved" message only for persistent entries */}
                {onlineEntry.source === "saved" && (
                  <View
                    style={{
                      paddingHorizontal: 16,
                      paddingTop: 12,
                      paddingBottom: 12,
                      borderTopWidth: 1,
                      borderTopColor: "#f0f0f0",
                      marginTop: 12,
                    }}
                  >
                    <Text
                      style={{
                        fontSize: 12,
                        color: "#4caf50",
                        fontWeight: "600",
                      }}
                    >
                      ✓ Saved to dictionary • Press outside to dismiss
                    </Text>
                  </View>
                )}
                {onlineEntry.source === "online" && (
                  <View
                    style={{
                      paddingHorizontal: 16,
                      paddingTop: 12,
                      paddingBottom: 12,
                      borderTopWidth: 1,
                      borderTopColor: "#f0f0f0",
                      marginTop: 12,
                    }}
                  >
                    <Text
                      style={{
                        fontSize: 12,
                        color: "#999",
                      }}
                    >
                      Press outside to dismiss
                    </Text>
                  </View>
                )}
              </ScrollView>
            )}
          </Pressable>
        </Pressable>
      </Modal>
    );
  },
);

DefinitionModal.displayName = "DefinitionModal";
