import './globals.css';

export const metadata = {
  title: 'NNBUilder',
  description: 'Visual neural-net builder',
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>
        <header className="topbar">
          <div className="brand">
            <span className="brand-mark">NNBUilder</span>
          </div>
        </header>
        {children}
      </body>
    </html>
  );
}
