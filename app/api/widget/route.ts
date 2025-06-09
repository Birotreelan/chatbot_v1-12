import { NextResponse } from "next/server"

export async function GET(request: Request) {
  // Dummy data for demonstration purposes
  const config = {
    widgetAssistantId: "dummy_widget_assistant_id",
    // Other configuration options can be added here
  }

  return NextResponse.json({
    widgetAssistantId: config.widgetAssistantId,
    // Other configuration data can be added here
  })
}
