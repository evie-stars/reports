import type { Metadata, Viewport } from "next";
import { Poppins } from "next/font/google";
import "./globals.css";

const poppins = Poppins({
  subsets: ["latin"],
  weight: ["300", "400", "500", "600", "700"],
  variable: "--font-poppins",
  display: "swap"
});

export const metadata: Metadata = {
  title: "Report Hub",
  description: "Local SEO rank tracking and client reporting for Star Websites"
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#1E232D"
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={poppins.variable}>
      {/* From md up the app is a fixed shell: dark backdrop, sidebar, and a light content panel
          inset with rounded corners that scrolls inside itself. Phones stay full-bleed. */}
      <body className="md:h-screen md:overflow-hidden">
        <div aria-hidden className="fixed inset-0 -z-10 bg-sidebar" />
        {children}
      </body>
    </html>
  );
}
