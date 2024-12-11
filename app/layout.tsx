import type { Metadata } from 'next';
import { Lato } from 'next/font/google';
import './globals.css';
import Header from './components/Header';
import Footer from './components/Footer';
import { SessionProvider } from "next-auth/react";

const lato = Lato({
  weight: '400',
  style: 'normal',
  subsets: ['latin'],
});

export const metadata: Metadata = {
  title: 'MuFIN: Information Retrieval',
  description: 'MuFIN: Information Retrieval by Chloe Qianhui',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className={`${lato.className} bg-gray-50`}>
        {/* Main Content */}
        <div className="flex flex-col min-h-screen">
          {/* Header */}
          <Header />

          {/* Main Content Area */}
          <main className="flex-grow container mx-2 min-w-full p-6">
            <SessionProvider>{children}</SessionProvider>
          </main>

          {/* Footer */}
          <Footer />
        </div>
      </body>
    </html>
  );
}
