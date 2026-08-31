export const metadata = {
  title: "Ploot — Scheduler",
  description: "UI mínima de demostración del scheduler de publicación",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es">
      <body>{children}</body>
    </html>
  );
}
