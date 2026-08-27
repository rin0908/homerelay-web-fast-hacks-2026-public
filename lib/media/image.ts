export const MAX_PHOTO_DIMENSION = 1600;
export const PHOTO_JPEG_QUALITY = 0.82;

export type ProcessedImage = {
  blob: Blob;
  width: number;
  height: number;
};

export function fitWithin(
  width: number,
  height: number,
  maxDimension = MAX_PHOTO_DIMENSION,
): { width: number; height: number } {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    throw new Error("画像の大きさを確認できませんでした");
  }

  const scale = Math.min(1, maxDimension / Math.max(width, height));
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

function createCanvas(width: number, height: number) {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

function encodeCanvas(
  canvas: HTMLCanvasElement,
  type = "image/jpeg",
  quality = PHOTO_JPEG_QUALITY,
): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob) {
          resolve(blob);
          return;
        }
        reject(new Error("写真を準備できませんでした"));
      },
      type,
      quality,
    );
  });
}

function drawSource(
  source: CanvasImageSource,
  sourceWidth: number,
  sourceHeight: number,
): Promise<ProcessedImage> {
  const size = fitWithin(sourceWidth, sourceHeight);
  const canvas = createCanvas(size.width, size.height);
  const context = canvas.getContext("2d");

  if (!context) {
    throw new Error("写真を準備できませんでした");
  }

  context.drawImage(source, 0, 0, size.width, size.height);
  return encodeCanvas(canvas).then((blob) => ({ ...size, blob }));
}

export async function captureVideoFrame(video: HTMLVideoElement): Promise<ProcessedImage> {
  return drawSource(video, video.videoWidth, video.videoHeight);
}

async function loadImage(blob: Blob): Promise<HTMLImageElement> {
  const objectUrl = URL.createObjectURL(blob);

  try {
    const image = new Image();
    image.decoding = "async";
    image.src = objectUrl;
    await image.decode();
    return image;
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

export async function reencodeImageFile(file: File): Promise<ProcessedImage> {
  if (!file.type.startsWith("image/")) {
    throw new Error("画像ファイルを選んでください");
  }

  if (typeof createImageBitmap === "function") {
    const bitmap = await createImageBitmap(file);
    try {
      return await drawSource(bitmap, bitmap.width, bitmap.height);
    } finally {
      bitmap.close();
    }
  }

  const image = await loadImage(file);
  return drawSource(image, image.naturalWidth, image.naturalHeight);
}
