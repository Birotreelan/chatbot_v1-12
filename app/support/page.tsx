import { SupportDashboard } from "@/components/support/support-dashboard"

export default function SupportPage() {
  return (
    <div className="container mx-auto py-3 px-4">
      <SupportDashboard />
    </div>
  )
}

export const dynamic = "force-dynamic"
