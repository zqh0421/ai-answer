import { NextRequest, NextResponse } from 'next/server';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { 
      student_answer, 
      feedback, 
      reference_content, 
      slide_title, 
      page_number, 
      has_images = true,
      voice = "alloy",
      slide_images = []
    } = body;

    if (!student_answer || !feedback || !reference_content || !slide_title) {
      return NextResponse.json(
        { error: 'Missing required fields: student_answer, feedback, reference_content, slide_title' },
        { status: 400 }
      );
    }

    console.log('Interactive narration API called for slide:', slide_title);

    // Call the Python backend API
    const response = await fetch(`${process.env.BACKEND_URL || 'http://localhost:8000'}/api/interactive-narration`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ 
        student_answer, 
        feedback, 
        reference_content, 
        slide_title, 
        page_number, 
        has_images,
        voice,
        slide_images
      }),
    });

    console.log('Backend interactive narration response status:', response.status);

    if (!response.ok) {
      const errorText = await response.text();
      console.error('Backend interactive narration error response:', errorText);
      throw new Error(`Backend API error: ${response.statusText} - ${errorText}`);
    }

    const data = await response.json();
    console.log('Backend returned interactive narration with audio length:', data.audio_base64?.length || 0);
    return NextResponse.json(data);

  } catch (error) {
    console.error('Interactive narration API error:', error);
    return NextResponse.json(
      { error: `Failed to generate interactive narration: ${error}` },
      { status: 500 }
    );
  }
} 