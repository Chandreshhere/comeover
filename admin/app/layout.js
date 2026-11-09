import { Poppins } from 'next/font/google';
import './globals.css';

const poppins = Poppins({ subsets: ['latin'], weight: ['400', '500', '600', '700'], variable: '--font-poppins', display: 'swap' });

export const metadata = {
  title: 'Come Over Admin',
  description: 'Come Over moderation, safety and operations console',
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }) {
  return (
    <html lang="en-IN" className={poppins.variable}>
      <body>{children}</body>
    </html>
  );
}
