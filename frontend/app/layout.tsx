import type { Metadata } from "next";

import { CopilotKit } from "@copilotkit/react-core";
import "@copilotkit/react-ui/styles.css";
import "./globals.css";

export const metadata: Metadata = {
  title: "Research Assistant",
  description:
    "POC: LangGraph (Python) research agent with a CopilotKit frontend.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="antialiased">
        <CopilotKit runtimeUrl="/api/copilotkit" agent="research_agent">
          {children}
        </CopilotKit>
      </body>
    </html>
  );
}
