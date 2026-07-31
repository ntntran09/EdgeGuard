import path from "node:path";
import { fileURLToPath } from "node:url";
import type { NextConfig } from "next";
import dotenv from "dotenv";

const __filename = fileURLToPath(import.meta.url);
const appRoot = path.dirname(__filename);

dotenv.config({ path: path.resolve(appRoot, "../.env") });
dotenv.config({ path: path.resolve(appRoot, ".env"), override: true });
dotenv.config({ path: path.resolve(appRoot, ".env.local"), override: true });

const telegramAuthRequired = process.env.NEXT_PUBLIC_TELEGRAM_AUTH_REQUIRED
  ?? process.env.TELEGRAM_AUTH_REQUIRED
  ?? "true";

const nextConfig: NextConfig = {
  reactCompiler: true,
  devIndicators: false,
  env: {
    NEXT_PUBLIC_TELEGRAM_AUTH_REQUIRED: telegramAuthRequired,
  },
  images: {
    remotePatterns: [
      { protocol: 'https', hostname: '**' },
      { protocol: 'http', hostname: '**' },
    ],
  },
};

export default nextConfig;