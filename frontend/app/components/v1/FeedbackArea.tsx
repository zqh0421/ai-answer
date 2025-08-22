export default function FeedbackArea({ result, isFeedbackLoading }: { result: string, isFeedbackLoading: boolean }) {
  return (
    <div className="mb-4 p-4 bg-gray-100 rounded-lg shadow-md w-full">
      <h3 className="text-xl font-semibold">Feedback:</h3>
      {result && !isFeedbackLoading ? <p>{result}</p> : <p>{isFeedbackLoading ? "Loading feedback..." : "No feedback yet"}</p>}
    </div>
  );
}