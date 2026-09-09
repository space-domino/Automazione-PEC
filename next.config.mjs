/** @type {import('next').NextConfig} */
const nextConfig = {
  // Build autonomo per l'immagine Docker (copia solo il necessario in .next/standalone)
  output: "standalone",
  reactStrictMode: true,
  poweredByHeader: false,

  // Pacchetti server-only che NON devono essere bundlati da Next (hanno binari/native addon)
  serverExternalPackages: [
    "argon2",
    "bullmq",
    "ioredis",
    "pino",
    "@prisma/client",
    "imapflow",
    "nodemailer",
    "@anthropic-ai/sdk",
  ],

  // Header di sicurezza di base (la CSP fine-grained arriva con le landing, M7)
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=()",
          },
        ],
      },
    ];
  },
};

export default nextConfig;
