import type { Metadata } from 'next';
import { Lato } from 'next/font/google';
import './globals.css';
import Header from './components/Header';
import Footer from './components/Footer';
import ClientProvider from './components/ClientProvider'; // 引入客户端逻辑组件

const lato = Lato({
  weight: '400',
  style: 'normal',
  subsets: ['latin'],
});

export const metadata: Metadata = {
  title: 'SlideItRight Feedback System',
  description: 'SlideItRight Feedback System for  by Chloe Qianhui (qianhuiz@cs.cmu.edu)',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className={`${lato.className} bg-gray-50`}>
        {/* Redux + SessionProvider 包裹在 ClientProvider 中 */}
        <div className="flex flex-col min-h-screen">
          {/* Header */}
          <Header />

          {/* Main Content Area */}
          <main className="flex-grow container mx-2 min-w-full p-6">
            <ClientProvider>{children}</ClientProvider>
          </main>

          {/* Footer */}
          <Footer />
        </div>
      </body>
    </html>
  );
}
