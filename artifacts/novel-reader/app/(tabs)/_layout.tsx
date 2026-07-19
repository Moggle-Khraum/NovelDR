import { BlurView } from "expo-blur";
import { isLiquidGlassAvailable } from "expo-glass-effect";
import { Tabs } from "expo-router";
import { Icon, Label, NativeTabs } from "expo-router/unstable-native-tabs";
import { SymbolView } from "expo-symbols";
import { Ionicons } from "@expo/vector-icons";
import React from "react";
import { Platform, StyleSheet, View } from "react-native";
import { useTheme } from "@/context/ThemeContext";

function NativeTabLayout() {
  return (
    <NativeTabs>
      <NativeTabs.Trigger name="index">
        <Icon
          sf={{ default: "books.vertical", selected: "books.vertical.fill" }}
        />
        <Label>Library</Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="add">
        <Icon
          sf={{
            default: "arrow.down.circle",
            selected: "arrow.down.circle.fill",
          }}
        />
        <Label>Download</Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="updates">
        <Icon
          sf={{
            default: "arrow.clockwise.circle",
            selected: "arrow.clockwise.circle.fill",
          }}
        />
        <Label>Updates</Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="settings">
        <Icon sf={{ default: "gearshape", selected: "gearshape.fill" }} />
        <Label>Settings</Label>
      </NativeTabs.Trigger>
    </NativeTabs>
  );
}

function ClassicTabLayout() {
  const { colors } = useTheme();
  const isIOS = Platform.OS === "ios";
  const isWeb = Platform.OS === "web";

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.accent,
        tabBarInactiveTintColor: colors.icon,
        tabBarStyle: {
          position: "absolute",
          backgroundColor: isIOS ? "transparent" : colors.tabBar,
          borderTopWidth: 1,
          borderTopColor: colors.border,
          elevation: 0,
          ...(isWeb ? { height: 84 } : {}),
        },
        tabBarBackground: () =>
          isIOS ? (
            <BlurView
              intensity={90}
              tint="dark"
              style={StyleSheet.absoluteFill}
            />
          ) : isWeb ? (
            <View
              style={[
                StyleSheet.absoluteFill,
                { backgroundColor: colors.tabBar },
              ]}
            />
          ) : null,
        tabBarLabelStyle: {
          fontFamily: "Inter_500Medium",
          fontSize: 11,
        },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: "Library",
          tabBarIcon: ({ color, size }) =>
            isIOS ? (
              <SymbolView
                name="books.vertical.fill"
                tintColor={color}
                size={size}
              />
            ) : (
              <Ionicons name="library" size={size} color={color} />
            ),
        }}
      />
      <Tabs.Screen
        name="add"
        options={{
          title: "Download",
          tabBarIcon: ({ color, size }) =>
            isIOS ? (
              <SymbolView
                name="arrow.down.circle.fill"
                tintColor={color}
                size={size}
              />
            ) : (
              <Ionicons name="cloud-download" size={size} color={color} />
            ),
        }}
      />
      <Tabs.Screen
        name="updates"
        options={{
          title: "Updates",
          tabBarIcon: ({ color, size }) =>
            isIOS ? (
              <SymbolView
                name="arrow.clockwise.circle.fill"
                tintColor={color}
                size={size}
              />
            ) : (
              <Ionicons name="refresh-circle" size={size} color={color} />
            ),
        }}
      />
      <Tabs.Screen
        name="settings"
        options={{
          title: "Settings",
          tabBarIcon: ({ color, size }) =>
            isIOS ? (
              <SymbolView name="gearshape.fill" tintColor={color} size={size} />
            ) : (
              <Ionicons name="settings" size={size} color={color} />
            ),
        }}
      />
    </Tabs>
  );
}

export default function TabLayout() {
  if (isLiquidGlassAvailable()) {
    return <NativeTabLayout />;
  }
  return <ClassicTabLayout />;
}
