interface DeezerTrackResponse {
  album?: {
    cover_medium?: string;
    cover_big?: string;
    cover_xl?: string;
  };
  artist?: {
    picture_medium?: string;
    picture_big?: string;
    picture_xl?: string;
  };
}

export interface ArtworkResult {
  url: string | null;
  thumbUrl: string | null;
}

export async function fetchDeezerArtwork(deezerUrlOrId: string): Promise<ArtworkResult | null> {
  let trackId = deezerUrlOrId;
  const match = /deezer\.com\/track\/(\d+)/.exec(deezerUrlOrId);
  if (match) {
    trackId = match[1];
  }

  if (!/^\d+$/.test(trackId)) return null;

  try {
    const res = await fetch(`https://api.deezer.com/track/${trackId}`);
    if (!res.ok) return null;
    const json = (await res.json()) as DeezerTrackResponse;

    const albumUrl = json.album?.cover_xl ?? json.album?.cover_big ?? null;
    const albumThumb = json.album?.cover_medium ?? null;

    const artistUrl = json.artist?.picture_xl ?? json.artist?.picture_big ?? null;
    const artistThumb = json.artist?.picture_medium ?? null;

    if (albumUrl && albumThumb) {
      return { url: albumUrl, thumbUrl: albumThumb };
    }
    if (artistUrl && artistThumb) {
      return { url: artistUrl, thumbUrl: artistThumb };
    }
    if (albumUrl) {
      return { url: albumUrl, thumbUrl: albumThumb };
    }
    if (artistUrl) {
      return { url: artistUrl, thumbUrl: artistThumb };
    }
    return null;
  } catch {
    return null;
  }
}
