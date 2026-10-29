import { varlockNextConfigPlugin } from "@varlock/nextjs-integration/plugin";
import type { NextConfig } from "next";

import { securityHeaders } from "./src/lib/security-headers";

const withVarlock = varlockNextConfigPlugin();

const production = process.env.NODE_ENV === "production";

const nextConfig: NextConfig = {
  typedRoutes: true,
  reactCompiler: true,
  async headers() {
    return [
      {
        // Every route, including the auth handlers and static assets: a header
        // that only some paths send is a header you cannot reason about.
        source: "/:path*",
        headers: securityHeaders(production),
      },
    ];
  },
};

export default withVarlock(nextConfig);
