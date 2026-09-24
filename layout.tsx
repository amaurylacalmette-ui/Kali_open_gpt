import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { Toaster } from "@/components/ui/toaster";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Kali AI Pentest Suite — AI-Assisted Vulnerability Assessment",
  description:
    "Web-hosted Kali Linux-style offensive security environment: live recon tooling, interactive terminal, and AI vulnerability analysis powered by your own OpenAI or OpenRouter key (best-free-model autopilot).",
  keywords: ["Kali Linux", "AI pentest", "vulnerability scanner", "OpenAI", "OpenRouter", "security"],
  icons: {
    icon: "data:image/svg+xml," + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><path fill="#367bf0" d="M58 6 L42 14 L30 12 L36 19 L18 20 L27 26 L8 30 L24 35 L14 44 L28 41 L26 54 L38 44 L44 50 L46 39 L58 33 L47 29 L56 18 L44 21 Z"/></svg>'),
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning className="dark">
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased bg-[#0b0e13] text-slate-200`}
        style={{ fontFamily: "var(--font-geist-sans), ui-sans-serif, system-ui, sans-serif" }}
      >
        {children}
        <Toaster />
      </body>
    </html>
  );
}
