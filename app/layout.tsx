import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: "Phoenix's Sky",
  description: "Phoenix's Sky — an agent-native calendar you can fully customize with AI",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@400;500;600;700&family=DM+Serif+Display&family=Source+Serif+4:ital,wght@0,400;0,600;1,400&family=Orbitron:wght@400;500;700&family=VT323&family=Rajdhani:wght@400;500;600;700&display=swap"
          rel="stylesheet"
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
