/** @type {import('next').NextConfig} */
const nextConfig = {
  async rewrites() {
    // Always proxy /api/* to the API server so the browser stays same-origin:
    // session cookies and the SSE progress stream then work without CORS in
    // every topology (dev on :4000, or a deployed API via NEXT_PUBLIC_API_URL).
    const apiBase =
      process.env.BACKEND_API_URL ||
      process.env.NEXT_PUBLIC_API_URL ||
      "http://localhost:4000";
    return [{ source: "/api/:path*", destination: `${apiBase}/api/:path*` }];
  },
};

export default nextConfig;
