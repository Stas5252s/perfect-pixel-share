import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { getClientIp, hashIp, LIMITS } from "@/lib/server/rate-limit";

export const Route = createFileRoute("/api/download/$id")({
  server: {
    handlers: {
      GET: async ({ params }) => {
        const ip = getClientIp();
        const ipHash = hashIp(ip);
        const since = new Date(Date.now() - 60 * 60 * 1000).toISOString();

        // Per-IP overall limit
        const { count: ipCount } = await supabaseAdmin
          .from("image_downloads")
          .select("id", { count: "exact", head: true })
          .eq("ip_hash", ipHash)
          .gte("created_at", since);

        if ((ipCount ?? 0) >= LIMITS.downloadsPerHour) {
          return new Response(JSON.stringify({
            error: `Download limit reached (${LIMITS.downloadsPerHour}/hour). Try again later.`,
          }), { status: 429, headers: { "Content-Type": "application/json" } });
        }

        // Per-image-per-IP throttle (anti-hammer)
        const { count: imgCount } = await supabaseAdmin
          .from("image_downloads")
          .select("id", { count: "exact", head: true })
          .eq("ip_hash", ipHash)
          .eq("image_id", params.id)
          .gte("created_at", since);

        if ((imgCount ?? 0) >= LIMITS.downloadsPerImagePerHour) {
          return new Response(JSON.stringify({
            error: "Too many downloads of this image. Try again later.",
          }), { status: 429, headers: { "Content-Type": "application/json" } });
        }

        // Look up image (admin client; we enforce active state ourselves)
        const { data: img, error: imgErr } = await supabaseAdmin
          .from("images")
          .select("storage_path, file_name, mime_type, size_bytes, expires_at, revoked_at, deleted_at")
          .eq("id", params.id)
          .maybeSingle();

        if (imgErr || !img) {
          return new Response(JSON.stringify({ error: "Not found" }), { status: 404 });
        }
        if (img.deleted_at || img.revoked_at || (img.expires_at && new Date(img.expires_at) < new Date())) {
          return new Response(JSON.stringify({ error: "This link is no longer available." }), { status: 410 });
        }

        // Fetch file from storage
        const { data: blob, error: dlErr } = await supabaseAdmin.storage
          .from("shared-images")
          .download(img.storage_path);

        if (dlErr || !blob) {
          console.error("download error:", dlErr);
          return new Response(JSON.stringify({ error: "Failed to read file" }), { status: 500 });
        }

        const bytes = Number(img.size_bytes);

        // Log download (don't await all the way — but await is fine here, fast)
        await supabaseAdmin.from("image_downloads").insert({
          image_id: params.id,
          ip_hash: ipHash,
          bytes,
        });

        // Increment counters atomically-ish (best-effort)
        await supabaseAdmin.rpc as unknown; // no rpc — just do an update:
        const { data: cur } = await supabaseAdmin
          .from("images")
          .select("download_count, bytes_downloaded")
          .eq("id", params.id)
          .maybeSingle();
        if (cur) {
          await supabaseAdmin
            .from("images")
            .update({
              download_count: Number(cur.download_count) + 1,
              bytes_downloaded: Number(cur.bytes_downloaded) + bytes,
            })
            .eq("id", params.id);
        }

        const arr = await blob.arrayBuffer();
        return new Response(arr, {
          status: 200,
          headers: {
            "Content-Type": img.mime_type || "application/octet-stream",
            "Content-Length": String(arr.byteLength),
            "Content-Disposition": `attachment; filename="${img.file_name.replace(/"/g, "")}"`,
            "Cache-Control": "private, no-store",
          },
        });
      },
    },
  },
});
