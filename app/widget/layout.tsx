import type React from "react"
import type { Metadata } from "next"
import { Inter } from "next/font/google"
import "../globals.css"
import { ThemeProvider } from "@/components/theme-provider"
import { Toaster } from "@/components/ui/toaster"

const inter = Inter({ subsets: ["latin"] })

export const metadata: Metadata = {
  title: "Widget Chat - Treelan",
  description: "Widget de chat para sitios web",
}

export default function WidgetLayout({
  children,
}: {
  children: React.ReactNode
}) {
  console.log("[WIDGET-LAYOUT] 🎨 Renderizando layout del widget")

  return (
    <html lang="es" className={inter.className}>
      <head>
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <style
          dangerouslySetInnerHTML={{
            __html: `
            * {
              box-sizing: border-box;
            }
            
            html, body {
              margin: 0;
              padding: 0;
              height: 100%;
              font-family: system-ui, -apple-system, sans-serif;
            }
            
            #__next {
              height: 100%;
            }
            
            /* Asegurar que Tailwind funcione */
            .flex { display: flex; }
            .flex-col { flex-direction: column; }
            .flex-1 { flex: 1 1 0%; }
            .h-full { height: 100%; }
            .w-full { width: 100%; }
            .bg-white { background-color: rgb(255 255 255); }
            .bg-gray-50 { background-color: rgb(249 250 251); }
            .bg-blue-600 { background-color: rgb(37 99 235); }
            .text-white { color: rgb(255 255 255); }
            .text-gray-800 { color: rgb(31 41 55); }
            .text-gray-500 { color: rgb(107 114 128); }
            .text-sm { font-size: 0.875rem; line-height: 1.25rem; }
            .text-xs { font-size: 0.75rem; line-height: 1rem; }
            .font-semibold { font-weight: 600; }
            .p-4 { padding: 1rem; }
            .px-4 { padding-left: 1rem; padding-right: 1rem; }
            .py-3 { padding-top: 0.75rem; padding-bottom: 0.75rem; }
            .py-2 { padding-top: 0.5rem; padding-bottom: 0.5rem; }
            .rounded-lg { border-radius: 0.5rem; }
            .rounded-2xl { border-radius: 1rem; }
            .rounded-full { border-radius: 9999px; }
            .border { border-width: 1px; }
            .border-t { border-top-width: 1px; }
            .border-gray-300 { border-color: rgb(209 213 219); }
            .shadow-sm { box-shadow: 0 1px 2px 0 rgb(0 0 0 / 0.05); }
            .shadow-lg { box-shadow: 0 10px 15px -3px rgb(0 0 0 / 0.1), 0 4px 6px -4px rgb(0 0 0 / 0.1); }
            .overflow-hidden { overflow: hidden; }
            .overflow-y-auto { overflow-y: auto; }
            .space-y-3 > :not([hidden]) ~ :not([hidden]) { margin-top: 0.75rem; }
            .space-x-2 > :not([hidden]) ~ :not([hidden]) { margin-left: 0.5rem; }
            .space-x-3 > :not([hidden]) ~ :not([hidden]) { margin-left: 0.75rem; }
            .justify-start { justify-content: flex-start; }
            .justify-end { justify-content: flex-end; }
            .items-center { align-items: center; }
            .text-center { text-align: center; }
            .max-w-[85%] { max-width: 85%; }
            .whitespace-pre-wrap { white-space: pre-wrap; }
            .opacity-90 { opacity: 0.9; }
            .hover\\:bg-blue-50:hover { background-color: rgb(239 246 255); }
            .hover\\:bg-blue-700:hover { background-color: rgb(29 78 216); }
            .focus\\:border-blue-500:focus { border-color: rgb(59 130 246); }
            .focus\\:ring-blue-500:focus { --tw-ring-color: rgb(59 130 246); }
            .transition-all { transition-property: all; transition-timing-function: cubic-bezier(0.4, 0, 0.2, 1); transition-duration: 150ms; }
            .duration-200 { transition-duration: 200ms; }
            .cursor-pointer { cursor: pointer; }
            .disabled\\:opacity-50:disabled { opacity: 0.5; }
            .disabled\\:cursor-not-allowed:disabled { cursor: not-allowed; }
            
            /* Animaciones */
            @keyframes bounce {
              0%, 100% { transform: translateY(-25%); animation-timing-function: cubic-bezier(0.8,0,1,1); }
              50% { transform: none; animation-timing-function: cubic-bezier(0,0,0.2,1); }
            }
            .animate-bounce { animation: bounce 1s infinite; }
            
            /* Input styles */
            input {
              border: 1px solid rgb(209 213 219);
              border-radius: 9999px;
              padding: 0.75rem 1rem;
              font-size: 0.875rem;
              outline: none;
              width: 100%;
            }
            
            input:focus {
              border-color: rgb(59 130 246);
              box-shadow: 0 0 0 3px rgb(59 130 246 / 0.1);
            }
            
            /* Button styles */
            button {
              border: none;
              border-radius: 9999px;
              padding: 0.75rem 1rem;
              font-size: 0.875rem;
              font-weight: 500;
              cursor: pointer;
              transition: all 0.2s;
            }
            
            button:disabled {
              opacity: 0.5;
              cursor: not-allowed;
            }
            
            .btn-primary {
              background-color: rgb(37 99 235);
              color: white;
            }
            
            .btn-primary:hover:not(:disabled) {
              background-color: rgb(29 78 216);
            }
          `,
          }}
        />
      </head>
      <body className="h-full">
        <ThemeProvider attribute="class" defaultTheme="light" enableSystem disableTransitionOnChange>
          {children}
          <Toaster />
        </ThemeProvider>
      </body>
    </html>
  )
}
