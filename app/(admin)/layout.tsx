import type { Metadata } from "next";

export const metadata: Metadata = { manifest: "/manifest.webmanifest" };

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return children;
}
