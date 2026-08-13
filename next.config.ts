import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // The Originals route reads the art off disk when PONS_ORIGINALS_ART_CID is unset. Files under
  // public/ are served by the CDN and are not part of a serverless bundle unless traced in, so pin
  // them explicitly rather than relying on the tracer inferring the directory read.
  outputFileTracingIncludes: {
    '/api/seats/originals': ['./public/originals/variants/**'],
  },
  images: {
    remotePatterns: [
      { protocol: 'https', hostname: 'gateway.pinata.cloud' },
      { protocol: 'https', hostname: '**.mypinata.cloud' },
      { protocol: 'https', hostname: 'ipfs.io' },
      { protocol: 'https', hostname: '**.ipfs.dweb.link' },
      { protocol: 'https', hostname: 'sgrs.debot.ai' },
    ],
  },
};

export default nextConfig;
