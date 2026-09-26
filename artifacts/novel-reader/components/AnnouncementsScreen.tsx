import React, { useState } from "react";
import {
  View,
  Text,
  ScrollView,
  Pressable,
  useColorScheme,
  Linking,
} from "react-native";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { useAnnouncements } from "@/hooks/useAnnouncements";
import { MarkdownRenderer } from "@/components/MarkdownRenderer";
import { useAdaptiveColors } from "@/hooks/useAdaptiveColors";

export const AnnouncementsScreen = () => {
  const { announcement, dismissAnnouncement, getRelativeTime } =
    useAnnouncements();
  const [expanded, setExpanded] = useState(false);
  const adaptiveColors = useAdaptiveColors();

  if (!announcement) {
    return (
      <View
        style={{
          flex: 1,
          justifyContent: "center",
          alignItems: "center",
          backgroundColor: adaptiveColors.background,
        }}
      >
        <MaterialCommunityIcons
          name="megaphone-off"
          size={48}
          color={adaptiveColors.textSecondary}
        />
        <Text
          style={{
            marginTop: 12,
            fontSize: 16,
            color: adaptiveColors.textSecondary,
          }}
        >
          No announcements
        </Text>
      </View>
    );
  }

  return (
    <View
      style={{
        flex: 1,
        backgroundColor: adaptiveColors.background,
      }}
    >
      <ScrollView
        style={{
          flex: 1,
          padding: 16,
        }}
        contentContainerStyle={{ paddingBottom: 20 }}
      >
        {/* Header */}
        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            marginBottom: 16,
          }}
        >
          <MaterialCommunityIcons
            name="megaphone"
            size={28}
            color={adaptiveColors.accent}
          />
          <Text
            style={{
              fontSize: 20,
              fontWeight: "600",
              color: adaptiveColors.text,
              marginLeft: 12,
            }}
          >
            Announcements
          </Text>
        </View>

        {/* Announcement Card */}
        <View
          style={{
            backgroundColor: adaptiveColors.surface,
            borderRadius: 12,
            padding: 16,
            borderWidth: 1,
            borderColor: adaptiveColors.border,
            marginBottom: 16,
          }}
        >
          {/* Title */}
          <Text
            style={{
              fontSize: 18,
              fontWeight: "600",
              color: adaptiveColors.text,
              marginBottom: 8,
            }}
          >
            {announcement.title}
          </Text>

          {/* Meta Info */}
          <View
            style={{
              flexDirection: "row",
              justifyContent: "space-between",
              marginBottom: 12,
            }}
          >
            <Text
              style={{
                fontSize: 12,
                color: adaptiveColors.textSecondary,
              }}
            >
              by {announcement.author}
            </Text>
            <Text
              style={{
                fontSize: 12,
                color: adaptiveColors.textSecondary,
              }}
            >
              {getRelativeTime(announcement.createdAt)}
            </Text>
          </View>

          {/* Preview or Full Content */}
          {!expanded ? (
            <>
              <Text
                style={{
                  fontSize: 14,
                  color: adaptiveColors.text,
                  lineHeight: 20,
                  marginBottom: 12,
                }}
                numberOfLines={3}
              >
                {announcement.body.substring(0, 150)}...
              </Text>
              <Pressable
                onPress={() => setExpanded(true)}
                style={{
                  paddingVertical: 8,
                }}
              >
                <Text
                  style={{
                    fontSize: 14,
                    color: adaptiveColors.accent,
                    fontWeight: "600",
                  }}
                >
                  Read more →
                </Text>
              </Pressable>
            </>
          ) : (
            <>
              <MarkdownRenderer content={announcement.body} />
              <Pressable
                onPress={() => setExpanded(false)}
                style={{
                  marginTop: 12,
                  paddingVertical: 8,
                }}
              >
                <Text
                  style={{
                    fontSize: 14,
                    color: adaptiveColors.accent,
                    fontWeight: "600",
                  }}
                >
                  ← Show less
                </Text>
              </Pressable>
            </>
          )}
        </View>

        {/* Action Buttons */}
        <View
          style={{
            flexDirection: "row",
            gap: 12,
          }}
        >
          {/* Open on GitHub */}
          <Pressable
            onPress={() => Linking.openURL(announcement.url)}
            style={{
              flex: 1,
              paddingVertical: 12,
              paddingHorizontal: 16,
              backgroundColor: adaptiveColors.accent,
              borderRadius: 8,
              alignItems: "center",
            }}
          >
            <Text
              style={{
                fontSize: 14,
                fontWeight: "600",
                color: "#fff",
              }}
            >
              View on GitHub
            </Text>
          </Pressable>

          {/* Dismiss */}
          <Pressable
            onPress={dismissAnnouncement}
            style={{
              flex: 1,
              paddingVertical: 12,
              paddingHorizontal: 16,
              backgroundColor: adaptiveColors.surface,
              borderRadius: 8,
              borderWidth: 1,
              borderColor: adaptiveColors.border,
              alignItems: "center",
            }}
          >
            <Text
              style={{
                fontSize: 14,
                fontWeight: "600",
                color: adaptiveColors.text,
              }}
            >
              Dismiss
            </Text>
          </Pressable>
        </View>
      </ScrollView>
    </View>
  );
};
