import { Toucan } from "toucan-js";
import { WorkerEvent } from "../common";

enum TRIGGER_PATH {
  WAKE_WORD_TRAINING_UPLOAD = "/assist/wake_word/training_data/upload",
}
const WAKE_WORD_ALLOWED_CONTENT_TYPES = [
  "audio/webm",
  "audio/ogg",
  "audio/mp4",
];
const WAKE_WORD_ALLOWED_NAMES = ["casita", "ok_nabu"];
const WAKE_WORD_MAX_CONTENT_LENGTH = 250 * 1024;

const createResponse = (options: {
  content: Record<string, any> | string;
  status?: number;
}) =>
  new Response(JSON.stringify(options.content, null, 2), {
    status: options.status ?? 400,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "PUT",
      "Access-Control-Allow-Headers": "Content-Type",
      "Content-Type": "application/json;charset=UTF-8",
    },
  });

const getUserHash = async (
  request: WorkerEvent["request"]
): Promise<string> => {
  const msgUint8 = new TextEncoder().encode(
    request.headers["CF-Connecting-IP"]
  );
  const hashBuffer = await crypto.subtle.digest("SHA-256", msgUint8);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  const hashHex = hashArray
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  return hashHex;
};

const handleUploadAudioFile = async (event: WorkerEvent): Promise<Response> => {
  const { request } = event;
  const contentType = request.headers.get("content-type");
  const contentLength = parseInt(request.headers.get("content-length"), 10);

  const { searchParams } = new URL(request.url);
  const distance = searchParams.get("distance");
  const speed = searchParams.get("speed");
  const wakeWord = searchParams.get("wake_word");

  if (request.method !== "PUT") {
    return createResponse({
      content: { message: "Invalid method" },
      status: 405,
    });
  }

  if (!WAKE_WORD_ALLOWED_CONTENT_TYPES.includes(contentType)) {
    return createResponse({
      content: {
        message: `Invalid content-type, received: ${contentType}, allowed: ${WAKE_WORD_ALLOWED_CONTENT_TYPES}`,
      },
      status: 415,
    });
  }
  if (contentLength > WAKE_WORD_MAX_CONTENT_LENGTH) {
    return createResponse({
      content: {
        message: `Invalid content-length, received: ${contentLength}, allowed [<${WAKE_WORD_MAX_CONTENT_LENGTH}]`,
      },
      status: 413,
    });
  }
  if (!(distance && speed && wakeWord)) {
    return createResponse({
      content: {
        message: `Invalid parameters: missing distance, speed or wake_word`,
      },
    });
  }

  if (!WAKE_WORD_ALLOWED_NAMES.includes(wakeWord)) {
    return createResponse({
      content: { message: `Invalid wake word, received: ${wakeWord}` },
    });
  }

  const date = new Date().toISOString().substring(0, 23).replace(/:/g, "-");
  const userHash = await getUserHash(request);
  const keyExtension = contentType.replace("audio/", "");

  const key = `${wakeWord}-${date}-${distance}-${speed}-${userHash}.${keyExtension}`;

  await event.env.WAKEWORD_TRAINING_BUCKET.put(key, request.body);

  return createResponse({ content: { message: "success", key }, status: 201 });
};

export async function assistHandler(
  requestUrl: URL,
  event: WorkerEvent,
  sentry: Toucan
): Promise<Response> {
  if (event.request.method === "OPTIONS") {
    // CORS preflight request
    return createResponse({ content: "ok", status: 200 });
  }
  switch (requestUrl.pathname) {
    case TRIGGER_PATH.WAKE_WORD_TRAINING_UPLOAD:
      return await handleUploadAudioFile(event);
  }

  return createResponse({ content: "Not Found", status: 404 });
}
