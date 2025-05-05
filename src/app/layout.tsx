import type {Metadata} from 'next';
// Correct import for Geist fonts
import { GeistSans } from 'geist/font/sans';
import { GeistMono } from 'geist/font/mono';
import './globals.css';
import { Toaster } from "@/components/ui/toaster"; // Import Toaster

// Initialize fonts and get their variable names
// The font objects themselves provide the necessary class names and variables
// const geistSans = GeistSans({ // No need to call GeistSans like this
//   variable: '--font-geist-sans',
//   subsets: ['latin'],
// });

// const geistMono = GeistMono({ // No need to call GeistMono like this
//   variable: '--font-geist-mono',
//   subsets: ['latin'],
// });

export const metadata: Metadata = {
  title: 'Cliente Web Traccar',
  description: 'Cliente web para rastreamento GPS Traccar',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="pt-BR"> {/* Changed lang to pt-BR */}
      {/* Apply font variables and base classes directly from the imported font objects */}
      <body className={`${GeistSans.variable} ${GeistMono.variable} font-sans antialiased bg-background text-foreground`}>
        {children}
        <Toaster /> {/* Add Toaster component here */}
      </body>
    </html>
  );
}
