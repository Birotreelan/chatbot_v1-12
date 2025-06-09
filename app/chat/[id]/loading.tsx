import { Loader2 } from "lucide-react"

export default function ChatLoading() {
  return (
    <div className="flex h-screen w-full flex-col items-center justify-center bg-gray-50">
      <div className="flex flex-col items-center justify-center gap-4 p-4 text-center">
        <Loader2 className="h-10 w-10 animate-spin text-gray-500" />
        <h2 className="text-xl font-semibold text-gray-700">Loading chat...</h2>
        <p className="text-sm text-gray-500">Please wait while we set up your chat session</p>
      </div>
    </div>
  )
}
