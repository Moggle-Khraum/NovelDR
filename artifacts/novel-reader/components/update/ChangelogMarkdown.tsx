import React, { useMemo } from "react";
import { Linking, StyleSheet, Text, View } from "react-native";
import { useTheme } from "@/context/ThemeContext";

/**
 * Tiny dependency-free markdown renderer for GitHub release notes.
 *
 * Block level : # / ## / ### headings, - * + bullets (nested by indent),
 *               1. numbered lists, - [ ] / - [x] checkboxes, > quotes,
 *               ``` fenced code, --- rules, blank-line spacing.
 * Inline      : **bold**, __bold__, *italic*, _italic_, ***both***,
 *               ~~strike~~, `code`, [label](url).
 * Emoji and plain text pass straight through.
 */

// ─── Inline parsing ─────────────────────────────────────────────────────────

type Inline =
  | { t: "text"; v: string }
  | { t: "bold" | "italic" | "bolditalic" | "strike"; c: Inline[] }
  | { t: "code"; v: string }
  | { t: "link"; label: Inline[]; url: string };

// Order matters: earlier alternatives win when they start at the same index.
const INLINE_RE = new RegExp(
  [
    "`([^`\\n]+)`", // 1 code
    "\\[([^\\]\\n]+)\\]\\(([^)\\s]+)\\)", // 2 label, 3 url
    "\\*\\*\\*(.+?)\\*\\*\\*", // 4 bold+italic
    "\\*\\*(.+?)\\*\\*", // 5 bold
    "__(.+?)__", // 6 bold
    "~~(.+?)~~", // 7 strike
    "\\*(?!\\s)(.+?)(?<!\\s)\\*", // 8 italic
    "(?<![A-Za-z0-9])_(?!\\s)(.+?)(?<!\\s)_(?![A-Za-z0-9])", // 9 italic
  ].join("|"),
);

function parseInline(src: string): Inline[] {
  const out: Inline[] = [];
  let rest = src;
  while (rest.length) {
    const m = INLINE_RE.exec(rest);
    if (!m) {
      out.push({ t: "text", v: rest });
      break;
    }
    if (m.index > 0) out.push({ t: "text", v: rest.slice(0, m.index) });
    if (m[1] !== undefined) out.push({ t: "code", v: m[1] });
    else if (m[2] !== undefined)
      out.push({ t: "link", label: parseInline(m[2]), url: m[3] });
    else if (m[4] !== undefined)
      out.push({ t: "bolditalic", c: parseInline(m[4]) });
    else if (m[5] !== undefined) out.push({ t: "bold", c: parseInline(m[5]) });
    else if (m[6] !== undefined) out.push({ t: "bold", c: parseInline(m[6]) });
    else if (m[7] !== undefined)
      out.push({ t: "strike", c: parseInline(m[7]) });
    else if (m[8] !== undefined)
      out.push({ t: "italic", c: parseInline(m[8]) });
    else if (m[9] !== undefined)
      out.push({ t: "italic", c: parseInline(m[9]) });
    rest = rest.slice(m.index + m[0].length);
  }
  return out;
}

// ─── Block parsing ──────────────────────────────────────────────────────────

type Block =
  | { t: "heading"; level: 1 | 2 | 3; c: Inline[] }
  | { t: "para"; c: Inline[] }
  | { t: "bullet"; indent: number; marker: string; c: Inline[] }
  | { t: "quote"; c: Inline[] }
  | { t: "code"; v: string }
  | { t: "hr" }
  | { t: "gap" };

function parseBlocks(raw: string): Block[] {
  const lines = raw
    .replace(/\r\n?/g, "\n")
    .replace(/<!--[\s\S]*?-->/g, "")
    .split("\n");
  const blocks: Block[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    // fenced code
    if (/^\s*```/.test(line)) {
      const buf: string[] = [];
      i++;
      while (i < lines.length && !/^\s*```/.test(lines[i]))
        buf.push(lines[i++]);
      i++; // closing fence
      blocks.push({ t: "code", v: buf.join("\n") });
      continue;
    }

    if (!line.trim()) {
      // collapse runs of blank lines into one gap
      if (blocks.length && blocks[blocks.length - 1].t !== "gap")
        blocks.push({ t: "gap" });
      i++;
      continue;
    }

    if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(line)) {
      blocks.push({ t: "hr" });
      i++;
      continue;
    }

    const h = /^(#{1,6})\s+(.*?)\s*#*\s*$/.exec(line);
    if (h) {
      const level = Math.min(h[1].length, 3) as 1 | 2 | 3;
      blocks.push({ t: "heading", level, c: parseInline(h[2]) });
      i++;
      continue;
    }

    const q = /^\s*>\s?(.*)$/.exec(line);
    if (q) {
      blocks.push({ t: "quote", c: parseInline(q[1]) });
      i++;
      continue;
    }

    const b = /^(\s*)([-*+])\s+(?:\[([ xX])\]\s+)?(.*)$/.exec(line);
    if (b) {
      const indent = Math.min(
        Math.floor(b[1].replace(/\t/g, "  ").length / 2),
        3,
      );
      const marker = b[3] === undefined ? "•" : b[3] === " " ? "☐" : "☑";
      blocks.push({ t: "bullet", indent, marker, c: parseInline(b[4]) });
      i++;
      continue;
    }

    const n = /^(\s*)(\d+)[.)]\s+(.*)$/.exec(line);
    if (n) {
      const indent = Math.min(
        Math.floor(n[1].replace(/\t/g, "  ").length / 2),
        3,
      );
      blocks.push({
        t: "bullet",
        indent,
        marker: `${n[2]}.`,
        c: parseInline(n[3]),
      });
      i++;
      continue;
    }

    blocks.push({ t: "para", c: parseInline(line.trim()) });
    i++;
  }

  // trim leading/trailing gaps
  while (blocks.length && blocks[0].t === "gap") blocks.shift();
  while (blocks.length && blocks[blocks.length - 1].t === "gap") blocks.pop();
  return blocks;
}

