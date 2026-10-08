import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // unpdf ships its own pdf.js build; load it from node_modules as is.
  serverExternalPackages: ["stripe", "unpdf"],
};

export default nextConfig;
