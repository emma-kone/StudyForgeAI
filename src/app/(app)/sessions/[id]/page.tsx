"use client";

import { useParams } from "next/navigation";
import SessionView from "@/features/session/session-view";

export default function SessionPage() {
  const params = useParams<{ id: string }>();
  return <SessionView sessionId={params.id} />;
}
