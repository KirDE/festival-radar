import type { MetadataRoute } from "next";

export const dynamic = "force-static";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Festival Radar",
    short_name: "Festival Radar",
    description: "European rock and metal festival dates, lineups and planning tools.",
    start_url: "/",
    display: "standalone",
    background_color: "#f2efe7",
    theme_color: "#171712",
    icons: [{ src: "/icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" }],
  };
}
