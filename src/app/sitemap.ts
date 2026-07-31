import type { MetadataRoute } from "next";

export default function sitemap(): MetadataRoute.Sitemap {
  return [
    {
      url: "https://tickerguessr.app",
      changeFrequency: "daily",
      priority: 1,
    },
    {
      url: "https://tickerguessr.app/privacy",
      changeFrequency: "yearly",
      priority: 0.2,
    },
  ];
}
