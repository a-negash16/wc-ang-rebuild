import "./globals.css";

export const metadata = {
  title: "WC ANG",
  description: "Prediction league rebuild.",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>
        <div className="app-shell">
          <header className="topbar">
            <div className="brand">
              <strong>WC ANG</strong>
              <span>Prediction league rebuild</span>
            </div>
            <nav aria-label="Primary">
              <a href="/">Overview</a>
              <a href="/squad">Squad</a>
              <a href="/admin">Admin</a>
            </nav>
          </header>
          {children}
        </div>
      </body>
    </html>
  );
}
