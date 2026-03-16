import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";

type RefreshVectorItem = {
  question_id?: string;
  question_version_id?: string;
};

const getBackendApiBaseUrl = () =>
  process.env.BACKEND_ENV === "development" ? "http://127.0.0.1:8000/api" : "https://api.muf-in.com/api";

const normalizeErrorMessage = async (response: Response) => {
  try {
    const data = await response.json();
    const detail = data?.detail;
    if (typeof detail === "string" && detail.trim()) return detail.trim();
    if (detail !== undefined) return JSON.stringify(detail);
    if (typeof data?.message === "string" && data.message.trim()) return data.message.trim();
  } catch {
    try {
      const text = await response.text();
      if (text.trim()) return text.trim();
    } catch {
      return `Request failed with status ${response.status}`;
    }
  }
  return `Request failed with status ${response.status}`;
};

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const updatedBy = typeof body?.updated_by === "string" ? body.updated_by.trim() : "";
    const items = Array.isArray(body?.items) ? (body.items as RefreshVectorItem[]) : [];

    if (!updatedBy) {
      return NextResponse.json({ detail: "updated_by is required." }, { status: 400 });
    }
    if (items.length === 0) {
      return NextResponse.json({ detail: "items must be a non-empty array." }, { status: 400 });
    }

    const backendApiBaseUrl = getBackendApiBaseUrl();
    const settled = [];
    for (const item of items) {
        const questionId = typeof item?.question_id === "string" ? item.question_id.trim() : "";
        const questionVersionId =
          typeof item?.question_version_id === "string" ? item.question_version_id.trim() : "";

        if (!questionId || !questionVersionId) {
          settled.push({
            ok: false,
            question_id: questionId || undefined,
            code: "INVALID_INPUT",
            message: "question_id and question_version_id are required.",
          });
          continue;
        }

        const response = await fetch(
          `${backendApiBaseUrl}/questions/${encodeURIComponent(questionId)}/versions/${encodeURIComponent(
            questionVersionId
          )}/refresh-vectors`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
            },
            body: JSON.stringify({ updated_by: updatedBy }),
            cache: "no-store",
          }
        );

        if (!response.ok) {
          settled.push({
            ok: false,
            question_id: questionId,
            code: `HTTP_${response.status}`,
            message: await normalizeErrorMessage(response),
          });
          continue;
        }

        settled.push({
          ok: true,
          question_id: questionId,
        });
    }

    const successIds = settled.filter((item) => item.ok).map((item) => item.question_id).filter(Boolean);
    const failed = settled
      .filter((item) => !item.ok)
      .map((item) => ({
        question_id: item.question_id,
        code: item.code,
        message: item.message,
      }));

    return NextResponse.json({
      ok: failed.length === 0,
      requested_count: items.length,
      success_count: successIds.length,
      failed_count: failed.length,
      success_ids: successIds,
      failed,
    });
  } catch (error) {
    console.error("Batch refresh-vectors route error:", error);
    return NextResponse.json({ detail: "Failed to refresh vectors." }, { status: 500 });
  }
}
