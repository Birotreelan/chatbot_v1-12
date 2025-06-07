"use client"

import { useEffect, useState } from "react"
import { ChatWidget } from "./chat-widget"

interface EmbeddableWidgetProps {
  configId: string
  title?: string
  primaryColor?: string
  secondaryColor?: string
  position?: "bottom-right" | "bottom-left"
  welcomeMessage?: string
}

export function EmbeddableWidget(props: EmbeddableWidgetProps) {
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    setMounted(true)
  }, [])

  if (!mounted) return null

  return <ChatWidget {...props} />
}
