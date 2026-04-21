import { createFileRoute, Link } from "@tanstack/react-router";
import { useCallback, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Check, Copy } from "lucide-react";

export const Route = createFileRoute("/")({
  component: Index,
});

const MAX_BYTES = 200 * 1024 * 1024;

function formatBytes(b: number) {
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`;
  if (b < 1024 * 1024 * 1024) return `${(b / 1024 / 1024).toFixed(1)} MB`;
  return `${(b / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

function Index() {
  const [dragOver, setDragOver] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);
  const [uploading, setUploading] = useState(false);
  const [shareUrl, setShareUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleFile = useCallback((f: File) => {
    setError(null);
    setShareUrl(null);
    if (!f.type.startsWith("image/")) {
      setError("Please select an image file.");
      return;
    }
    if (f.size > MAX_BYTES) {
      setError("File too large. Max 200 MB.");
      return;
    }
    setFile(f);
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setPreviewUrl(URL.createObjectURL(f));
  }, [previewUrl]);

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const f = e.dataTransfer.files?.[0];
    if (f) handleFile(f);
  };

  const upload = async () => {
    if (!file) return;
    setUploading(true);
    setProgress(5);
    setError(null);

    try {
      const ext = file.name.split(".").pop() || "bin";
      const path = `${crypto.randomUUID()}.${ext}`;

      const fake = setInterval(() => {
        setProgress((p) => (p < 85 ? p + Math.random() * 8 : p));
      }, 200);

      const { error: upErr } = await supabase.storage
        .from("shared-images")
        .upload(path, file, {
          cacheControl: "31536000",
          contentType: file.type,
          upsert: false,
        });

      clearInterval(fake);
      if (upErr) throw upErr;
      setProgress(92);

      const { data: row, error: dbErr } = await supabase
        .from("images")
        .insert({
          storage_path: path,
          file_name: file.name,
          mime_type: file.type,
          size_bytes: file.size,
        })
        .select("id")
        .single();

      if (dbErr) throw dbErr;
      setProgress(100);

      setShareUrl(`${window.location.origin}/i/${row.id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Upload failed");
      setProgress(0);
    } finally {
      setUploading(false);
    }
  };

  const copy = async () => {
    if (!shareUrl) return;
    await navigator.clipboard.writeText(shareUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const reset = () => {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setFile(null);
    setPreviewUrl(null);
    setShareUrl(null);
    setProgress(0);
    setError(null);
  };

  return (
    <main className="mx-auto flex min-h-screen max-w-xl flex-col px-6 py-20">
      <header className="mb-12">
        <h1 className="text-2xl font-medium tracking-tight">Lossless</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Share images at original quality. No compression.
        </p>
      </header>

      {!shareUrl && !file && (
        <section
          onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          onDrop={onDrop}
          onClick={() => inputRef.current?.click()}
          className={`flex cursor-pointer flex-col items-center justify-center rounded-md border border-dashed py-20 text-center transition-colors ${
            dragOver ? "border-foreground bg-muted" : "border-border hover:border-foreground/40"
          }`}
        >
          <p className="text-sm">Drop an image, or click to choose</p>
          <p className="mt-1 text-xs text-muted-foreground">Max 200 MB</p>
          <input
            ref={inputRef}
            type="file"
            accept="image/*"
            hidden
            onChange={(e) => e.target.files?.[0] && handleFile(e.target.files[0])}
          />
        </section>
      )}

      {file && !shareUrl && (
        <section className="space-y-5">
          <div className="overflow-hidden rounded-md border border-border">
            {previewUrl && (
              <img src={previewUrl} alt="preview" className="mx-auto max-h-80 w-auto" />
            )}
          </div>
          <div className="flex items-center justify-between gap-3 text-sm">
            <div className="min-w-0 flex-1">
              <p className="truncate">{file.name}</p>
              <p className="text-xs text-muted-foreground">{formatBytes(file.size)}</p>
            </div>
            <div className="flex gap-2">
              <Button variant="ghost" size="sm" onClick={reset} disabled={uploading}>Cancel</Button>
              <Button size="sm" onClick={upload} disabled={uploading}>
                {uploading ? "Uploading…" : "Upload"}
              </Button>
            </div>
          </div>
          {uploading && <Progress value={progress} />}
          {error && <p className="text-sm text-destructive">{error}</p>}
        </section>
      )}

      {shareUrl && (
        <section className="space-y-5">
          <div>
            <h2 className="text-base font-medium">Link ready</h2>
            <p className="mt-1 text-xs text-muted-foreground">Anyone with the link can view and download the original.</p>
          </div>

          <div className="flex items-center gap-2 rounded-md border border-border">
            <input
              readOnly
              value={shareUrl}
              className="w-full bg-transparent px-3 py-2 text-sm outline-none"
              onFocus={(e) => e.currentTarget.select()}
            />
            <Button onClick={copy} size="sm" variant="ghost" className="mr-1">
              {copied ? <Check /> : <Copy />}
            </Button>
          </div>

          <div className="flex gap-2">
            <Link to="/i/$id" params={{ id: shareUrl.split("/").pop()! }}>
              <Button size="sm" variant="outline">Open</Button>
            </Link>
            <Button size="sm" variant="ghost" onClick={reset}>Upload another</Button>
          </div>
        </section>
      )}

      {error && !file && <p className="mt-4 text-sm text-destructive">{error}</p>}
    </main>
  );
}
