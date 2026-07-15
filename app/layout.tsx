import type {Metadata, Viewport} from 'next';
import './globals.css'; // Global styles
import {ServiceWorkerRegistration} from './ServiceWorkerRegistration';

export const metadata: Metadata = {
  title: 'NodeShell Control Center',
  description: 'Trung tâm quản trị, giám sát và vận hành server',
  applicationName: 'NodeShell Control Center',
  manifest: '/manifest.webmanifest',
  appleWebApp: {
    capable: true,
    title: 'NodeShell',
    statusBarStyle: 'black-translucent',
  },
};

export const viewport: Viewport = {
  themeColor: '#0f172a',
};

export default function RootLayout({children}: {children: React.ReactNode}) {
  return (
    <html lang="vi">
      <body suppressHydrationWarning>
        <ServiceWorkerRegistration />
        {children}
      </body>
    </html>
  );
}
