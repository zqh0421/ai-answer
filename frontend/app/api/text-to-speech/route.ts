import { NextRequest, NextResponse } from 'next/server';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { text, voice = "alloy" } = body;

    console.log('TTS API called with text:', text.substring(0, 50) + '...');

    if (!text) {
      return NextResponse.json(
        { error: 'Text is required' },
        { status: 400 }
      );
    }

    const backendUrl = process.env.BACKEND_URL || 'http://localhost:8000';
    console.log('Calling backend at:', backendUrl);

    // Call the Python backend API
    const response = await fetch(`${backendUrl}/api/text-to-speech`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ text, voice }),
    });

    console.log('Backend response status:', response.status);

    if (!response.ok) {
      const errorText = await response.text();
      console.error('Backend error response:', errorText);
      throw new Error(`Backend API error: ${response.statusText} - ${errorText}`);
    }

    const data = await response.json();
    console.log('Backend returned data with audio length:', data.audio_base64?.length || 0);
    return NextResponse.json(data);

  } catch (error) {
    console.error('TTS API error:', error);
    return NextResponse.json(
      { error: `Failed to generate speech: ${error}` },
      { status: 500 }
    );
  }
} 