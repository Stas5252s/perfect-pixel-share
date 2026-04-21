
-- Create images table
CREATE TABLE public.images (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  storage_path TEXT NOT NULL,
  file_name TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  size_bytes BIGINT NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.images ENABLE ROW LEVEL SECURITY;

-- Anyone can view image metadata (needed to render shared link)
CREATE POLICY "Public can read images"
  ON public.images FOR SELECT
  USING (true);

-- Anyone can insert (anonymous uploads)
CREATE POLICY "Public can insert images"
  ON public.images FOR INSERT
  WITH CHECK (true);

-- Create public storage bucket for images, no file size limit set here (we cap client-side)
INSERT INTO storage.buckets (id, name, public, file_size_limit)
VALUES ('shared-images', 'shared-images', true, 209715200)
ON CONFLICT (id) DO UPDATE SET public = true, file_size_limit = 209715200;

-- Storage policies: public read, public upload
CREATE POLICY "Public can read shared-images"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'shared-images');

CREATE POLICY "Public can upload to shared-images"
  ON storage.objects FOR INSERT
  WITH CHECK (bucket_id = 'shared-images');
