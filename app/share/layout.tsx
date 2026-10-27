import type { Metadata, Viewport } from "next";
import { ShareServiceWorkerRegistration } from "./share-service-worker-registration";

export const metadata: Metadata = {
  title: "NodeShell Share",
  description: "Gửi và nhận file nhanh trên NodeShell",
  applicationName: "NodeShell Share",
  manifest: "/share/manifest.webmanifest",
  appleWebApp: { capable: true, title: "NodeShell Share", statusBarStyle: "black-translucent" },
  icons: { icon: "/share/icon.svg", apple: "/share/icon-192.png" },
};

export const viewport: Viewport = { themeColor: "#071018" };

export default function ShareLayout({ children }: { children: React.ReactNode }) {
  return <><ShareServiceWorkerRegistration />{children}</>;
}
