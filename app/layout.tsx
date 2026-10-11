import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Hyper Monitor",
  description: "Check pages on a schedule with Hyperbrowser and see exactly what changed.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <main>
          {children}
          <footer>
            Runs on <a href="https://hyperbrowser.ai">Hyperbrowser</a> · checks run one at a time
          </footer>
        </main>
      </body>
    </html>
  );
}
