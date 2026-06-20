import "./globals.css";

export const metadata = {
  title: "WC ANG",
  description: "Prediction league rebuild.",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Manrope:wght@400;600;700;800&family=Bebas+Neue&display=swap"
        />
      </head>
      <body>
        <div className="app-shell">
          <header className="topbar">
            <a className="brand" href="/">
              <strong>WC ANG</strong>
              <span>Prediction League</span>
            </a>
          </header>
          {children}
        </div>
      </body>
    </html>
  );
}
