// components/reader/ContentWrapper.tsx
import React from "react";
import { View, ImageBackground } from "react-native";

type ContentWrapperProps = {
  children: React.ReactNode;
  bgImageUri: string | null;
  bgSolidColor: string | null;
  defaultBgColor: string;
};

export default function ContentWrapper({
  children,
  bgImageUri,
  bgSolidColor,
  defaultBgColor,
}: ContentWrapperProps) {
  if (bgImageUri) {
    return (
      <ImageBackground
        source={{ uri: bgImageUri }}
        style={{ flex: 1 }}
        resizeMode="cover"
        imageStyle={{ flex: 1 }}
      >
        <View style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.4)" }}>
          {children}
        </View>
      </ImageBackground>
    );
  }
  if (bgSolidColor && bgSolidColor !== "transparent") {
    return (
      <View style={{ flex: 1, backgroundColor: bgSolidColor }}>{children}</View>
    );
  }
  return (
    <View style={{ flex: 1, backgroundColor: defaultBgColor || "transparent" }}>
      {children}
    </View>
  );
}
