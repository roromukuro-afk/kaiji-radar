import type { NextConfig } from "next";

const GOOGLE_CLIENT_ID =
  process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID ||
  "1096191342257-jnbq0eh422mfs7orvki3uimnfguut7g7.apps.googleusercontent.com";

const nextConfig: NextConfig = {
  env: {
    NEXT_PUBLIC_GOOGLE_CLIENT_ID: GOOGLE_CLIENT_ID,
  },
  async headers() {
    return [
      {
        source: "/sw.js",
        headers: [
          { key: "Content-Type", value: "application/javascript; charset=utf-8" },
          { key: "Cache-Control", value: "no-cache, no-store, must-revalidate" },
          { key: "Service-Worker-Allowed", value: "/" },
        ],
      },
    ];
  },
};

export default nextConfig;
