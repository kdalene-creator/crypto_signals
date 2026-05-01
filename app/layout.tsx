export const metadata = {
  title: 'BTC Scalping Signals',
  description: 'Alerts-only bot for BTC scalping setups',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
