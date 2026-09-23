/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    // Modulo nativo: va caricato da node_modules, non bundlato.
    serverComponentsExternalPackages: ['better-sqlite3'],
  },
};

export default nextConfig;
