import type { ReactNode } from 'react';

export const metadata = {
  title: 'PlainSheet',
  description: 'Clinical trial participant information, made navigable.',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
