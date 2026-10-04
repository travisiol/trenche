import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /** a second dev server next to the main one (tests on another port) needs its own build dir:
   *  TRENCH_DIST_DIR=.next-test npx next dev -p 3985 — the default stays .next */
  distDir: process.env.TRENCH_DIST_DIR?.trim() || ".next",
};

export default nextConfig;
