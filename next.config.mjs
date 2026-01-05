/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  eslint: {
    ignoreDuringBuilds: true,
  },
  async headers() {
    return [
      {
        // Apply to all routes including the MCQ pages
        source: '/:path*',
        headers: [
          {
            key: 'Content-Security-Policy',
            value: "frame-ancestors 'self' https://*.qualtrics.com https://qualtrics.com http://localhost:* http://127.0.0.1:*;",
          },
          {
            key: 'X-Frame-Options',
            value: 'ALLOWALL', // This allows all domains to iframe - remove in production if not needed
          },
        ],
      },
      {
        // Specific headers for MCQ routes
        source: '/v2/mcq/:questionId*',
        headers: [
          {
            key: 'Content-Security-Policy', 
            value: "frame-ancestors 'self' https://*.qualtrics.com https://qualtrics.com http://localhost:* http://127.0.0.1:*;",
          },
          {
            key: 'X-Frame-Options',
            value: 'ALLOWALL',
          },
        ],
      },
    ];
  },
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'lh3.googleusercontent.com',
        pathname: '/drive-storage/**',
      },
      {
        protocol: 'https',
        hostname: 'mufin-basket.s3.amazonaws.com',
        pathname: '/uploads/**',
      },
    ],
  },
  rewrites: async () => {
    return [
      {
        source: "/api/:path((?!auth).*)", // Excludes any paths starting with "auth",
        destination:
          process.env.BACKEND_ENV === "development"
            ? "http://127.0.0.1:8000/api/:path*"
            : "https://api.muf-in.com/api/:path*",
      },
      {
        source: "/docs",
        destination:
          process.env.BACKEND_ENV === "development"
            ? "http://127.0.0.1:8000/docs"
            : "/docs",
      },
      {
        source: "/openapi.json",
        destination:
          process.env.BACKEND_ENV === "development"
            ? "http://127.0.0.1:8000/openapi.json"
            : "/openapi.json",
      }
    ];
  },
  env: {
    NEXT_PUBLIC_API_URL: 'https://mufin.com',
  },
};

export default nextConfig;