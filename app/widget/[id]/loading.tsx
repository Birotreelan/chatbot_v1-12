export default function WidgetLoading() {
  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
      <div className="w-full max-w-md h-[600px] rounded-lg shadow-lg overflow-hidden bg-white">
        <div className="h-full flex flex-col">
          {/* Header skeleton */}
          <div className="p-4 bg-blue-500">
            <div className="h-6 bg-blue-400 rounded mb-2 animate-pulse"></div>
            <div className="h-4 bg-blue-400 rounded w-3/4 animate-pulse"></div>
          </div>

          {/* Messages area skeleton */}
          <div className="flex-1 p-4 space-y-4">
            <div className="flex justify-start">
              <div className="bg-gray-200 rounded-lg p-3 max-w-[80%] animate-pulse">
                <div className="h-4 bg-gray-300 rounded mb-2"></div>
                <div className="h-4 bg-gray-300 rounded w-3/4"></div>
              </div>
            </div>
          </div>

          {/* Input area skeleton */}
          <div className="p-4 border-t border-gray-200">
            <div className="flex space-x-2">
              <div className="flex-1 h-10 bg-gray-200 rounded animate-pulse"></div>
              <div className="w-10 h-10 bg-gray-200 rounded animate-pulse"></div>
            </div>
          </div>

          {/* Footer skeleton */}
          <div className="p-2 text-center">
            <div className="h-3 bg-gray-200 rounded w-24 mx-auto animate-pulse"></div>
          </div>
        </div>
      </div>
    </div>
  )
}
