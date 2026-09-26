import React from "react";
import { Pressable, View } from "react-native";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { useAnnouncements } from "@/hooks/useAnnouncements";
import { useAdaptiveColors } from "@/hooks/useAdaptiveColors";

interface AnnouncementBadgeProps {
  onPress: () => void;
  size?: number;
}

export const AnnouncementBadge: React.FC<AnnouncementBadgeProps> = ({
  onPress,
  size = 24,
}) => {
  const { hasNew } = useAnnouncements();
  const adaptiveColors = useAdaptiveColors();

  return (
    <Pressable onPress={onPress} style={{ padding: 8 }}>
      <MaterialCommunityIcons
        name="megaphone"
        size={size}
        color={adaptiveColors.text}
      />

      {/* Red dot badge */}
      {hasNew && (
        <View
          style={{
            position: "absolute",
            top: 2,
            right: 2,
            width: 10,
            height: 10,
            borderRadius: 5,
            backgroundColor: "#FF4444",
            borderWidth: 2,
            borderColor: adaptiveColors.background,
          }}
        />
      )}
    </Pressable>
  );
};
