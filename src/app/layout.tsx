import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { TimezoneProvider } from "@/contexts/TimezoneContext";
import { SessionProvider } from "@/components/providers/session-provider";
import { ThemeProvider } from "@/components/providers/theme-provider";
import { SettingsProvider } from "@/contexts/settings-context";
import { TestDataCacheProvider } from "@/contexts/TestDataCacheContext";
import { AnnotationCacheProvider } from "@/contexts/AnnotationCacheContext";
import { HoverSidebar } from "@/components/hover-sidebar";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Burnin Test Dashboard",
  description: "View Test Summaries, and Individual Tests",
  icons: "/logo.png"
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        <ThemeProvider
          attribute="class"
          defaultTheme="system"
          enableSystem
          disableTransitionOnChange
        >
          <SettingsProvider>
            <SessionProvider>
              <TimezoneProvider>
                <TestDataCacheProvider>
                  <AnnotationCacheProvider>
                    <HoverSidebar />
                    {children}
                  </AnnotationCacheProvider>
                </TestDataCacheProvider>
              </TimezoneProvider>
            </SessionProvider>
          </SettingsProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
