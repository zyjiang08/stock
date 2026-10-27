import './globals.css';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'PhoenixSig',
  description: 'Shares-only PhoenixSig model with a 15% next-quarter TQQQ target, backtest, and Telegram alerts.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
