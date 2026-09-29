import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  outputFileTracingIncludes: {
    "/api/crm/quotations/*/pdf": ["./public/assets/fonts/NotoSans-Regular.ttf"],
  },
};

export default nextConfig;
