import type { Metadata } from "next";
import { Geist, Geist_Mono, Inter, DM_Sans, Space_Grotesk, IBM_Plex_Sans } from "next/font/google";
import "./globals.css";
import "./blockx.css";

/* Block X loads Geist by default and lets the user switch the UI face (Settings → Appearance → Font).
   Every face is loaded here with the same variable names Block X's stylesheet expects. */
const geist = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });
const inter = Inter({ variable: "--font-inter", subsets: ["latin"] });
const dmSans = DM_Sans({ variable: "--font-dm-sans", subsets: ["latin"] });
const spaceGrotesk = Space_Grotesk({ variable: "--font-space-grotesk", subsets: ["latin"] });
const ibmPlex = IBM_Plex_Sans({ variable: "--font-ibm-plex-sans", subsets: ["latin"], weight: ["400", "500", "600"] });

export const metadata: Metadata = {
  title: "DONCHAIN",
  description: "DONCHAIN — private pump.fun dev terminal: launch, trade, trench.",
  icons: { icon: "/favicon.ico" },
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" data-theme="base" data-font="geist" className={`${geist.variable} ${geistMono.variable} ${inter.variable} ${dmSans.variable} ${spaceGrotesk.variable} ${ibmPlex.variable} antialiased`} suppressHydrationWarning>
      <body>{children}</body>
    </html>
  );
}
