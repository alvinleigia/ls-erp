import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  outputFileTracingExcludes: {
    // This application uses Prisma's JS client and PostgreSQL compiler. Keep
    // their generated runtime; omit engines for databases we do not support.
    "/*": [
      "./node_modules/@prisma/client/runtime/query_engine_bg.*",
      "./node_modules/@prisma/client/runtime/query_compiler_bg.{cockroachdb,mysql,sqlite,sqlserver}.*",
    ],
  },
  outputFileTracingIncludes: {
    "/api/crm/quotations/*/pdf": ["./public/assets/fonts/NotoSans-*.ttf"],
    "/api/crm/quotations/*/issue": ["./public/assets/fonts/NotoSans-*.ttf"],
    "/api/crm/quotation-layout/preview": ["./public/assets/fonts/NotoSans-*.ttf"],
    "/api/sales-orders/*/documents/preview": ["./public/assets/fonts/NotoSans-*.ttf"],
    "/api/sales-orders/*/documents/issue": ["./public/assets/fonts/NotoSans-*.ttf"],
    "/api/document-templates/preview": ["./public/assets/fonts/NotoSans-*.ttf"],
    "/api/payment-receipts/*/documents/preview": ["./public/assets/fonts/NotoSans-*.ttf"],
    "/api/payment-receipts/*/documents/issue": ["./public/assets/fonts/NotoSans-*.ttf"],
  },
};

export default nextConfig;