// ─── Rendering ──────────────────────────────────────────────────────────────

export function ChangelogMarkdown({ source }: { source: string }) {
  const { colors } = useTheme();
  const blocks = useMemo(() => parseBlocks(source), [source]);

  const renderInline = (nodes: Inline[], keyPrefix = "i"): React.ReactNode[] =>
    nodes.map((n, idx) => {
      const key = `${keyPrefix}-${idx}`;
      switch (n.t) {
        case "text":
          return n.v;
        case "bold":
          return (
            <Text key={key} style={s.bold}>
              {renderInline(n.c, key)}
            </Text>
          );
        case "italic":
          return (
            <Text key={key} style={s.italic}>
              {renderInline(n.c, key)}
            </Text>
          );
        case "bolditalic":
          return (
            <Text key={key} style={[s.bold, s.italic]}>
              {renderInline(n.c, key)}
            </Text>
          );
        case "strike":
          return (
            <Text key={key} style={s.strike}>
              {renderInline(n.c, key)}
            </Text>
          );
        case "code":
          return (
            <Text
              key={key}
              style={[
                s.inlineCode,
                { backgroundColor: colors.card, color: colors.text },
              ]}
            >
              {n.v}
            </Text>
          );
        case "link":
          return (
            <Text
              key={key}
              style={{ color: colors.accent, textDecorationLine: "underline" }}
              onPress={() => {
                Linking.openURL(n.url).catch(() => {});
              }}
            >
              {renderInline(n.label, key)}
            </Text>
          );
      }
    });

  const base = [s.text, { color: colors.textSecondary }];

  return (
    <View>
      {blocks.map((b, idx) => {
        switch (b.t) {
          case "gap":
            return <View key={idx} style={s.gap} />;
          case "hr":
            return (
              <View
                key={idx}
                style={[s.hr, { backgroundColor: colors.border }]}
              />
            );
          case "heading":
            return (
              <Text
                key={idx}
                style={[
                  s.heading,
                  b.level === 1 && s.h1,
                  b.level === 2 && s.h2,
                  b.level === 3 && s.h3,
                  { color: colors.text },
                ]}
              >
                {renderInline(b.c)}
              </Text>
            );
          case "bullet":
            return (
              <View key={idx} style={[s.row, { paddingLeft: b.indent * 14 }]}>
                <Text style={[base, s.marker]}>{b.marker}</Text>
                <Text style={[base, s.flex]}>{renderInline(b.c)}</Text>
              </View>
            );
          case "quote":
            return (
              <View
                key={idx}
                style={[s.quote, { borderLeftColor: colors.accent }]}
              >
                <Text style={[base, s.italic]}>{renderInline(b.c)}</Text>
              </View>
            );
          case "code":
            return (
              <View
                key={idx}
                style={[s.codeBlock, { backgroundColor: colors.card }]}
              >
                <Text style={[s.codeText, { color: colors.text }]}>{b.v}</Text>
              </View>
            );
          case "para":
            return (
              <Text key={idx} style={base}>
                {renderInline(b.c)}
              </Text>
            );
        }
      })}
    </View>
  );
}

const s = StyleSheet.create({
  text: { fontFamily: "Inter_400Regular", fontSize: 12, lineHeight: 19 },
  // Custom fonts ignore fontWeight on Android, so swap the family instead.
  bold: { fontFamily: "Inter_700Bold" },
  italic: { fontStyle: "italic" },
  strike: { textDecorationLine: "line-through" },
  inlineCode: { fontFamily: "monospace", fontSize: 11 },
  heading: { fontFamily: "Inter_700Bold", marginTop: 4, marginBottom: 2 },
  h1: { fontSize: 16, lineHeight: 22 },
  h2: { fontSize: 14, lineHeight: 20 },
  h3: { fontSize: 13, lineHeight: 19 },
  row: { flexDirection: "row", alignItems: "flex-start" },
  marker: { width: 18 },
  flex: { flex: 1 },
  gap: { height: 6 },
  hr: { height: StyleSheet.hairlineWidth, marginVertical: 8 },
  quote: { borderLeftWidth: 3, paddingLeft: 8, marginVertical: 2 },
  codeBlock: { borderRadius: 6, padding: 8, marginVertical: 4 },
  codeText: { fontFamily: "monospace", fontSize: 11, lineHeight: 16 },
});
