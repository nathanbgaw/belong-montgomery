import type { Metadata, Viewport } from "next";
import { Cabin, Marcellus } from "next/font/google";
import "./globals.css";
import Header from "@/components/Header";
import Footer from "@/components/Footer";
import { COUNTY, COUNTY_LABEL } from "@/lib/county";

const marcellus = Marcellus({ variable: "--font-marcellus", subsets: ["latin"], weight: "400" });
const cabin = Cabin({ variable: "--font-cabin", subsets: ["latin"] });

export const metadata: Metadata = {
  title: { default: `Belong ${COUNTY}`, template: `%s · Belong ${COUNTY}` },
  description: `Say what you need and find help from churches and ministries in ${COUNTY_LABEL}. An open-source demo for Project Belong Maryland.`,
};

export const viewport: Viewport = { themeColor: "#BF3147" };

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${marcellus.variable} ${cabin.variable} h-full antialiased`}>
      <body className="flex min-h-full flex-col">
        <Header />
        <main className="w-full flex-1">{children}</main>
        <Footer />
      </body>
    </html>
  );
}
