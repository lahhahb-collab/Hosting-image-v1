const CATBOX_API = "https://catbox.moe/user/api.php";
const CATBOX_HOST = "https://files.catbox.moe/";
const MAX_BYTES = 100 * 1024 * 1024;

const MIME_EXT = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/gif": "gif",
  "image/webp": "webp",
  "image/bmp": "bmp",
  "image/svg+xml": "svg",
  "image/avif": "avif",
  "image/tiff": "tif",
  "image/x-icon": "ico"
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "access-control-allow-origin": "*"
    }
  });
}

function encodeToken(url) {
  return btoa(url).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function decodeToken(token) {
  token = token.replace(/-/g, "+").replace(/_/g, "/");
  while (token.length % 4) token += "=";
  return atob(token);
}

function makeMultipartStream(fileStream, prefix, suffix) {
  const encoder = new TextEncoder();
  const prefixBytes = encoder.encode(prefix);
  const suffixBytes = encoder.encode(suffix);
  const reader = fileStream.getReader();
  let stage = 0;

  return new ReadableStream({
    async pull(controller) {
      try {
        if (stage === 0) {
          controller.enqueue(prefixBytes);
          stage = 1;
          return;
        }
        if (stage === 1) {
          const { value, done } = await reader.read();
          if (done) {
            stage = 2;
            controller.enqueue(suffixBytes);
            controller.close();
            return;
          }
          controller.enqueue(value);
          return;
        }
      } catch (error) {
        controller.error(error);
      }
    },
    async cancel(reason) {
      try { await reader.cancel(reason); } catch {}
    }
  });
}

function getExtension(contentType) {
  return MIME_EXT[contentType] || "bin";
}

async function uploadToCatbox(request) {
  const lengthHeader = request.headers.get("content-length");
  const size = lengthHeader ? Number(lengthHeader) : 0;
  if (size && (!Number.isFinite(size) || size > MAX_BYTES)) {
    return json({ error: "Maksimal 100 MB per file." }, 413);
  }
  if (!request.body) return json({ error: "File kosong." }, 400);

  const contentType = (request.headers.get("content-type") || "application/octet-stream")
    .split(";")[0].trim().toLowerCase();

  if (!contentType.startsWith("image/")) {
    return json({ error: "File harus berupa gambar." }, 415);
  }

  const boundary = "----XCY" + crypto.randomUUID().replace(/-/g, "");
  const ext = getExtension(contentType);
  const filename = `xcy.${ext}`;
  const prefix =
    `--${boundary}\r\n` +
    `Content-Disposition: form-data; name="reqtype"\r\n\r\n` +
    `fileupload\r\n` +
    `--${boundary}\r\n` +
    `Content-Disposition: form-data; name="fileToUpload"; filename="${filename}"\r\n` +
    `Content-Type: ${contentType}\r\n\r\n`;
  const suffix = `\r\n--${boundary}--\r\n`;

  const prefixLength = new TextEncoder().encode(prefix).byteLength;
  const suffixLength = new TextEncoder().encode(suffix).byteLength;
  const outgoingLength = size ? prefixLength + size + suffixLength : null;

  const headers = new Headers({
    "content-type": `multipart/form-data; boundary=${boundary}`,
    "user-agent": "XCY-Image-Host/2.0",
    "accept": "text/plain"
  });
  if (outgoingLength !== null) headers.set("content-length", String(outgoingLength));

  const body = makeMultipartStream(request.body, prefix, suffix);

  let upstream;
  try {
    upstream = await fetch(CATBOX_API, {
      method: "POST",
      headers,
      body
    });
  } catch (error) {
    return json({ error: "Gagal terhubung ke Catbox.", detail: String(error).slice(0, 300) }, 502);
  }

  const text = (await upstream.text()).trim();
  if (!upstream.ok || !text.startsWith(CATBOX_HOST)) {
    return json({
      error: "Catbox menolak upload.",
      detail: text.slice(0, 300) || `HTTP ${upstream.status}`
    }, 502);
  }

  const token = encodeToken(text);
  return json({
    url: `${new URL(request.url).origin}/files/${token}.xcy`,
    source: text
  });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === "/api/upload") {
      if (request.method === "OPTIONS") {
        return new Response(null, {
          status: 204,
          headers: {
            "access-control-allow-origin": "*",
            "access-control-allow-methods": "POST, OPTIONS",
            "access-control-allow-headers": "content-type"
          }
        });
      }
      if (request.method !== "POST") return json({ error: "Method Not Allowed" }, 405);
      return uploadToCatbox(request);
    }

    if (url.pathname.startsWith("/files/") && request.method === "GET") {
      const name = url.pathname.slice("/files/".length);
      if (!name.endsWith(".xcy")) return new Response("Not Found", { status: 404 });
      const token = name.slice(0, -4);

      try {
        const target = decodeToken(token);
        if (!target.startsWith(CATBOX_HOST)) return new Response("Not Found", { status: 404 });

        const upstream = await fetch(target, {
          headers: { "user-agent": "XCY-Image-Host/2.0" }
        });
        if (!upstream.ok) return new Response("File tidak ditemukan.", { status: 404 });

        const headers = new Headers(upstream.headers);
        headers.set("cache-control", "public, max-age=31536000, immutable");
        headers.set("access-control-allow-origin", "*");
        return new Response(upstream.body, { status: 200, headers });
      } catch {
        return new Response("Not Found", { status: 404 });
      }
    }

    return env.ASSETS.fetch(request);
  }
};
