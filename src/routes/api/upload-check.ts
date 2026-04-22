import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { getClientIp, hashIp, LIMITS } from "@/lib/server/rate-limit";

export const Route = createFileRoute("/api/upload-check")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const authHeader = request.headers.get("authorization");
        const token = authHeader?.replace("Bearer ", "");

        // Verify the user is authenticated (uses publishable key + token)
        let userId: string | null = null;
        if (token) {
          const { data } = await supabaseAdmin.auth.getUser(token);
          userId = data.user?.id ?? null;
        }
        if (!userId) {
          return new Response(JSON.stringify({ error: "Sign in to upload." }), {
            status: 401, headers: { "Content-Type": "application/json" },
          });
        }

        const ip = getClientIp();
        const ipHash = hashIp(ip);
        const since = new Date(Date.now() - 60 * 60 * 1000).toISOString();

        const { count, error: countErr } = await supabaseAdmin
          .from("upload_attempts")
          .select("id", { count: "exact", head: true })
          .eq("ip_hash", ipHash)
          .gte("created_at", since);

        if (countErr) {
          console.error("upload-check count error:", countErr);
          return new Response(JSON.stringify({ error: "Server error" }), { status: 500 });
        }

        if ((count ?? 0) >= LIMITS.uploadsPerHour) {
          return new Response(JSON.stringify({
            error: `Upload limit reached (${LIMITS.uploadsPerHour}/hour). Try again later.`,
          }), { status: 429, headers: { "Content-Type": "application/json" } });
        }

        await supabaseAdmin.from("upload_attempts").insert({
          ip_hash: ipHash,
          user_id: userId,
        });

        return new Response(JSON.stringify({ ok: true, remaining: LIMITS.uploadsPerHour - (count ?? 0) - 1 }), {
          status: 200, headers: { "Content-Type": "application/json" },
        });
      },
    },
  },
});
