/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
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
          process.env.NODE_ENV === "development"
            ? "http://127.0.0.1:8000/api/:path*"
            : "http://127.0.0.1:8000/api/:path*",
      },
      {
        source: "/docs",
        destination:
          process.env.NODE_ENV === "development"
            ? "http://127.0.0.1:8000/docs"
            : "/docs",
      },
      {
        source: "/openapi.json",
        destination:
          process.env.NODE_ENV === "development"
            ? "http://127.0.0.1:8000/openapi.json"
            : "/openapi.json",
      }
    ];
  },
  env: {
    NEXT_PUBLIC_API_URL: 'http://ec2-3-133-205-224.us-east-2.compute.amazonaws.com:3000/',
  },
};

export default nextConfig;