/** @type {import('next').NextConfig} */
const nextConfig = {
  // "standalone" es solo para el self-host en Docker (imagen mínima, ver app/Dockerfile) —
  // Vercel empaqueta sus propias Lambdas y NO entiende este modo: si se deja fijo, "vercel
  // build" deja de tratar el proyecto como Next.js y falla buscando un directorio "public"
  // (ver DECISIONS.md #19). VERCEL=1 lo fija automáticamente el propio build de Vercel.
  ...(process.env.VERCEL ? {} : { output: "standalone" }),
  webpack: (config) => {
    // @ploot/core usa moduleResolution: NodeNext y escribe extensión .js explícita en sus
    // imports relativos internos (obligatorio para tsc en worker/app, que sí usan NodeNext).
    // El bundler de Next no resuelve ".js" a un archivo ".ts" por defecto — esto le dice que sí.
    config.resolve.extensionAlias = {
      ".js": [".ts", ".tsx", ".js"],
    };
    return config;
  },
};

export default nextConfig;
