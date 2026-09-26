import React from "react";
import { View, Text } from "react-native";
import MarkdownDisplay from "react-native-markdown-display";
import { useAdaptiveColors } from "@/hooks/useAdaptiveColors";

interface MarkdownRendererProps {
  content: string;
}

// Simple BBCode parser for common tags
const parseBBCode = (text: string): string => {
  return text
    .replace(/\[b\](.*?)\[\/b\]/g, "**$1**")
    .replace(/\[i\](.*?)\[\/i\]/g, "*$1*")
    .replace(/\[u\](.*?)\[\/u\]/g, "__$1__")
    .replace(/\[url=(.*?)\](.*?)\[\/url\]/g, "[$2]($1)")
    .replace(/\[url\](.*?)\[\/url\]/g, "[$1]($1)");
};

export const MarkdownRenderer: React.FC<MarkdownRendererProps> = ({
  content,
}) => {
  const adaptiveColors = useAdaptiveColors();

  // Convert BBCode to Markdown
  const markdown = parseBBCode(content);

  const markdownStyles = {
    body: {
      color: adaptiveColors.text,
      fontSize: 14,
      lineHeight: 20,
    },
    heading1: {
      color: adaptiveColors.text,
      fontSize: 24,
      fontWeight: "bold",
      marginVertical: 8,
    },
    heading2: {
      color: adaptiveColors.text,
      fontSize: 20,
      fontWeight: "bold",
      marginVertical: 6,
    },
    heading3: {
      color: adaptiveColors.text,
      fontSize: 18,
      fontWeight: "bold",
      marginVertical: 4,
    },
    strong: {
      fontWeight: "bold",
      color: adaptiveColors.text,
    },
    em: {
      fontStyle: "italic",
      color: adaptiveColors.text,
    },
    paragraph: {
      marginVertical: 6,
      color: adaptiveColors.text,
    },
    link: {
      color: adaptiveColors.accent,
    },
    blockquote: {
      borderLeftWidth: 3,
      borderLeftColor: adaptiveColors.accent,
      paddingLeft: 12,
      marginVertical: 8,
      backgroundColor: adaptiveColors.surface,
      paddingVertical: 8,
      paddingHorizontal: 12,
      borderRadius: 4,
    },
    code_inline: {
      backgroundColor: adaptiveColors.surface,
      color: adaptiveColors.accent,
      paddingHorizontal: 6,
      paddingVertical: 2,
      borderRadius: 4,
      fontFamily: "Courier New",
      fontSize: 12,
    },
    code_block: {
      backgroundColor: adaptiveColors.surface,
      color: adaptiveColors.text,
      padding: 12,
      borderRadius: 4,
      fontFamily: "Courier New",
      fontSize: 12,
      marginVertical: 8,
    },
    list_item: {
      marginVertical: 4,
      marginLeft: 16,
      color: adaptiveColors.text,
    },
    hr: {
      borderBottomWidth: 1,
      borderBottomColor: adaptiveColors.border,
      marginVertical: 12,
    },
  };

  return (
    <View>
      <MarkdownDisplay style={markdownStyles}>{markdown}</MarkdownDisplay>
    </View>
  );
};
