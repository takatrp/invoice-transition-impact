import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'インボイス経過措置 影響シミュレーター',
  description:
    '仕訳CSVから課税区分52・62・72を抽出し、インボイス経過措置率の変更による仕入控除税額への影響を試算します。',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ja">
      <body>{children}</body>
    </html>
  );
}
