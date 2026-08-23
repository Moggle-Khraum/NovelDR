import React, { useEffect, useState } from 'react';
import {
  Modal,
  ScrollView,
  TouchableOpacity,
  View,
  Text,
  ActivityIndicator,
  Pressable,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { DictionaryEntry } from '@/constants/dictionary';
import { OnlineDefinition } from '@/hooks/reader/useDictionary';
import { trimRootWord } from '@/lib/trimRootWord';

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
    const insets = useSafeAreaInsets();
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
            backgroundColor: 'rgba(0, 0, 0, 0.45)',
            justifyContent: 'center',
            alignItems: 'center',
            paddingHorizontal: 16,
          }}
          onPress={onDismiss}
        >
          <Pressable
            onPress={(e) => e.stopPropagation()}
            style={{
              backgroundColor: 'white',
              borderRadius: 16,
              width: '100%',
              maxWidth: 420,
              maxHeight: '80%',
              overflow: 'hidden',
            }}
          >
            {/* EMPTY STATE: Word not found locally */}
            {notFound && !onlineEntry && !showLoading && (
              <View
                style={{
                  paddingHorizontal: 32,
                  paddingVertical: 32,
                  alignItems: 'center',
                }}
              >
                <Text
                  style={{
                    fontSize: 20,
                    fontWeight: '500',
                    color: '#1a1a1a',
                    marginBottom: 8,
                  }}
                >
                  {word}
                </Text>
                <Text
                  style={{
                    fontSize: 13,
                    color: '#666',
                    marginBottom: 24,
                  }}
                >
                  Not in offline dictionary
                </Text>

                {/* Two-Column Button Grid */}
                <View
                  style={{
                    display: 'flex',
                    flexDirection: 'row',
                    gap: 12,
                    width: '100%',
                    marginBottom: 24,
                  }}
                >
                  <TouchableOpacity
                    onPress={handleFetch}
                    disabled={!isConnected}
                    style={{
                      flex: 1,
                      paddingVertical: 12,
                      backgroundColor: isConnected ? '#667eea' : '#ccc',
                      borderRadius: 8,
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                  >
                    <Text
                      style={{
                        fontWeight: '500',
                        fontSize: 14,
                        color: 'white',
                      }}
                    >
                      {isConnected ? 'Fetch Meaning' : 'No Internet'}
                    </Text>
                  </TouchableOpacity>

                  <TouchableOpacity
                    onPress={() => {
                      // TODO: Navigate to glossary view
                      onDismiss();
                    }}
                    style={{
                      flex: 1,
                      paddingVertical: 12,
                      backgroundColor: 'white',
                      borderRadius: 8,
                      borderWidth: 1,
                      borderColor: '#667eea',
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                  >
                    <Text
                      style={{
                        fontWeight: '500',
                        fontSize: 14,
                        color: '#667eea',
                      }}
                    >
                      Show Glossary
                    </Text>
                  </TouchableOpacity>
                </View>

                <Text
                  style={{
                    fontSize: 12,
                    color: '#999',
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
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <ActivityIndicator size="large" color="#667eea" />
                <Text
                  style={{
                    marginTop: 16,
                    fontSize: 14,
                    color: '#666',
                  }}
                >
                  Fetching from Wiktionary…
                </Text>
              </View>
            )}

            {/* OFFLINE DICTIONARY: Show offline entry */}
            {entries.length > 0 && (
              <ScrollView
                style={{ maxHeight: '100%' }}
                contentContainerStyle={{ paddingBottom: 16 }}
              >
                {/* Word Header */}
                <View
                  style={{
                    paddingHorizontal: 16,
                    paddingVertical: 12,
                    borderBottomWidth: 1,
                    borderBottomColor: '#f0f0f0',
                    backgroundColor: '#f9f9f9',
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: 8,
                  }}
                >
                  <Text
                    style={{
                      fontSize: 18,
                      fontWeight: '500',
                      color: '#1a1a1a',
                    }}
                  >
                    {word}
                  </Text>
                  <View
                    style={{
                      backgroundColor: '#fff8e1',
                      paddingHorizontal: 8,
                      paddingVertical: 3,
                      borderRadius: 3,
                    }}
                  >
                    <Text
                      style={{
                        fontSize: 10,
                        fontWeight: '600',
                        color: '#a67c00',
                      }}
                    >
                      Offline
                    </Text>
                  </View>
                </View>

                {/* Definitions from Offline Dictionary */}
                <View style={{ paddingHorizontal: 16, paddingTop: 16 }}>
                  {entries.map((entry, idx) => (
                    <View key={idx} style={{ marginBottom: 16 }}>
                      {entry.meanings ? (
                        // Multi-meaning format
                        entry.meanings.map((meaning, midx) => (
                          <View key={midx} style={{ marginBottom: 12 }}>
                            <View
                              style={{
                                marginBottom: 8,
                                paddingBottom: 8,
                                borderBottomWidth:
                                  midx < entry.meanings!.length - 1 ? 1 : 0,
                                borderBottomColor: '#e0e0e0',
                              }}
                            >
                              <Text
                                style={{
                                  fontSize: 11,
                                  fontWeight: '600',
                                  color: '#666',
                                  textTransform: 'uppercase',
                                  letterSpacing: 0.5,
                                  marginBottom: 6,
                                }}
                              >
                                <View
                                  style={{
                                    backgroundColor: '#fff3e0',
                                    paddingHorizontal: 6,
                                    paddingVertical: 2,
                                  }}
                                >
                                  <Text
                                    style={{
                                      color: '#e65100',
                                      fontSize: 10,
                                      fontWeight: '600',
                                    }}
                                  >
                                    {meaning.partOfSpeech || entry.pos}
                                  </Text>
                                </View>
                              </Text>
                              <Text
                                style={{
                                  fontSize: 13,
                                  color: '#333',
                                  lineHeight: 18,
                                }}
                              >
                                {meaning.definition || entry.meaning}
                              </Text>
                            </View>
                          </View>
                        ))
                      ) : (
                        // Single meaning format
                        <View>
                          <Text
                            style={{
                              fontSize: 11,
                              fontWeight: '600',
                              color: '#666',
                              textTransform: 'uppercase',
                              letterSpacing: 0.5,
                              marginBottom: 8,
                            }}
                          >
                            <View
                              style={{
                                backgroundColor: '#fff3e0',
                                paddingHorizontal: 6,
                                paddingVertical: 2,
                              }}
                            >
                              <Text
                                style={{
                                  color: '#e65100',
                                  fontSize: 10,
                                  fontWeight: '600',
                                }}
                              >
                                {entry.pos || 'Definition'}
                              </Text>
                            </View>
                          </Text>
                          <Text
                            style={{
                              fontSize: 13,
                              color: '#333',
                              lineHeight: 18,
                            }}
                          >
                            {entry.meaning}
                          </Text>
                        </View>
                      )}
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
                    borderTopColor: '#f0f0f0',
                    marginTop: 12,
                  }}
                >
                  <Text
                    style={{
                      fontSize: 12,
                      color: '#999',
                    }}
                  >
                    Press outside to dismiss
                  </Text>
                </View>
              </ScrollView>
            )}

            {/* ONLINE DEFINITION: Show fetched entry */}
            {onlineEntry && (
              <ScrollView
                style={{ maxHeight: '100%' }}
                contentContainerStyle={{ paddingBottom: 16 }}
              >
                {/* Word Header */}
                <View
                  style={{
                    paddingHorizontal: 16,
                    paddingVertical: 12,
                    borderBottomWidth: 1,
                    borderBottomColor: '#f0f0f0',
                    backgroundColor: '#f9f9f9',
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: 8,
                  }}
                >
                  <Text
                    style={{
                      fontSize: 18,
                      fontWeight: '500',
                      color: '#1a1a1a',
                    }}
                  >
                    {word}
                  </Text>
                  <View
                    style={{
                      backgroundColor: '#e3f2fd',
                      paddingHorizontal: 8,
                      paddingVertical: 3,
                      borderRadius: 3,
                    }}
                  >
                    <Text
                      style={{
                        fontSize: 10,
                        fontWeight: '600',
                        color: '#0d47a1',
                      }}
                    >
                      Online
                    </Text>
                  </View>
                </View>

                {/* Definition Content */}
                <View style={{ paddingHorizontal: 16, paddingTop: 16 }}>
                  <Text
                    style={{
                      fontSize: 11,
                      fontWeight: '600',
                      color: '#666',
                      textTransform: 'uppercase',
                      letterSpacing: 0.5,
                      marginBottom: 8,
                    }}
                  >
                    <View
                      style={{
                        backgroundColor: '#fff3e0',
                        paddingHorizontal: 6,
                        paddingVertical: 2,
                      }}
                    >
                      <Text
                        style={{
                          color: '#e65100',
                          fontSize: 10,
                          fontWeight: '600',
                        }}
                      >
                        {onlineEntry.pos}
                      </Text>
                    </View>
                  </Text>
                  <Text
                    style={{
                      fontSize: 13,
                      color: '#333',
                      lineHeight: 20,
                      marginBottom: 16,
                    }}
                  >
                    {onlineEntry.meaning}
                  </Text>
                </View>

                {/* Footer Note */}
                <View
                  style={{
                    paddingHorizontal: 16,
                    paddingTop: 12,
                    paddingBottom: 12,
                    borderTopWidth: 1,
                    borderTopColor: '#f0f0f0',
                    marginTop: 12,
                  }}
                >
                  <Text
                    style={{
                      fontSize: 12,
                      color: '#999',
                    }}
                  >
                    ✓ Saved to glossary • Press outside to dismiss
                  </Text>
                </View>
              </ScrollView>
            )}
          </Pressable>
        </Pressable>
      </Modal>
    );
  }
);

DefinitionModal.displayName = 'DefinitionModal';
