"use client"

import { useSearchParams } from "next/navigation"

export default function ChatPage({ params }: { params: { id: string } }) {
  // Check if this is embedded mode (for widget)
  const searchParams = useSearchParams()
  const isEmbedded = searchParams.get("embedded") === "true"

  // If embedded, apply different styles or layout
  const containerClassName = isEmbedded
    ? "h-screen flex flex-col overflow-hidden"
    : "container mx-auto max-w-4xl p-4 h-screen flex flex-col"

  return (
    <div className={containerClassName}>
      <h1>Chat with ID: {params.id}</h1>
      {/* Chat content will go here */}
    </div>
  )
}
