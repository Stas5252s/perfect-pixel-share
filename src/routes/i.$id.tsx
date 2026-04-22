import { createFileRoute, Link, notFound, useRouter } from "@tanstack/react-router";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Download, ArrowLeft, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { formatBytes } from "@/lib/expiration";

export const Route = createFileRoute("/i/$id")({
  loader: async ({ params }) => {
    const { data, error } = await supabase
      .from("images")
      .select("id, storage_path, file_name, mime_type, size_bytes, created_at, expires_at, revoked_at, deleted_at")
      .eq("id", params.id)
      .maybeSingle();

    if (error) throw error;
    if (!data) throw notFound();

    const isInactive =
      !!data.deleted_at ||
      !!data.revoked_at ||
      (!!data.expires_at && new Date(data.expires_at) < new Date());

    if (isInactive) {
      return { image: data, publicUrl: null as string | null, inactive: true as const };
    }

    const { data: pub } = supabase.storage
      .from("shared-images")
      .getPublicUrl(data.storage_path);

    return { image: data, publicUrl: pub.publicUrl, inactive: false as const };
  },
  component: ViewImage,
  errorComponent: ({ error, reset }) => {
    const router = useRouter();
    return (
      <main className="mx-auto flex min-h-screen max-w-xl flex-col items-center justify-center px-6 text-center">
        <h1 className="text-2xl font-semibold">Couldn't load image</h1>
        <p className="mt-2 text-sm text-muted-foreground">{error.message}</p>
        <div className="mt-6 flex gap-3">
          <Button onClick={() => { router.invalidate(); reset(); }}>Retry</Button>
          <Link to="/"><Button variant="outline">Go home</Button></Link>
        </div>
      </main>
    );
  },
  notFoundComponent: () => (
    <main className="mx-auto flex min-h-screen max-w-xl flex-col items-center justify-center px-6 text-center">
      <h1 className="text-3xl font-bold">Image not found</h1>
      <p className="mt-2 text-sm text-muted-foreground">This link may be wrong or the image was removed.</p>
      <Link to="/" className="mt-6"><Button>Upload your own</Button></Link>
    </main>
  ),
  head: ({ loaderData }) => ({
    meta: loaderData && !loaderData.inactive
      ? [
          { title: `${loaderData.image.file_name} · Shared image` },
          { name: "description", content: "View and download the original full-quality image." },
          { property: "og:title", content: loaderData.image.file_name },
          { property: "og:image", content: loaderData.publicUrl ?? "" },
          { name: "twitter:card", content: "summary_large_image" },
          { name: "twitter:image", content: loaderData.publicUrl ?? "" },
        ]
      : [{ title: "Link unavailable" }],
  }),
});

function ViewImage() {
  const data = Route.useLoaderData();
  const [downloading, setDownloading] = useState(false);

  if (data.inactive) {
    const reason =
      data.image.deleted_at ? "deleted"
      : data.image.revoked_at ? "revoked by the owner"
      : "expired";
    return (
      <main className="mx-auto flex min-h-screen max-w-xl flex-col items-center justify-center px-6 text-center">
        <h1 className="text-2xl font-semibold">This link is no longer available</h1>
        <p className="mt-2 text-sm text-muted-foreground">The image was {reason}.</p>
        <Link to="/" className="mt-6"><Button>Upload your own</Button></Link>
      </main>
    );
  }

  const { image, publicUrl } = data;

  const download = async () => {
    setDownloading(true);
    try {
      const res = await fetch(`/api/download/${image.id}`);
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error || "Download failed");
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = image.file_name;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Download failed");
    } finally {
      setDownloading(false);
    }
  };

  return (
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col px-6 py-10">
      <div className="mb-6 flex items-center justify-between gap-4">
        <Link to="/" className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="size-4" /> Upload your own
        </Link>
        <Button onClick={download} disabled={downloading} size="sm">
          {downloading ? <><Loader2 className="animate-spin" /> Preparing…</> : <><Download /> Download original</>}
        </Button>
      </div>

      <div className="overflow-hidden rounded-md border border-border">
        <img
          src={publicUrl!}
          alt={image.file_name}
          className="mx-auto max-h-[80vh] w-auto"
        />
      </div>

      <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
        <span className="truncate text-foreground">{image.file_name}</span>
        <span>{formatBytes(image.size_bytes)} · {image.mime_type}</span>
      </div>
    </main>
  );
}
