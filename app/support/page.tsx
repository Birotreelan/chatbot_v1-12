import { SupportDashboard } from "@/components/support/support-dashboard"

export default function SupportPage() {
  return (
    <div className="container mx-auto py-8">
      <SupportDashboard />
    </div>
  )
}

export const dynamic = "force-dynamic"
