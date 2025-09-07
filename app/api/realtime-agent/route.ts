import { NextRequest, NextResponse } from "next/server";

export async function POST(request: NextRequest) {
  try {
    const { action, sessionConfig } = await request.json();

    if (action === "getToken") {
      // Generate ephemeral client secret using OpenAI's API
      const apiKey = process.env.OPENAI_API_KEY;

      if (!apiKey) {
        return NextResponse.json(
          { error: "OpenAI API key not configured" },
          { status: 500 }
        );
      }

      // Default session configuration for realtime assistant
      const config = sessionConfig || {
        session: {
          type: "realtime",
          model: "gpt-realtime",
          audio: {
            input: {
              format: { type: "audio/pcm", rate: 24000 },
            },
            output: {
              voice: "alloy",
              format: { type: "audio/pcm", rate: 24000 },
            },
          },
        },
      };

      try {
        // Request ephemeral client secret from OpenAI
        const response = await fetch(
          "https://api.openai.com/v1/realtime/client_secrets",
          {
            method: "POST",
            headers: {
              Authorization: `Bearer ${apiKey}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify(config),
          }
        );

        if (!response.ok) {
          const errorData = await response.text();
          console.error("OpenAI API error:", errorData);
          return NextResponse.json(
            { error: "Failed to generate client secret", details: errorData },
            { status: response.status }
          );
        }

        const data = await response.json();

        return NextResponse.json({
          clientSecret: data.value,
          success: true,
        });
      } catch (fetchError) {
        console.error("Failed to fetch client secret:", fetchError);
        return NextResponse.json(
          { error: "Failed to generate client secret" },
          { status: 500 }
        );
      }
    }

    return NextResponse.json(
      {
        error: "Invalid action",
      },
      { status: 400 }
    );
  } catch (error) {
    console.error("Realtime agent error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

export async function GET() {
  return NextResponse.json({
    message: "Realtime agent endpoint ready",
  });
}
