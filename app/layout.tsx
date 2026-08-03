import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Đánh giá FOMO theo Presence",
  description: "Đánh giá mô hình Edge Impulse FOMO theo sự hiện diện của lớp.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="vi">
      <body>{children}</body>
    </html>
  );
}
