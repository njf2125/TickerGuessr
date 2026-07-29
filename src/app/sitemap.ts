import type { MetadataRoute } from "next";

export default function sitemap(): MetadataRoute.Sitemap {
  return [
    {
      url: "https://tickerguessr.app",
      changeFrequency: "daily",
      priority: 1,
    },
  ];
}
