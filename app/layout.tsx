import type {Metadata} from 'next';
import './globals.css'; // Global styles

export const metadata: Metadata = {
  title: 'Terminal quản lý Server',
  description: 'Terminal web quản lý và giám sát server',
};

export default function RootLayout({children}: {children: React.ReactNode}) {
  return (
    <html lang="vi">
      <body suppressHydrationWarning>{children}</body>
    </html>
  );
}
