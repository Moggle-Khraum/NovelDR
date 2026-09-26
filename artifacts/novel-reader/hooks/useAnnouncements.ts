import { useEffect, useState, useRef } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useAppState } from "@react-native-community/hooks";

export interface Announcement {
  id: string;
  title: string;
  body: string;
  createdAt: string;
  url: string;
  author: string;
}

const GITHUB_REPO = "Moggle-Khraum/NovelDR";
const CATEGORY_NAME = "Announcements";
const POLL_INTERVAL = 10 * 60 * 1000; // 10 minutes
const DISMISSED_KEY = "dismissed_announcements";
const LAST_CHECK_KEY = "last_announcement_check";

export const useAnnouncements = () => {
  const [announcement, setAnnouncement] = useState<Announcement | null>(null);
  const [hasNew, setHasNew] = useState(false);
  const [loading, setLoading] = useState(false);
  const pollTimerRef = useRef<NodeJS.Timeout | null>(null);
  const appState = useAppState();

  // Fetch latest announcement from GitHub Discussions
  const fetchLatestAnnouncement = async () => {
    try {
      setLoading(true);

      // GitHub GraphQL query for discussions
      const query = `
        query {
          repository(owner: "Moggle-Khraum", name: "NovelDR") {
            discussions(first: 1, categoryId: "DIC_kwDODX6nJs4CbZXs", orderBy: {field: CREATED_AT, direction: DESC}) {
              nodes {
                id
                title
                body
                createdAt
                url
                author {
                  login
                }
              }
            }
          }
        }
      `;

      const response = await fetch("https://api.github.com/graphql", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          // Public query, no auth needed for public repos
        },
        body: JSON.stringify({ query }),
      });

      const data = await response.json();

      if (
        data.data?.repository?.discussions?.nodes?.[0]
      ) {
        const latest = data.data.repository.discussions.nodes[0];
        const newAnnouncement: Announcement = {
          id: latest.id,
          title: latest.title,
          body: latest.body,
          createdAt: latest.createdAt,
          url: latest.url,
          author: latest.author?.login || "NovelDR Team",
        };

        // Check if dismissed
        const dismissed = await AsyncStorage.getItem(DISMISSED_KEY);
        const dismissedIds = dismissed ? JSON.parse(dismissed) : [];

        if (!dismissedIds.includes(newAnnouncement.id)) {
          setAnnouncement(newAnnouncement);
          setHasNew(true);
        } else {
          setAnnouncement(newAnnouncement);
          setHasNew(false);
        }

        // Update last check time
        await AsyncStorage.setItem(
          LAST_CHECK_KEY,
          new Date().toISOString()
        );
      }
    } catch (error) {
      console.error("Failed to fetch announcements:", error);
    } finally {
      setLoading(false);
    }
  };

  // Dismiss current announcement
  const dismissAnnouncement = async () => {
    if (!announcement) return;

    try {
      const dismissed = await AsyncStorage.getItem(DISMISSED_KEY);
      const dismissedIds = dismissed ? JSON.parse(dismissed) : [];

      if (!dismissedIds.includes(announcement.id)) {
        dismissedIds.push(announcement.id);
        await AsyncStorage.setItem(
          DISMISSED_KEY,
          JSON.stringify(dismissedIds)
        );
      }

      setHasNew(false);
    } catch (error) {
      console.error("Failed to dismiss announcement:", error);
    }
  };

  // Format relative time
  const getRelativeTime = (dateString: string): string => {
    const date = new Date(dateString);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 1) return "now";
    if (diffMins < 20) return "latest";
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    if (diffDays < 7) return `${diffDays}d ago`;

    return date.toLocaleDateString();
  };

  // Set up polling
  useEffect(() => {
    // Fetch immediately
    fetchLatestAnnouncement();

    // Set up interval
    pollTimerRef.current = setInterval(fetchLatestAnnouncement, POLL_INTERVAL);

    return () => {
      if (pollTimerRef.current) {
        clearInterval(pollTimerRef.current);
      }
    };
  }, []);

  // Refetch when app comes to foreground
  useEffect(() => {
    if (appState === "active") {
      fetchLatestAnnouncement();
    }
  }, [appState]);

  return {
    announcement,
    hasNew,
    loading,
    dismissAnnouncement,
    getRelativeTime,
  };
};
