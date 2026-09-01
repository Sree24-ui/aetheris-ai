import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["@xenova/transformers", "pdf-parse", "sharp", "onnxruntime-node"],
  // The onnxruntime-node native binary (used by @xenova/transformers for
  // local embeddings) lives under node_modules and isn't always picked up
  // by Next's static import tracing, which drops it from the serverless
  // function bundle on platforms like Vercel and breaks it at runtime with
  // "cannot open shared object file". Force-include it for every route that
  // can reach the embeddings pipeline (upload + RAG-grounded lesson planning).
  outputFileTracingIncludes: {
    "/api/upload": ["./node_modules/onnxruntime-node/bin/**/*"],
    "/api/lesson/plan": ["./node_modules/onnxruntime-node/bin/**/*"],
  },
};

export default nextConfig;
