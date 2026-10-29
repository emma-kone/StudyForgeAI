import { ChapterReaderView } from "@/features/chapter-reader/chapter-reader-view";

interface Props {
  params: Promise<{ chapterId: string }>;
  searchParams: Promise<{ docId?: string }>;
}

export default async function ChapterReaderPage({ params, searchParams }: Props) {
  const { chapterId } = await params;
  const resolvedSearchParams = await searchParams;
  return <ChapterReaderView chapterId={chapterId} initialDocId={resolvedSearchParams?.docId} />;
}
