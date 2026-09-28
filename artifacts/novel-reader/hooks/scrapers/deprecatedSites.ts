// artifacts/novel-reader/hooks/scrapers/deprecatedSites.ts

export interface DeprecatedSite {
  domain: string;
  reason: string;
  aliases?: string[]; // Alternative domains
}

const DEPRECATED_SITES: DeprecatedSite[] = [
  {
    domain: "novelbin.me",
    reason: "Site Shutdown",
    aliases: [],
  },
  {
    domain: "novelbin.com",
    reason: "Site Shutdown",
    aliases: [],
  },
  {
    domain: "novelarrow",
    reason: "Changed domain",
    aliases: ["novelarrow.net", "novelarrow.com"],
  },
];

/**
 * Check if a URL is from a deprecated/dead site
 * @param url - The URL to check
 * @returns Object with isDeprecated flag and reason, or null if not deprecated
 */
export const checkDeprecatedSite = (
  url: string,
): { isDeprecated: true; reason: string; siteName: string } | null => {
  try {
    const urlObj = new URL(url);
    const hostname = urlObj.hostname.toLowerCase();

    for (const site of DEPRECATED_SITES) {
      // Check main domain
      if (hostname.includes(site.domain.toLowerCase())) {
        return {
          isDeprecated: true,
          reason: site.reason,
          siteName: site.domain,
        };
      }

      // Check aliases
      if (site.aliases) {
        for (const alias of site.aliases) {
          if (hostname.includes(alias.toLowerCase())) {
            return {
              isDeprecated: true,
              reason: site.reason,
              siteName: site.domain,
            };
          }
        }
      }
    }

    return null;
  } catch (error) {
    console.error("Error checking deprecated site:", error);
    return null;
  }
};

/**
 * Get friendly message for deprecated site
 */
export const getDeprecatedSiteMessage = (
  siteName: string,
  reason: string,
): string => {
  return `⚠️ YOU HAVE ENTERED A LINK FROM A DEPRECATED / DEAD SITE\n\n📍 Site: ${siteName}\n❌ Status: ${reason}\n\nThis site is no longer supported. Please try another source.`;
};
