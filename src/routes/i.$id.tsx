import { createFileRoute, Link, notFound, useRouter } from "@tanstack/react-router";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Download, ArrowLeft, Loader2 } from "lucide-react";

export const Route = createFileRoute("/i/$id")({
  loader: async ({ params }) => {
    const { data, error } = await supabase
      .from("images")
      .select("id, storage_path, file_name, mime_type, size_bytes, created_at")
      .eq("id", params.id)
      .maybeSingle();

    if (error) throw error;
    if (!data) throw notFound();

    const { data: pub } = supabase.storage
      .from("shared-images")
      .getPublicUrl(data.storage_path);

    return { image: data, publicUrl: pub.publicUrl };
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
    meta: loaderData
      ? [
          { title: `${loaderData.image.file_name} · Shared image` },
          { name: "description", content: "View and download the original full-quality image." },
          { property: "og:title", content: loaderData.image.file_name },
          { property: "og:image", content: loaderData.publicUrl },
          { name: "twitter:card", content: "summary_large_image" },
          { name: "twitter:image", content: loaderData.publicUrl },
        ]
      : [],
  }),
});

function formatBytes(b: number) {
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`;
  if (b < 1024 * 1024 * 1024) return `${(b / 1024 / 1024).toFixed(1)} MB`;
  return `${(b / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

function ViewImage() {
  const { image, publicUrl } = Route.useLoaderData();
  const [downloading, setDownloading] = useState(false);

  const download = async () => {
    setDownloading(true);
    try {
      // Fetch as blob to force download with original filename (and bypass inline display)
      const res = await fetch(publicUrl);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = image.file_name;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
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
          src={publicUrl}
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
