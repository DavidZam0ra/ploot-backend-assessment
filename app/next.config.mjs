/** @type {import('next').NextConfig} */
const nextConfig = {
  // Imagen de Docker mínima: solo el server.js standalone + node_modules podados, sin arrastrar
  // el resto del monorepo (pnpm workspace) a la imagen final.
  output: "standalone",
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
