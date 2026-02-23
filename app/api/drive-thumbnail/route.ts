import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'nodejs';

const dataUrlCache = new Map<string, string>();

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const isAllowedThumbnailUrl = (url: URL) => {
  return url.hostname.endsWith('googleusercontent.com') || url.hostname === 'lh3.googleusercontent.com';
};

const fetchThumbnailAsDataUrl = async (thumbnailUrl: string): Promise<string> => {
  const maxRetries = 4;

  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    const response = await fetch(thumbnailUrl, {
      headers: {
        'user-agent': 'Mozilla/5.0 (compatible; course-thumbnail-fetcher/1.0)',
      },
      cache: 'no-store',
    });

    if (response.ok) {
      const arrayBuffer = await response.arrayBuffer();
      const base64 = Buffer.from(arrayBuffer).toString('base64');
      return `data:image/jpeg;base64,${base64}`;
    }

    if (response.status !== 429 && response.status < 500) {
      throw new Error(`Thumbnail request failed with status ${response.status}`);
    }

    if (attempt === maxRetries) {
      throw new Error(`Thumbnail request failed with status ${response.status} after retries`);
    }

    const backoffMs = 400 * (2 ** attempt);
    await sleep(backoffMs);
  }

  throw new Error('Unexpected thumbnail fetch failure.');
};

export async function GET(req: NextRequest) {
  const thumbnailUrl = req.nextUrl.searchParams.get('thumbnailUrl');

  if (!thumbnailUrl) {
    return NextResponse.json({ error: 'thumbnailUrl is required.' }, { status: 400 });
  }

  let parsedUrl: URL;
  try {
    parsedUrl = new URL(thumbnailUrl);
  } catch {
    return NextResponse.json({ error: 'thumbnailUrl is invalid.' }, { status: 400 });
  }

  if (!isAllowedThumbnailUrl(parsedUrl)) {
    return NextResponse.json({ error: 'thumbnailUrl host is not allowed.' }, { status: 400 });
  }

  const cacheKey = parsedUrl.toString();
  const cached = dataUrlCache.get(cacheKey);
  if (cached) {
    return NextResponse.json({ dataUrl: cached });
  }

  try {
    const dataUrl = await fetchThumbnailAsDataUrl(cacheKey);
    dataUrlCache.set(cacheKey, dataUrl);
    return NextResponse.json({ dataUrl });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to fetch thumbnail.';
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
