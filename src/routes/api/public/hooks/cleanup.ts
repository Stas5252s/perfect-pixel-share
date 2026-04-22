import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

// Called by pg_cron hourly. Hard-deletes files for images whose deleted_at or
// expires_at is older than 24 hours, plus prunes old rate-limit logs.
export const Route = createFileRoute("/api/public/hooks/cleanup")({
  server: {
    handlers: {
      POST: async () => {
        const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

        // Find images to purge: deleted >24h ago, or expired >24h ago.
        const { data: toPurge, error } = await supabaseAdmin
          .from("images")
          .select("id, storage_path")
          .or(`deleted_at.lt.${cutoff},and(expires_at.not.is.null,expires_at.lt.${cutoff})`)
          .limit(500);

        if (error) {
          console.error("cleanup query error:", error);
          return new Response(JSON.stringify({ error: error.message }), { status: 500 });
        }

        let purged = 0;
        if (toPurge && toPurge.length > 0) {
          const paths = toPurge.map((r) => r.storage_path);
          const { error: rmErr } = await supabaseAdmin.storage.from("shared-images").remove(paths);
          if (rmErr) console.error("storage remove error:", rmErr);

          const ids = toPurge.map((r) => r.id);
          const { error: delErr } = await supabaseAdmin.from("images").delete().in("id", ids);
          if (delErr) console.error("db delete error:", delErr);
          else purged = ids.length;
        }

        // Prune old rate-limit logs (>48h)
        const oldCutoff = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();
        await supabaseAdmin.from("image_downloads").delete().lt("created_at", oldCutoff);
        await supabaseAdmin.from("upload_attempts").delete().lt("created_at", oldCutoff);

        return new Response(JSON.stringify({ ok: true, purged }), {
          status: 200, headers: { "Content-Type": "application/json" },
        });
      },
    },
  },
});
